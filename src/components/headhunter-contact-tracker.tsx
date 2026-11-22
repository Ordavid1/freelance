'use client';
import type { ReactNode } from 'react';
import { trackEvent } from '@/lib/analytics';
import { ANALYTICS } from '@/lib/headhunters/editor-copy';

/** The channel of a contact link, read from the href the server rendered (see contactLinks in validation.ts). */
export function channelOf(href: string | null | undefined): 'email' | 'phone' | 'whatsapp' | 'linkedin' | 'website' | null {
  if (!href) return null;
  if (href.startsWith('mailto:')) return 'email';
  if (href.startsWith('tel:')) return 'phone';
  if (href.startsWith('https://wa.me/')) return 'whatsapp';
  if (/^https:\/\/([a-z0-9-]+\.)*linkedin\.com\//i.test(href)) return 'linkedin';
  return /^https?:\/\//i.test(href) ? 'website' : null;
}

// The one client piece of the minisite: the contact list reports which channel was clicked (event delegation, so the links
// themselves stay server-rendered). Only the handle and the channel name are sent, never the address or number.
export function ContactClickTracker({ handle, label, children }: { handle: string; label: string; children: ReactNode }) {
  return <ul className="hh-contact" aria-label={label} onClick={(event) => {
    const link = (event.target as Element | null)?.closest?.('a');
    const channel = channelOf(link?.getAttribute('href'));
    if (channel) trackEvent(ANALYTICS.contactClick, { handle, channel });
  }}>{children}</ul>;
}
