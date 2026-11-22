import Link from 'next/link';
import { EDITOR_PATH, ENTRY_CARD } from '@/lib/headhunters/editor-copy';
import './headhunter-entry.css';

// Entry card on the profile page, shown only while the headhunter feature switch is on (the page decides).
export function HeadhunterEntry() {
  return <section className="hh-entry" aria-labelledby="hh-entry-title">
    <h2 id="hh-entry-title">{ENTRY_CARD.title}</h2>
    <p>{ENTRY_CARD.text}</p>
    <Link className="hh-entry-link" href={EDITOR_PATH}>{ENTRY_CARD.cta} <span aria-hidden="true">←</span></Link>
  </section>;
}
