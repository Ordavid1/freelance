// Pure helpers: no server-only import, safe to use from anywhere.

// Slack link, mention and special tokens look like <target> or <target|label>.
const TOKEN = /<([^<>\s|]+)(?:\|([^<>]*))?>/g;

export function slackTextToPlain(text: string): string {
  const plain = text
    .replace(TOKEN, (match, target: string, label: string | undefined) => {
      if (target.startsWith('!')) return '';
      if (target.startsWith('@')) return label ? `@${label}` : '@user';
      if (target.startsWith('#')) return label ? `#${label}` : '#channel';
      if (target.startsWith('mailto:')) return label || target.slice('mailto:'.length);
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return label && label !== target ? `${label} (${target})` : target;
      return match;
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  return plain.replace(/\x00/g, '').trim();
}

export function escapeSlack(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function isInternalNote(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('//') || /^note:/i.test(trimmed);
}
