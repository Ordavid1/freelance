// Seals Cardcom card tokens with Cloud KMS before they reach Firestore, so a database dump or a
// Firestore-only credential yields ciphertext. Plain Node modules only (no `server-only`, no `@/`
// alias) so the migration script in scripts/billing/ runs the same code as the routes.
//
// Stored on `billingSubscriptions/{uid}`:  tokenSealed: { v: 1, key: <cryptoKeyVersion resource>, ct: <base64> }
// KMS REST (v1): POST https://cloudkms.googleapis.com/v1/<cryptoKey>:encrypt  { plaintext, additionalAuthenticatedData, *Crc32c }
//                POST https://cloudkms.googleapis.com/v1/<cryptoKey>:decrypt  { ciphertext, additionalAuthenticatedData, *Crc32c }
// Decrypt takes the CryptoKey (not a version); KMS picks the version from the ciphertext.
// Tokens, plaintext and ciphertext are never logged: failures log only a fixed event, an operation and an HTTP status.
import { GoogleAuth } from 'google-auth-library';
import { BillingError } from './cardcom.ts';

export type SealedToken = { v: 1; key: string; ct: string };
export type TokenOwner = { uid: string; terminal: number };
export type StoredCard = { token?: unknown; tokenSealed?: unknown } | null | undefined;
export type KmsTransport = (url: string, body: Record<string, string>) => Promise<Record<string, unknown>>;

const KEY_PATTERN = /^projects\/[A-Za-z0-9_.:-]+\/locations\/[a-z0-9-]+\/keyRings\/[A-Za-z0-9_-]{1,63}\/cryptoKeys\/[A-Za-z0-9_-]{1,63}$/;
const VERSION_SEGMENT = '/cryptoKeyVersions/';
const unavailable = () => new BillingError('TOKEN_VAULT_UNAVAILABLE', 503);

export function aad(owner: TokenOwner) { return `freelance-billing-token:v1:${owner.uid}:${owner.terminal}`; }

/** The configured key resource name, null when unconfigured. A set-but-malformed value fails closed. */
export function vaultKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.BILLING_TOKEN_KMS_KEY?.trim();
  if (!value) return null;
  if (!KEY_PATTERN.test(value)) throw unavailable();
  return value;
}

let warnedUnencrypted = false;
function warnUnencryptedOnce() {
  if (warnedUnencrypted) return;
  warnedUnencrypted = true;
  console.warn(JSON.stringify({ event: 'billing_token_unencrypted', severity: 'WARNING' }));
}

let transport: KmsTransport | null = null;
let auth: GoogleAuth | null = null;
/** Test hook: replaces the Cloud KMS REST call. Pass null to restore the real one. */
export function useKmsTransport(next: KmsTransport | null) { transport = next; }
const defaultTransport: KmsTransport = async (url, body) => {
  auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const response = await auth.request<Record<string, unknown>>({ url, method: 'POST', data: body, timeout: 10000, retry: false });
  return response.data;
};
function logFailure(operation: string, detail: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ event: 'billing_token_vault_error', severity: 'ERROR', operation, ...detail }));
}
async function kms(operation: 'encrypt' | 'decrypt', key: string, body: Record<string, string>) {
  try {
    const result = await (transport ?? defaultTransport)(`https://cloudkms.googleapis.com/v1/${key}:${operation}`, body);
    if (result === null || typeof result !== 'object') throw new Error();
    return result;
  } catch (error) {
    const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
    logFailure(operation, typeof status === 'number' ? { status } : {});
    throw unavailable();
  }
}

// CRC32C (Castagnoli), as Cloud KMS uses for its optional integrity fields.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0x82f63b78 : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
export function crc32c(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
const checksum = (data: Buffer) => String(crc32c(data));
const sameChecksum = (value: unknown, data: Buffer) => (typeof value === 'string' || typeof value === 'number') && String(value) === checksum(data);

/** Seals with the configured key. Throws BillingError(503) if unconfigured or on any KMS failure. */
export async function sealToken(token: string, owner: TokenOwner): Promise<SealedToken> {
  const key = vaultKey();
  if (!key || typeof token !== 'string' || !token) throw unavailable();
  const plaintext = Buffer.from(token, 'utf8'); const extra = Buffer.from(aad(owner), 'utf8');
  const result = await kms('encrypt', key, { plaintext: plaintext.toString('base64'), additionalAuthenticatedData: extra.toString('base64'), plaintextCrc32c: checksum(plaintext), additionalAuthenticatedDataCrc32c: checksum(extra) });
  const ciphertext = typeof result.ciphertext === 'string' && result.ciphertext ? Buffer.from(result.ciphertext, 'base64') : null;
  const version = result.name;
  if (!ciphertext || ciphertext.length === 0 || typeof version !== 'string' || !version.startsWith(`${key}${VERSION_SEGMENT}`)
    || result.verifiedPlaintextCrc32c !== true || result.verifiedAdditionalAuthenticatedDataCrc32c !== true || !sameChecksum(result.ciphertextCrc32c, ciphertext)) {
    logFailure('encrypt', { reason: 'invalid_response' });
    throw unavailable();
  }
  return { v: 1, key: version, ct: ciphertext.toString('base64') };
}

export function isSealedToken(value: unknown): value is SealedToken {
  const sealed = value as Partial<SealedToken> | null;
  return !!sealed && typeof sealed === 'object' && sealed.v === 1 && typeof sealed.key === 'string' && typeof sealed.ct === 'string' && sealed.ct.length > 0;
}

/** True when a usable token exists in either format. Does not call KMS. Replaces every `sub.token` check. */
export function hasStoredCard(sub: StoredCard): boolean {
  return !!sub && (isSealedToken(sub.tokenSealed) || (typeof sub.token === 'string' && sub.token.length > 0));
}

/** Sealed field first, legacy plaintext second, null when neither. A sealed token never opens without the key (fail closed). */
export async function openToken(sub: StoredCard, owner: TokenOwner): Promise<string | null> {
  if (sub?.tokenSealed != null) {
    const sealed = sub.tokenSealed;
    const key = vaultKey();
    if (!key || !isSealedToken(sealed) || !sealed.key.startsWith(`${key}${VERSION_SEGMENT}`)) throw unavailable();
    const ciphertext = Buffer.from(sealed.ct, 'base64'); const extra = Buffer.from(aad(owner), 'utf8');
    const result = await kms('decrypt', key, { ciphertext: sealed.ct, additionalAuthenticatedData: extra.toString('base64'), ciphertextCrc32c: checksum(ciphertext), additionalAuthenticatedDataCrc32c: checksum(extra) });
    const plaintext = typeof result.plaintext === 'string' ? Buffer.from(result.plaintext, 'base64') : null;
    if (!plaintext || plaintext.length === 0 || !sameChecksum(result.plaintextCrc32c, plaintext)) {
      logFailure('decrypt', { reason: 'invalid_response' });
      throw unavailable();
    }
    return plaintext.toString('utf8');
  }
  return typeof sub?.token === 'string' && sub.token ? sub.token : null;
}

/** Clears the card in both formats (cancel, or a cancelled signup that never keeps a token). */
export const NO_CARD = { token: null, tokenSealed: null } as const;

/** Firestore fields for a new card token: sealed when the key is configured (never the plaintext), plaintext otherwise. */
export async function cardTokenFields(token: string, owner: TokenOwner): Promise<{ token: string | null; tokenSealed: SealedToken | null }> {
  if (!vaultKey()) { warnUnencryptedOnce(); return { token, tokenSealed: null }; }
  return { token: null, tokenSealed: await sealToken(token, owner) };
}
