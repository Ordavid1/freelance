'use client';
import { useRef, useState } from 'react';
import { SHOWCASE } from '@/lib/headhunters/editor-copy';
import './headhunter-showcase.css';

// Strip of real screens beside the apply form. Desktop: a vertical marquee (the list is rendered twice, the copy stays clickable but is
// hidden from assistive tech and keyboard) that pauses on hover and keyboard focus. Tablet/mobile: a horizontal scroll row. Each image opens
// in a native <dialog> (Esc, focus trap and focus return come with showModal).
type Item = (typeof SHOWCASE.items)[number];

function List({ onOpen, copy }: { onOpen?: (item: Item, opener: HTMLElement) => void; copy?: boolean }) {
  return <ul className="hh-sc-list" aria-hidden={copy || undefined}>
    {SHOWCASE.items.map((item) => <li key={item.src}>
      <button type="button" className="hh-sc-item" onClick={(event) => onOpen?.(item, event.currentTarget)} tabIndex={copy ? -1 : undefined}>
        <img src={item.src} width={item.width} height={item.height} alt={copy ? '' : `${item.title}: ${item.text}`} loading="lazy" decoding="async" />
        <span className="hh-sc-cap"><b>{item.title}</b><small>{item.text}</small></span>
      </button>
    </li>)}
  </ul>;
}

export function HeadhunterShowcase() {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [active, setActive] = useState<Item | null>(null);

  function open(item: Item, from: HTMLElement) {
    opener.current = from;
    setActive(item);
    dialog.current?.showModal();
  }
  function closed() {
    setActive(null);
    opener.current?.focus();
  }

  return <aside className="hh-sc" aria-labelledby="hh-sc-title">
    <p className="hh-sc-head"><strong id="hh-sc-title">{SHOWCASE.title}</strong><small>{SHOWCASE.hint}</small></p>
    <div className="hh-sc-viewport">
      <div className="hh-sc-track">
        <List onOpen={open} />
        <List onOpen={open} copy />
      </div>
    </div>
    <dialog ref={dialog} className="hh-sc-dialog" aria-label={active?.title ?? SHOWCASE.title} onClose={closed}
      onClick={(event) => { if (event.target === dialog.current) dialog.current?.close(); }}>
      {active && <figure>
        <img src={active.src} width={active.width} height={active.height} alt={active.title} />
        <figcaption><b>{active.title}</b> {active.text}</figcaption>
      </figure>}
      <button type="button" className="hh-sc-close" onClick={() => dialog.current?.close()} autoFocus>{SHOWCASE.close}</button>
    </dialog>
  </aside>;
}
