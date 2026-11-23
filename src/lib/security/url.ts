// Pure URL checks shared by every place that stores a user-supplied link. No imports: it also runs under plain
// `node` scripts and in the headhunter validation, which use relative `.ts` imports.

/**
 * A public https URL: the https scheme, no credentials, a dotted host name (no bare hosts like `localhost`),
 * and at most `maxLength` characters before and after normalisation. Anything else, including javascript:,
 * data: and http: links, is rejected. Returns the parsed URL or null.
 */
export function parseHttpsUrl(value: string, maxLength: number): URL | null {
  if (value.length > maxLength) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') || url.href.length > maxLength) return null;
  return url;
}
