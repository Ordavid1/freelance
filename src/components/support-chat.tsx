'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import styles from './support-chat.module.css';

const ChatPanel = dynamic(() => import('./support-chat-panel'));
type ChatState = { open: boolean; unread: number; toggle: () => void };
const ChatContext = createContext<ChatState | null>(null);
export const SUPPORT_RETURN_KEY = 'fz-support-return';

export function ChatIcon({ close = false }: { close?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{close ? <path d="m6 6 12 12M18 6 6 18" /> : <><path d="M20 11.5a8 8 0 0 1-8 8H5l-4 3V11.5a9.5 9.5 0 1 1 19 0Z" transform="translate(1 -1) scale(.95)" /><path d="M7.5 10.5h.01M12 10.5h.01M16.5 10.5h.01" strokeWidth="2.8" /></>}</svg>;
}

export function SupportChatProvider({ children, contactEmail }: { children: ReactNode; contactEmail: string }) {
  const [open, setOpen] = useState(false);
  const [activated, setActivated] = useState(false);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    try { if (localStorage.getItem(SUPPORT_RETURN_KEY)) setActivated(true); } catch { /* Storage is optional. */ }
  }, []);
  function toggle() { setActivated(true); setOpen((value) => !value); }
  return <ChatContext.Provider value={{ open, unread, toggle }}>
    {children}
    <SupportChatLauncher variant="desktop" />
    {activated && <ChatPanel open={open} onClose={() => setOpen(false)} onUnread={setUnread} contactEmail={contactEmail} />}
  </ChatContext.Provider>;
}

export function SupportChatLauncher({ variant = 'header' }: { variant?: 'desktop' | 'header' }) {
  const chat = useContext(ChatContext);
  if (!chat) return null;
  return <button type="button" className={`${styles.launcher} ${variant === 'desktop' ? styles.desktopLauncher : styles.headerLauncher} ${chat.open ? styles.launcherOpen : ''}`} onClick={chat.toggle} aria-label={chat.open ? 'מזעור שיחת התמיכה' : `פתיחת צ׳אט תמיכה${chat.unread ? `, ${chat.unread} תשובות חדשות` : ''}`} aria-expanded={chat.open} aria-controls="support-chat" aria-haspopup="dialog" title="שיחה עם צוות Freelance Place">
    <span className={styles.launcherIcon}><ChatIcon close={chat.open} /></span>
    {variant === 'desktop' && <span className={styles.launcherCopy}><strong>{chat.open ? 'ממשיכים כאן' : 'בואו נדבר'}</strong><small>{chat.unread ? 'מחכה לך תשובה חדשה' : 'הצוות שלנו, במרחק הודעה'}</small></span>}
    {chat.unread > 0 && <span className={styles.unread} aria-hidden="true">{chat.unread > 9 ? '9+' : chat.unread}</span>}
  </button>;
}

export function SupportHeaderActions({ children }: { children: ReactNode }) {
  return <div className={styles.accountActions}>{children}<SupportChatLauncher /></div>;
}
