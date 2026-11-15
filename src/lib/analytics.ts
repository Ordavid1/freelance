export const MEASUREMENT_ID = 'G-CM5KEE7G13';
type EventParameters = Record<string, string | number | boolean>;

function pushEvent(name: string, parameters: Record<string, unknown>) {
  const target = window as Window & { dataLayer?: unknown[] };
  target.dataLayer = target.dataLayer || [];
  // Google tag consumes argument objects, including events queued before it loads.
  function gtag(..._args: unknown[]) { target.dataLayer!.push(arguments); }
  gtag('event', name, { ...parameters, send_to: MEASUREMENT_ID });
}

export function trackEvent(name: string, parameters: EventParameters = {}) {
  if (typeof window === 'undefined') return;
  pushEvent(name, parameters);
}

/**
 * trackEvent for an event that is followed straight away by a full page load (a reload or location.assign), which
 * would otherwise unload the page before Google's tag sends the hit. Resolves when the tag reports the event sent
 * (event_callback), or after `timeoutMs` when the tag is blocked, missing or slow, so the navigation never hangs.
 */
export function trackEventBeforeNavigation(name: string, parameters: EventParameters = {}, timeoutMs = 1000): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    window.setTimeout(done, timeoutMs);
    pushEvent(name, { ...parameters, event_callback: done, event_timeout: timeoutMs });
  });
}

/**
 * GA4's recommended sign_up / login events for a completed Google sign-in (the session cookie is already set).
 * `isNewUser` is Firebase's flag on the sign-in result: true only on the sign-in that created the account, so
 * sign_up counts new accounts and can be imported into Google Ads as a conversion.
 */
export function trackGoogleSignIn(isNewUser: boolean): Promise<void> {
  return trackEventBeforeNavigation(isNewUser ? 'sign_up' : 'login', { method: 'Google' });
}
