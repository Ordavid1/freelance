'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ViewerUser = { uid: string; email: string | null; name: string | null; picture: string | null };
export type ViewerState = { status: 'loading'; user: null } | { status: 'anonymous'; user: null } | { status: 'signed-in'; user: ViewerUser };

export const LOADING_VIEWER: ViewerState = { status: 'loading', user: null };
const ANONYMOUS_VIEWER: ViewerState = { status: 'anonymous', user: null };

// Turns a GET /api/auth/session answer into a viewer. Anything that is not a clearly
// signed-in answer (HTTP error, network failure, malformed body) is an anonymous viewer,
// so account-only endpoints are never called without a session.
export function viewerFromSession(ok: boolean, data: unknown): ViewerState {
  const user = ok && data && typeof data === 'object' ? (data as { user?: unknown }).user : null;
  if (!user || typeof user !== 'object' || typeof (user as { uid?: unknown }).uid !== 'string') return ANONYMOUS_VIEWER;
  const record = user as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  return { status: 'signed-in', user: { uid: record.uid as string, email: text(record.email), name: text(record.name), picture: text(record.picture) } };
}

const ViewerContext = createContext<ViewerState | null>(null);

// Fetches /api/auth/session exactly once per page load and shares the answer. Sign-in and
// sign-out both reload the page, so a single read stays correct for the page's lifetime.
export function ViewerProvider({ children }: { children: ReactNode }) {
  const [viewer, setViewer] = useState<ViewerState>(LOADING_VIEWER);
  useEffect(() => {
    let active = true;
    fetch('/api/auth/session', { cache: 'no-store' })
      .then(async (response) => viewerFromSession(response.ok, response.ok ? await response.json() : null))
      .catch(() => ANONYMOUS_VIEWER)
      .then((next) => { if (active) setViewer(next); });
    return () => { active = false; };
  }, []);
  return <ViewerContext.Provider value={viewer}>{children}</ViewerContext.Provider>;
}

export function useViewer(): ViewerState {
  const viewer = useContext(ViewerContext);
  if (!viewer) throw new Error('useViewer must be used inside ViewerProvider.');
  return viewer;
}
