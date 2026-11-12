// XPlace import is opt-in in every environment.
//
// XPLACE_IMPORT_ENABLED=true     shows the XPlace source and import UI and accepts the payloads the
//                                browser extension captured on the user's own XPlace pages.
// XPLACE_LINK_IMPORT_ENABLED=true additionally lets the server read a pasted public XPlace PROJECT link
//                                (an automated fetch from our servers; see docs/xplace-import.md).
//                                Profiles are never read from a link: they come from the extension or pasted text.
export function isXPlaceImportEnabled(): boolean {
  return process.env.XPLACE_IMPORT_ENABLED === 'true';
}

export function isXPlaceLinkImportEnabled(): boolean {
  return isXPlaceImportEnabled() && process.env.XPLACE_LINK_IMPORT_ENABLED === 'true';
}

/** Chrome Web Store (or other) install page of the browser extension; only an https URL is ever exposed to the UI. */
export function xplaceExtensionUrl(): string {
  const raw = (process.env.XPLACE_EXTENSION_URL || '').trim();
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
