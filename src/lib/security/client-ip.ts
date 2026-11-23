// Client address for anonymous abuse limits. Pure: no imports, so every transport and test can use it.
//
// Production traffic reaches Cloud Run through the Google external Application Load Balancer, which
// APPENDS two entries to whatever `X-Forwarded-For` the caller sent: the address it saw the connection
// come from, then its own forwarding-rule address:
//
//   X-Forwarded-For: <anything the caller wrote>, <client address>, <load balancer address>
//
// Everything BEFORE the client address is caller-controlled and must never be trusted. The client is
// therefore counted from the right: skip `CLIENT_IP_TRUSTED_HOPS` entries (default 1, the load balancer)
// and take the next one. Cloud Run ingress is internal-and-load-balancer only (see main.tf), so a request
// cannot reach the app without those appended entries. With fewer entries than hops (local development,
// no proxy) the first entry is used.

const DEFAULT_TRUSTED_HOPS = 1;

export const UNKNOWN_CLIENT = 'unknown';

function parseIPv4(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    octets.push(octet);
  }
  return octets;
}

function parseIPv6(value: string): number[] | null {
  let text = value;
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  if (!text.includes(':') || /[^0-9a-fA-F:.]/.test(text)) return null;
  // An embedded IPv4 tail (::ffff:1.2.3.4) is two 16-bit groups.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    text = `${text.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const read = (part: string) => part === '' ? [] : part.split(':');
  const head = read(halves[0]);
  const rest = halves.length === 2 ? read(halves[1]) : [];
  if (halves.length === 2 && head.length + rest.length > 7) return null;
  const groups = halves.length === 2 ? [...head, ...Array(8 - head.length - rest.length).fill('0'), ...rest] : head;
  if (groups.length !== 8) return null;
  const numbers: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    numbers.push(parseInt(group, 16));
  }
  return numbers;
}

/**
 * Canonical key for one address, or null when it is not an IP address. IPv4 stays as is; IPv4-mapped IPv6
 * collapses to IPv4; every other IPv6 address is reduced to its /64 prefix, because a single subscriber
 * routinely controls the whole /64 and could otherwise mint unlimited "different" addresses.
 */
export function normalizeIp(value: string): string | null {
  const text = value.trim().replace(/^\[|\]$/g, '');
  const v4 = parseIPv4(text);
  if (v4) return v4.join('.');
  const v6 = parseIPv6(text);
  if (!v6) return null;
  if (v6.slice(0, 5).every(group => group === 0) && v6[5] === 0xffff) return [v6[6] >> 8, v6[6] & 255, v6[7] >> 8, v6[7] & 255].join('.');
  return `${v6.slice(0, 4).map(group => group.toString(16)).join(':')}::/64`;
}

function trustedHops(): number {
  const configured = process.env.CLIENT_IP_TRUSTED_HOPS;
  if (configured === undefined || configured === '') return DEFAULT_TRUSTED_HOPS;
  const hops = Number(configured);
  return Number.isInteger(hops) && hops >= 0 && hops <= 5 ? hops : DEFAULT_TRUSTED_HOPS;
}

export function clientIp(request: Request): string {
  const entries = (request.headers.get('x-forwarded-for') || '').split(',').map(entry => entry.trim()).filter(Boolean);
  if (!entries.length) return UNKNOWN_CLIENT;
  const entry = entries[Math.max(0, entries.length - 1 - trustedHops())];
  return normalizeIp(entry) ?? UNKNOWN_CLIENT;
}
