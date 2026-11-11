// Page-side client of the extension hand-off (see handoff.ts). Client only: it talks to the extension's bridge
// content script with window.postMessage and never touches the network. Every function takes an optional
// window-like object so the protocol is testable without a browser.
import {
  EXTENSION_MARKER_ATTRIBUTE, HANDOFF_QUERY_PARAM, isHandoffToken,
  type HandoffAwait, type HandoffRequest,
} from './handoff';

export type HandoffWindow = {
  location: { href: string; origin: string; search: string };
  document: { documentElement: { hasAttribute(name: string): boolean } };
  history: { state: unknown; replaceState(state: unknown, unused: string, url?: string | URL | null): void };
  postMessage(message: unknown, targetOrigin: string): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
};

export type HandoffFailure = 'timeout' | 'expired' | 'cancelled' | 'unavailable';
export class HandoffError extends Error {
  readonly reason: HandoffFailure;
  constructor(reason: HandoffFailure) {
    super(reason);
    this.name = 'HandoffError';
    this.reason = reason;
  }
}

export const DEFAULT_READ_TIMEOUT_MS = 5_000;
export const DETECT_TIMEOUT_MS = 1_500;
export const LAUNCH_TIMEOUT_MS = 5 * 60_000;

function currentWindow(win?: HandoffWindow): HandoffWindow {
  if (win) return win;
  if (typeof window === 'undefined') throw new HandoffError('unavailable');
  return window as unknown as HandoffWindow;
}

/** The hand-off token in the page URL, or null when absent or not a UUID. */
export function takeHandoffToken(win?: HandoffWindow): string | null {
  try {
    const token = new URLSearchParams(currentWindow(win).location.search).get(HANDOFF_QUERY_PARAM);
    return isHandoffToken(token) ? token : null;
  } catch { return null; }
}

/** Removes the token from the address bar without a navigation (after a successful import). */
export function dropHandoffParam(win?: HandoffWindow): void {
  try {
    const w = currentWindow(win);
    const url = new URL(w.location.href);
    if (!url.searchParams.has(HANDOFF_QUERY_PARAM)) return;
    url.searchParams.delete(HANDOFF_QUERY_PARAM);
    w.history.replaceState(w.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch { /* the address bar is cosmetic */ }
}

/**
 * Subscribes to messages the bridge posted into THIS window: same window object as source, same origin, a plain
 * object with the expected channel and token. Returns the unsubscribe function.
 */
function listen(w: HandoffWindow, channel: string, token: string | null, handler: (data: Record<string, unknown>) => void): () => void {
  const listener = (event: MessageEvent) => {
    if (event.source !== (w as unknown) || event.origin !== w.location.origin) return;
    const data = event.data as Record<string, unknown> | null;
    if (!data || typeof data !== 'object' || data.channel !== channel) return;
    if (token !== null && data.token !== token) return;
    handler(data);
  };
  w.addEventListener('message', listener);
  return () => w.removeEventListener('message', listener);
}

type RequestOptions = { timeoutMs?: number; signal?: AbortSignal; win?: HandoffWindow };

function send(w: HandoffWindow, message: HandoffRequest | HandoffAwait): void {
  w.postMessage(message, w.location.origin);
}

/**
 * Asks the bridge for the staged payload. The payload stays in the extension (a reload or a sign-in detour must
 * not lose it) until `clearHandoff`. Rejects with `expired` (the extension no longer holds the token or answered
 * with an error), `timeout` (no bridge answered) or `cancelled`.
 */
export function requestHandoffPayload(token: string, options: RequestOptions = {}): Promise<unknown> {
  const { timeoutMs = DEFAULT_READ_TIMEOUT_MS, signal } = options;
  return new Promise((resolve, reject) => {
    if (!isHandoffToken(token)) { reject(new HandoffError('expired')); return; }
    let w: HandoffWindow;
    try { w = currentWindow(options.win); } catch (error) { reject(error); return; }
    let off: () => void = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (settle: () => void) => { off(); if (timer) clearTimeout(timer); signal?.removeEventListener('abort', onAbort); settle(); };
    const onAbort = () => finish(() => reject(new HandoffError('cancelled')));
    if (signal?.aborted) { reject(new HandoffError('cancelled')); return; }
    signal?.addEventListener('abort', onAbort);
    off = listen(w, 'fp-xplace-response', token, (data) => {
      if (typeof data.error === 'string' || data.payload === undefined || data.payload === null) finish(() => reject(new HandoffError('expired')));
      else finish(() => resolve(data.payload));
    });
    timer = setTimeout(() => finish(() => reject(new HandoffError('timeout'))), timeoutMs);
    send(w, { channel: 'fp-xplace-request', token, action: 'read' });
  });
}

/** Tells the extension to delete the staged payload. Fire and forget. */
export function clearHandoff(token: string, win?: HandoffWindow): void {
  try {
    if (!isHandoffToken(token)) return;
    send(currentWindow(win), { channel: 'fp-xplace-request', token, action: 'clear' });
  } catch { /* nothing to clear */ }
}

/**
 * Page-initiated launch: tells the bridge to expect a payload for `token`, then resolves when the bridge reports
 * `fp-xplace-staged` for that token. Call BEFORE opening XPlace. Rejects with `timeout` or `cancelled`.
 */
export function awaitHandoff(token: string, options: RequestOptions = {}): Promise<void> {
  const { timeoutMs = LAUNCH_TIMEOUT_MS, signal } = options;
  return new Promise((resolve, reject) => {
    if (!isHandoffToken(token)) { reject(new HandoffError('expired')); return; }
    let w: HandoffWindow;
    try { w = currentWindow(options.win); } catch (error) { reject(error); return; }
    if (signal?.aborted) { reject(new HandoffError('cancelled')); return; }
    let off: () => void = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (settle: () => void) => { off(); if (timer) clearTimeout(timer); signal?.removeEventListener('abort', onAbort); settle(); };
    const onAbort = () => finish(() => reject(new HandoffError('cancelled')));
    signal?.addEventListener('abort', onAbort);
    off = listen(w, 'fp-xplace-staged', token, () => finish(resolve));
    timer = setTimeout(() => finish(() => reject(new HandoffError('timeout'))), timeoutMs);
    send(w, { channel: 'fp-xplace-await', token });
  });
}

/** True when the extension's bridge is present: the marker attribute, or a ready message within `timeoutMs`. */
export function isExtensionInstalled(options: { timeoutMs?: number; win?: HandoffWindow } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    let w: HandoffWindow;
    try { w = currentWindow(options.win); } catch { resolve(false); return; }
    if (w.document.documentElement.hasAttribute(EXTENSION_MARKER_ATTRIBUTE)) { resolve(true); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = listen(w, 'fp-xplace-ready', null, () => { off(); if (timer) clearTimeout(timer); resolve(true); });
    timer = setTimeout(() => { off(); resolve(w.document.documentElement.hasAttribute(EXTENSION_MARKER_ATTRIBUTE)); }, options.timeoutMs ?? DETECT_TIMEOUT_MS);
  });
}
