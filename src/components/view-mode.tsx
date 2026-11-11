'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type ViewMode = 'freelancer' | 'publisher';
const ViewModeContext = createContext<{ mode: ViewMode; setMode: (mode: ViewMode) => void }>({ mode: 'freelancer', setMode: () => {} });
// Navigation preference only. Never changes account permissions, profile data or email consent.
export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [mode, setValue] = useState<ViewMode>('freelancer');
  useEffect(() => { try { if (sessionStorage.getItem('fz-view-mode') === 'publisher') setValue('publisher'); } catch {} }, []);
  function setMode(value: ViewMode) {
    setValue(value);
    try { sessionStorage.setItem('fz-view-mode', value); } catch {}
  }
  return <ViewModeContext.Provider value={{ mode, setMode }}>{children}</ViewModeContext.Provider>;
}
export const useViewMode = () => useContext(ViewModeContext);
