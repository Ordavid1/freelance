import { NextResponse } from 'next/server';
import { isXPlaceImportEnabled, isXPlaceLinkImportEnabled, xplaceExtensionUrl } from '@/lib/imports/flag';
import { route } from '@/lib/security/policy';

export const runtime = 'nodejs';

// Lets the UI show or hide the XPlace import entry points. No auth: it reveals nothing private.
// `extensionUrl` is only exposed while the feature is on, so a dark deployment shows no install link.
export const GET = route('import.xplace.config', {}, () => {
  const enabled = isXPlaceImportEnabled();
  return NextResponse.json(
    { enabled, linkImport: isXPlaceLinkImportEnabled(), extensionUrl: enabled ? xplaceExtensionUrl() : '' },
    { headers: { 'Cache-Control': 'no-store' } });
});
