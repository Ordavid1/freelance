type Platform = 'linkedin' | 'github' | 'dribbble' | 'Behance' | 'Website' | 'xplace';

/** Inline vectors keep provider marks available throughout the OAuth return flow. */
export function PlatformIcon({ platform }: { platform: Platform }) {
  if (platform === 'linkedin') return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect width="24" height="24" rx="3" fill="#0A66C2"/><path fill="#fff" d="M6.6 9H3.9v11h2.7V9ZM5.25 4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2ZM20.1 13.7c0-3.3-1.8-4.8-4.1-4.8-1.9 0-2.7 1-3.2 1.7V9H10v11h2.8v-6.1c0-1.6.3-3.1 2.3-3.1s2 1.8 2 3.2v6h3v-6.3Z"/></svg>;
  if (platform === 'github') return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#24292F" d="M12 .8a11.2 11.2 0 0 0-3.54 21.83c.56.1.77-.24.77-.54v-2.1c-3.12.68-3.78-1.32-3.78-1.32-.5-1.3-1.24-1.64-1.24-1.64-1.02-.7.08-.68.08-.68 1.13.08 1.72 1.16 1.72 1.16 1 1.71 2.63 1.22 3.27.93.1-.73.4-1.22.71-1.5-2.49-.28-5.1-1.25-5.1-5.54 0-1.22.44-2.22 1.15-3-.11-.29-.5-1.42.11-2.96 0 0 .94-.3 3.08 1.15a10.7 10.7 0 0 1 5.6 0c2.14-1.45 3.08-1.15 3.08-1.15.61 1.54.22 2.67.11 2.96.72.78 1.15 1.78 1.15 3.01 0 4.3-2.62 5.25-5.12 5.53.4.35.76 1.03.76 2.08v3.07c0 .3.2.65.77.54A11.2 11.2 0 0 0 12 .8Z"/></svg>;
  if (platform === 'dribbble') return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="#EA4C89" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M7 3.4c5 5.8 8.2 12.3 9.6 17.1M2.4 9.5c6.8.4 13.4-1.5 17.1-5M4.5 18.6c4-6 10.4-8.1 17.1-5.8"/></svg>;
  if (platform === 'Behance') return <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="#1769FF"><path d="M2 5.5h6c2.4 0 3.8 1.1 3.8 3.2 0 1.3-.6 2.2-1.6 2.6 1.5.4 2.2 1.5 2.2 3.1 0 2.4-1.7 3.7-4.4 3.7H2V5.5Zm2.8 2.3v2.7h2.7c1.1 0 1.7-.4 1.7-1.4 0-.9-.6-1.3-1.7-1.3H4.8Zm0 4.8v3.1h3c1.3 0 2-.5 2-1.5s-.7-1.6-2-1.6h-3Zm17.7 1.6h-6.3c.1 1.4.8 2.1 2 2.1 1 0 1.5-.5 1.8-1.1h2.3c-.6 2.1-2.1 3.2-4.2 3.2-2.9 0-4.6-1.9-4.6-4.9 0-2.8 1.9-4.8 4.6-4.8 3.1 0 4.7 2.3 4.4 5.5Zm-6.3-1.8h3.8c-.2-1.1-.8-1.7-1.8-1.7-1.1 0-1.8.6-2 1.7ZM15 5.7h6.1v1.6H15z"/></svg>;
  if (platform === 'xplace') return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect width="24" height="24" rx="6" fill="#3D4466"/><path d="M7.5 7.5l9 9M16.5 7.5l-9 9" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round"/></svg>;
  return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M2.8 12h18.4M12 2.5c5.2 5.4 5.2 13.6 0 19M12 2.5c-5.2 5.4-5.2 13.6 0 19"/></svg>;
}

export function SourceCheck() {
  return <svg data-source-check="true" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="#17834F"/><path d="m5.5 10 3 3 6-6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export function SourceDisclosure({ expanded = false }: { expanded?: boolean }) {
  return <svg data-source-disclosure="true" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="#17834F"/><path d="m6 8 4 4 4-4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" transform={expanded ? 'rotate(180 10 10)' : undefined}/></svg>;
}
