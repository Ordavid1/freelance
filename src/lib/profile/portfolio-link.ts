/** An editable portfolio entry can contain prose and one public HTTP(S) link. */
export function portfolioLink(entry: string): URL | null {
  const candidate = entry.match(/https?:\/\/[^\s)<>"']+/i)?.[0];
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}
