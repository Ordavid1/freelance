// Hand-off protocol between the browser extension and Freelance Place pages. Isomorphic: shared
// constants and guards only (the page-side client lives next to the components that use it).
//
// Flow: the extension content script on XPlace captures the user's own page, the extension
// background stores the payload under a random token for one hour and opens
//   <site>/profile/import?xplace=<token>   (profile)   or   <site>/projects/new?xplace=<token>   (project)
// The extension's bridge content script runs on exactly those two paths. The page asks it for the payload with
// window.postMessage and sends it to the ingest API; the bridge never talks to the network.

import { XPLACE_ORIGIN } from './urls';

export const HANDOFF_QUERY_PARAM = 'xplace';
export const HANDOFF_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const HANDOFF_PATHS = { profile: '/profile/import', project: '/projects/new' } as const;

/** Page -> bridge. `read` keeps the payload (a reload or a sign-in detour must not lose it); `clear` deletes it. */
export type HandoffRequest = { channel: 'fp-xplace-request'; token: string; action: 'read' | 'clear' };
/** Bridge -> page, as a reply to a request (same token). `payload` is untrusted until the ingest API accepted it. */
export type HandoffResponse = { channel: 'fp-xplace-response'; token: string; payload?: unknown; error?: string };
/** Bridge -> page, once on load. The bridge also sets `data-fp-xplace-extension="<version>"` on <html>. */
export type HandoffReady = { channel: 'fp-xplace-ready'; version: string };
export const EXTENSION_MARKER_ATTRIBUTE = 'data-fp-xplace-extension';

export function isHandoffToken(value: unknown): value is string {
  return typeof value === 'string' && HANDOFF_TOKEN_PATTERN.test(value);
}

// ---------------------------------------------------------------------------------------------
// Page-initiated launch ("open XPlace for me"). The Freelance Place page generates a token, tells the
// bridge to expect it, and opens XPlace in a new tab with the launch URL. The extension's content script
// on XPlace sees `fp_import` + `fp_ref`, captures the user's own profile and stages the payload under THAT
// token; the bridge then tells the waiting page, which reads and clears the payload with the messages above.
// ---------------------------------------------------------------------------------------------

/** Query parameters on XPlace URLs. `fp_import` is `profile` (page-initiated launch) or `1` (extension-initiated helper tab). */
export const LAUNCH_IMPORT_PARAM = 'fp_import';
export const LAUNCH_TOKEN_PARAM = 'fp_ref';
export const LAUNCH_IMPORT_PROFILE = 'profile';
export const LAUNCH_IMPORT_HELPER = '1';

/** Page -> bridge: a payload for this token will be staged soon; tell me when it is ready. */
export type HandoffAwait = { channel: 'fp-xplace-await'; token: string };
/** Bridge -> page, answer to `fp-xplace-await` (same token): the bridge is listening. */
export type HandoffAwaiting = { channel: 'fp-xplace-awaiting'; token: string };
/** Bridge -> page: the payload for this token is staged; read it with `fp-xplace-request` and clear it afterwards. */
export type HandoffStaged = { channel: 'fp-xplace-staged'; token: string };

/** The XPlace page the user lands on; `www.xplace.com` is the host the extension is allowed on. */
export function buildXPlaceLaunchUrl(token: string): string {
  return `${XPLACE_ORIGIN}/il/?${LAUNCH_IMPORT_PARAM}=${LAUNCH_IMPORT_PROFILE}&${LAUNCH_TOKEN_PARAM}=${encodeURIComponent(token)}`;
}
