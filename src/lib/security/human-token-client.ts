// Browser side of the human check (reCAPTCHA Enterprise, see human-check.ts). The site key is published by the root layout as
// <meta name="human-check-site-key"> only when the check is configured; without it nothing is loaded and no header is sent.
// The Google script is loaded on first use, with the page's CSP nonce, so pages that never call an AI or support action pay nothing.

type Enterprise = { ready(callback: () => void): void; execute(siteKey: string, options: { action: string }): Promise<string> };
type Win = Window & { grecaptcha?: { enterprise?: Enterprise } };

export const HUMAN_TOKEN_HEADER = 'x-human-token';
const LOAD_TIMEOUT_MS = 8000;
let loading: Promise<void> | null = null;

export function humanCheckSiteKey(): string {
  if (typeof document === 'undefined') return '';
  return document.querySelector<HTMLMetaElement>('meta[name="human-check-site-key"]')?.content.trim() || '';
}

function loadScript(siteKey: string): Promise<void> {
  if ((window as Win).grecaptcha?.enterprise) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://www.google.com/recaptcha/enterprise.js?render=${encodeURIComponent(siteKey)}`;
    script.async = true;
    const nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce;
    if (nonce) script.nonce = nonce;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('human check script blocked'));
    document.head.appendChild(script);
  }).catch((error) => { loading = null; throw error; });
  return loading;
}

/** Headers to merge into a request for `action` ('support_message' | 'ai_profile' | 'ai_project_brief'). Empty when the check is off or unavailable; the server decides what that means. */
export async function humanCheckHeaders(action: string): Promise<Record<string, string>> {
  const siteKey = humanCheckSiteKey();
  if (!siteKey) return {};
  try {
    const run = async () => {
      await loadScript(siteKey);
      const enterprise = (window as Win).grecaptcha?.enterprise;
      if (!enterprise) throw new Error('human check unavailable');
      await new Promise<void>((resolve) => enterprise.ready(resolve));
      return enterprise.execute(siteKey, { action });
    };
    const token = await Promise.race([run(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('human check timeout')), LOAD_TIMEOUT_MS))]);
    return token ? { [HUMAN_TOKEN_HEADER]: token } : {};
  } catch {
    return {};
  }
}
