import Link from 'next/link';
import { headhunterTagLabel } from '@/lib/headhunters/presentation';
import type { PublicHeadhunterTag } from '@/lib/headhunters/types';
import { minisiteDisplay, minisitePath } from '@/lib/headhunters/urls';
import './headhunter-tag.css';

// The headhunter tag of a project: a split pill, name (lime) and address (ink), linking to the minisite. Pure markup with
// no client state, so the server pages and the client feed use the same component. It is a link: never render it inside a
// <button> (invalid HTML that swallows clicks); the feed card renders it in a row beside the expand button instead.
// Analytics: no `headhunter_tag_click` event. trackEvent is a client-side helper and no card tracks clicks today, so an
// event here would turn this server component into a client one on every page just for a counter.
function TagContent({ headhunter }: { headhunter: PublicHeadhunterTag }) {
  const display = minisiteDisplay(headhunter.handle);
  const host = display.slice(0, display.indexOf('/'));
  return <>
    <span className="hh-tag-name">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" /></svg>
      <bdi>{headhunter.name}</bdi>
    </span>
    <span className="hh-tag-url" dir="ltr"><span className="hh-host">{host}</span>/{headhunter.handle}</span>
  </>;
}

/** The pill's content only, never a link: the editor's live preview uses this, so typed input never reaches an href. */
export function HeadhunterTagPill({ headhunter }: { headhunter: PublicHeadhunterTag }) {
  return <span className="hh-tag" aria-hidden="true">
    <TagContent headhunter={headhunter} />
  </span>;
}

export function HeadhunterTag({ headhunter }: { headhunter: PublicHeadhunterTag }) {
  return <Link className="hh-tag" href={minisitePath(headhunter.handle)} prefetch={false} aria-label={headhunterTagLabel(headhunter.name)}>
    <TagContent headhunter={headhunter} />
  </Link>;
}
