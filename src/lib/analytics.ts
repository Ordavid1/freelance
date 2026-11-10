export const MEASUREMENT_ID = 'G-CM5KEE7G13';
export function trackEvent(name: string, parameters: Record<string, string | number | boolean> = {}) {
  if (typeof window === 'undefined') return;
  const target = window as Window & { dataLayer?: unknown[] };
  target.dataLayer = target.dataLayer || [];
  // Google tag consumes argument objects, including events queued before it loads.
  function gtag(..._args: unknown[]) { target.dataLayer!.push(arguments); }
  gtag('event', name, { ...parameters, send_to: MEASUREMENT_ID });
}
