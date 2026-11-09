// Pure gateway adapter: credentials and raw gateway responses must never reach clients/logs.
export const PRICE_AGOROT = 1999;
export const PRODUCT = 'Freelance Place — חברות לחודש';
export type CardcomConfig = { terminal: number; apiName: string; apiPassword?: string; siteUrl: string };
export class BillingError extends Error {
  constructor(public code: string, public status = 503) { super(code); }
}
export function cardcomConfig(env: NodeJS.ProcessEnv = process.env): CardcomConfig {
  const terminal = Number(env.CARDCOM_TERMINAL_NUMBER);
  if (env.BILLING_ENABLED !== 'true' || !Number.isSafeInteger(terminal) || terminal <= 0 || !env.CARDCOM_API_NAME) throw new BillingError('BILLING_UNAVAILABLE');
  let site: URL;
  try { site = new URL(env.NEXT_PUBLIC_SITE_URL!); } catch { throw new BillingError('BILLING_UNAVAILABLE'); }
  if (site.protocol !== 'https:' || site.username || site.password || site.pathname !== '/' || site.search || site.hash || site.hostname === 'localhost') throw new BillingError('BILLING_UNAVAILABLE');
  return { terminal, apiName: env.CARDCOM_API_NAME, apiPassword: env.CARDCOM_API_PASSWORD, siteUrl: site.origin };
}
export type GatewayResult = Record<string, unknown>;
export function object(value: unknown): GatewayResult { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as GatewayResult : {}; }
export async function cardcomPost(config: CardcomConfig, path: 'LowProfile/Create' | 'LowProfile/GetLpResult' | 'Transactions/Transaction' | 'Transactions/GetTransactionByExternalUniqTran', payload: GatewayResult, transport: typeof fetch = fetch) {
  try {
    const response = await transport(`https://secure.cardcom.solutions/api/v11/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(25000), body: JSON.stringify({ ...payload, TerminalNumber: config.terminal, ApiName: config.apiName, ...(path.startsWith('Transactions/') && config.apiPassword ? { ApiPassword: config.apiPassword } : {}) }),
    });
    if (!response.ok) throw new Error();
    return object(await response.json());
  } catch { throw new BillingError('GATEWAY_UNAVAILABLE'); }
}
export function success(value: unknown) { return value === 0 || value === '0'; }
export function hostedUrl(value: unknown) {
  if (typeof value !== 'string') throw new BillingError('INVALID_GATEWAY_RESPONSE');
  let url: URL;
  try { url = new URL(value); } catch { throw new BillingError('INVALID_GATEWAY_RESPONSE'); }
  if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname === 'cardcom.solutions' || url.hostname.endsWith('.cardcom.solutions'))) throw new BillingError('INVALID_GATEWAY_RESPONSE');
  return url.href;
}
export function checkoutPayload(config: CardcomConfig, orderId: string, name: string, email: string, setupOnly = false) {
  const returnUrl = `${config.siteUrl}/membership?order=${encodeURIComponent(orderId)}`;
  return {
    Operation: setupOnly ? 'CreateTokenOnly' : 'ChargeAndCreateToken', Amount: setupOnly ? 1 : PRICE_AGOROT / 100, ISOCoinId: 1, Language: 'he', ReturnValue: orderId, ProductName: PRODUCT,
    SuccessRedirectUrl: returnUrl, FailedRedirectUrl: returnUrl, CancelRedirectUrl: returnUrl,
    WebHookUrl: `${config.siteUrl}/api/billing/webhook?order=${encodeURIComponent(orderId)}`,
    AdvancedDefinition: { MinNumOfPayments: 1, MaxNumOfPayments: 1, ...(setupOnly ? { JValidateType: 5 } : {}) },
    ...(setupOnly ? {} : { Document: { DocumentTypeToCreate: 'Auto', Name: name, Email: email, IsSendByEmail: true, Language: 'he',
      Products: [{ Description: PRODUCT, Quantity: 1, UnitCost: PRICE_AGOROT / 100 }] } }),
  };
}
export function verifyPayment(result: GatewayResult, order: { id: string; lowProfileId: string; terminal: number; amountAgorot: number }) {
  if (!success(result.ResponseCode)) throw new BillingError('PAYMENT_INCOMPLETE', 409);
  const transaction = object(result.TranzactionInfo);
  if (result.ReturnValue !== order.id || String(result.LowProfileId).toLowerCase() !== order.lowProfileId.toLowerCase() || Number(result.TerminalNumber) !== order.terminal || result.Operation !== 'ChargeAndCreateToken' || !success(transaction.ResponseCode) || Number(transaction.TerminalNumber) !== order.terminal || Number(transaction.CoinId) !== 1 || typeof transaction.Amount !== 'number' || Math.abs(transaction.Amount * 100 - order.amountAgorot) > 0.00001 || !Number.isSafeInteger(result.TranzactionId) || Number(result.TranzactionId) <= 0 || result.TranzactionId !== transaction.TranzactionId || transaction.IsRefund === true) throw new BillingError('PAYMENT_MISMATCH', 409);
  const document = object(result.DocumentInfo);
  return {
    transactionId: String(result.TranzactionId),
    token: typeof object(result.TokenInfo).Token === 'string' ? String(object(result.TokenInfo).Token) : null,
    expiry: tokenExpiry(object(result.TokenInfo)),
    last4: String(transaction.Last4CardDigitsString ?? transaction.Last4CardDigits ?? '').padStart(4, '0').slice(-4),
    documentNumber: success(document.ResponseCode) && Number.isSafeInteger(document.DocumentNumber) ? Number(document.DocumentNumber) : null,
    invoicePending: !success(document.ResponseCode),
  };
}
// Calendar month, clamped to the final day (Jan 31 -> Feb 28/29), in UTC.
export function nextMonth(value: number) {
  const date = new Date(value);
  const day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + 1);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.getTime();
}

export function tokenExpiry(info: GatewayResult) {
  const month = Number(info.TokenExDateMonth ?? info.CardMonth);
  const year = Number(info.TokenExDateYear ?? info.CardYear);
  return Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(year) && year >= 0 ? `${String(month).padStart(2, '0')}${String(year % 100).padStart(2, '0')}` : null;
}
export function verifyRenewal(result: GatewayResult, terminal: number) {
  if (!success(result.ResponseCode) || Number(result.TerminalNumber) !== terminal || Number(result.CoinId) !== 1 || typeof result.Amount !== 'number' || Math.abs(result.Amount * 100 - PRICE_AGOROT) > 0.00001 || !Number.isSafeInteger(result.TranzactionId) || Number(result.TranzactionId) <= 0 || result.IsRefund === true) throw new BillingError('RENEWAL_UNVERIFIED', 409);
  return String(result.TranzactionId);
}

export function verifyTrialSetup(result: GatewayResult, order: { id: string; lowProfileId: string; terminal: number }) {
  if (!success(result.ResponseCode)) throw new BillingError('PAYMENT_INCOMPLETE', 409);
  if (result.ReturnValue !== order.id || String(result.LowProfileId).toLowerCase() !== order.lowProfileId.toLowerCase() || Number(result.TerminalNumber) !== order.terminal || result.Operation !== 'CreateTokenOnly') throw new BillingError('PAYMENT_MISMATCH', 409);
  const token = object(result.TokenInfo);
  const expiry = tokenExpiry(token);
  if (typeof token.Token !== 'string' || !token.Token || !expiry) throw new BillingError('TOKEN_MISSING');
  const transaction = object(result.TranzactionInfo);
  const suffix = transaction.Last4CardDigitsString ?? token.Last4CardDigitsString ?? transaction.Last4CardDigits;
  return { token: token.Token, expiry, last4: suffix == null ? null : String(suffix).padStart(4, '0').slice(-4) };
}
