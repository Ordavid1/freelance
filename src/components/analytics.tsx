"use client";
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { trackEvent } from '@/lib/analytics';

export function Analytics() {
  const pathname = usePathname();
  const lastPage = useRef<string | null>(null);
  useEffect(() => {
    if (lastPage.current === pathname) return;
    lastPage.current = pathname;
    const location = new URL(window.location.href);
    // Preserve campaign attribution while excluding arbitrary search values.
    for (const key of Array.from(location.searchParams.keys())) {
      if (!/^(utm_(source|medium|campaign|term|content|id)|gclid|dclid|msclkid)$/.test(key)) location.searchParams.delete(key);
    }
    location.hash = '';
    trackEvent('page_view', { page_path: pathname, page_location: location.toString(), page_referrer: document.referrer ? new URL(document.referrer).origin : '' });
  }, [pathname]);
  useEffect(() => {
    const click = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target.closest('button,a,[role="button"]') : null;
      if (!element) return;
      // Never collect visible text, form values, query strings, messages or profile details.
      const classes = Array.from(element.classList).filter(value => /^[a-z][a-z0-9_-]{0,50}$/i.test(value)).slice(0, 3).join('.');
      trackEvent('ui_click', { page_path: window.location.pathname, element_type: element.tagName.toLowerCase(), element_id: element.getAttribute('data-analytics-id') || classes || element.tagName.toLowerCase() });
    };
    document.addEventListener('click', click, true);
    return () => document.removeEventListener('click', click, true);
  }, []);
  return null;
}
