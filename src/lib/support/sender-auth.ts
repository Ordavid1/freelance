// Sender authentication for inbound support mail, read from the `Authentication-Results` header the receiving provider adds
// (RFC 8601). The From header alone proves nothing: anyone can write it. Mail is treated as really from its From domain only
// when DKIM or SPF passed for a domain aligned with it. No pass, or a pass for an unrelated domain, means "not authenticated".
// Resend inbound (checked on a real message, 23 Nov 2026) does NOT add Authentication-Results, so a missing header cannot be
// treated as a failure: `senderAuthFailed` refuses only when results are present and none is an aligned pass. Pure: no I/O.

function headerValue(headers: Record<string, string> | null | undefined, name: string) {
  if (!headers) return '';
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key === undefined ? '' : String(headers[key]);
}

/** Relaxed alignment (RFC 7489): the same domain, or one a subdomain of the other. */
export function domainsAligned(a: string, b: string) {
  const left = a.trim().toLowerCase().replace(/\.$/, '');
  const right = b.trim().toLowerCase().replace(/\.$/, '');
  if (!left || !right || !left.includes('.') || !right.includes('.')) return false;
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

type Result = { method: 'dkim' | 'spf'; verdict: string; props: Record<string, string> };

function parseResults(value: string): Result[] {
  const results: Result[] = [];
  for (const segment of value.replace(/\([^)]*\)/g, ' ').split(';')) {
    const head = segment.match(/^\s*(dkim|spf)\s*=\s*([a-z]+)\b([\s\S]*)$/i);
    if (!head) continue;
    const props: Record<string, string> = {};
    for (const [, key, , val] of head[3].matchAll(/([a-z][a-z0-9.-]*)\s*=\s*("?)([^\s;"]+)\2/gi)) props[key.toLowerCase()] = val;
    results.push({ method: head[1].toLowerCase() as 'dkim' | 'spf', verdict: head[2].toLowerCase(), props });
  }
  return results;
}

/** True when DKIM (`header.d`) or SPF (`smtp.mailfrom`) passed for a domain aligned with `senderDomain`. */
export function senderAuthenticated(headers: Record<string, string> | null | undefined, senderDomain: string) {
  return parseResults(headerValue(headers, 'authentication-results')).some((result) => {
    if (result.verdict !== 'pass') return false;
    if (result.method === 'dkim') return domainsAligned(result.props['header.d'] || '', senderDomain);
    return domainsAligned((result.props['smtp.mailfrom'] || '').split('@').pop() || '', senderDomain);
  });
}

/** True when the message carries Authentication-Results and none of them is an aligned DKIM or SPF pass. */
export function senderAuthFailed(headers: Record<string, string> | null | undefined, senderDomain: string) {
  if (!headerValue(headers, 'authentication-results').trim()) return false;
  return !senderAuthenticated(headers, senderDomain);
}
