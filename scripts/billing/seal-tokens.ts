// Seals legacy plaintext Cardcom tokens in `billingSubscriptions` with Cloud KMS.
//
//   BILLING_TOKEN_KMS_KEY=projects/<p>/locations/<r>/keyRings/freelance-billing/cryptoKeys/cardcom-tokens \
//     node --experimental-transform-types scripts/billing/seal-tokens.ts --project <gcp-project-id> [--commit]
//   (or: npm run billing:seal-tokens -- --project <id> [--commit])
//
// Dry run by default (reads Firestore, never calls KMS, writes nothing). --commit seals each document in its own
// transaction: seal, open and compare, and only then store `tokenSealed` and null the plaintext `token`.
// Idempotent and safe to re-run. Prints counts only, never tokens or ciphertext. Needs ADC (run `gcp-auth`) with
// Firestore access and cloudkms.cryptoKeyEncrypterDecrypter on the key.
import { pathToFileURL } from 'node:url';
import type { Firestore } from 'firebase-admin/firestore';
import { hasStoredCard, isSealedToken, openToken, sealToken, vaultKey, type SealedToken, type TokenOwner } from '../../src/lib/billing/token-vault.ts';
import { fail, openFirestore, parseCli } from '../headhunters/cli.ts';

export type SealCounts = { total: number; alreadySealed: number; plaintext: number; migrated: number; noCard: number; failed: number; changed: number };
type Vault = { seal: (token: string, owner: TokenOwner) => Promise<SealedToken>; open: typeof openToken };

export async function sealTokens(db: Firestore, options: { commit: boolean; vault?: Vault }): Promise<SealCounts> {
  const vault = options.vault ?? { seal: sealToken, open: openToken };
  const counts: SealCounts = { total: 0, alreadySealed: 0, plaintext: 0, migrated: 0, noCard: 0, failed: 0, changed: 0 };
  const snapshot = await db.collection('billingSubscriptions').get();
  for (const doc of snapshot.docs) {
    counts.total++;
    const data = doc.data();
    const plain = typeof data.token === 'string' && data.token ? data.token : null;
    const sealed = isSealedToken(data.tokenSealed);
    if (!hasStoredCard(data)) { counts.noCard++; continue; }
    if (!plain) { counts.alreadySealed++; continue; }
    counts.plaintext++;
    if (!options.commit) continue;
    const terminal = data.terminal;
    if (!Number.isSafeInteger(terminal) || terminal <= 0) { counts.failed++; continue; }
    const owner = { uid: doc.id, terminal: terminal as number };
    try {
      // A doc that already has both fields (interrupted run) is verified against its existing seal, never re-sealed blindly.
      const tokenSealed = sealed ? (data.tokenSealed as SealedToken) : await vault.seal(plain, owner);
      if ((await vault.open({ tokenSealed }, owner)) !== plain) throw new Error('verify');
      const written = await db.runTransaction(async (tx) => {
        const current = (await tx.get(doc.ref)).data();
        if (!current || current.token !== plain || (sealed ? JSON.stringify(current.tokenSealed) !== JSON.stringify(tokenSealed) : current.tokenSealed != null)) return false;
        tx.update(doc.ref, { tokenSealed, token: null });
        return true;
      });
      if (written) counts.migrated++; else counts.changed++;
    } catch { counts.failed++; }
  }
  return counts;
}

async function main() {
  const parsed = parseCli(process.argv.slice(2), ['project'], ['commit']);
  if (!parsed.ok) fail(parsed.error);
  const { options } = parsed;
  if (!options.project) fail('--project <gcp-project-id> is required (or set GOOGLE_CLOUD_PROJECT).');
  let key: string | null = null;
  try { key = vaultKey(); } catch { fail('BILLING_TOKEN_KMS_KEY is malformed.'); }
  if (options.commit && !key) fail('--commit needs BILLING_TOKEN_KMS_KEY (full cryptoKey resource name).');
  console.log(`Mode: ${options.commit ? 'COMMIT' : 'DRY RUN'}; project: ${options.project}; key configured: ${key ? 'yes' : 'no'}`);
  const counts = await sealTokens(openFirestore(options.project), { commit: options.commit });
  console.log(JSON.stringify(counts));
  if (!options.commit) console.log(`Dry run: nothing was written. ${counts.plaintext} plaintext token(s) would be sealed. Re-run with --commit to apply.`);
  else if (counts.failed || counts.changed) { console.error('Some documents were not sealed (failed or changed concurrently). Re-run to retry; nothing was lost.'); process.exit(1); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Sealing failed before completion; no tokens were printed. Re-run is safe.'); process.exit(1); });
}
