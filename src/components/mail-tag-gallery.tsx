'use client';

import { useRef, useState, type PointerEvent } from 'react';

type Props = {
  tags: string[];
  selected: string[];
  onPick: (tag: string) => void;
  onRemove: (tag: string) => void;
};

export function MailTagGallery({ tags, selected, onPick, onRemove }: Props) {
  const drag = useRef({ pointer: -1, x: 0, scroll: 0, moved: false });
  const [dragging, setDragging] = useState(false);

  function start(event: PointerEvent<HTMLDivElement>) {
    // Touch and trackpads use the browser's native horizontal scrolling.
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    drag.current = { pointer: event.pointerId, x: event.clientX, scroll: event.currentTarget.scrollLeft, moved: false };
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (state.pointer !== event.pointerId || !(event.buttons & 1)) return;
    const distance = event.clientX - state.x;
    if (!state.moved && Math.abs(distance) < 6) return;
    if (!state.moved) {
      state.moved = true;
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    event.currentTarget.scrollLeft = state.scroll - distance;
  }

  function end(event: PointerEvent<HTMLDivElement>) {
    if (drag.current.pointer !== event.pointerId) return;
    drag.current.pointer = -1;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <div
    className={`mail-tags${dragging ? ' is-dragging' : ''}`}
    role="group"
    aria-label="גלריית תגיות — אפשר לגלול לצדדים"
    tabIndex={0}
    onPointerDown={start}
    onPointerMove={move}
    onPointerUp={end}
    onPointerCancel={event => { end(event); drag.current.moved = false; }}
    onPointerLeave={event => {
      if (drag.current.pointer === event.pointerId && !drag.current.moved) drag.current.pointer = -1;
    }}
    onLostPointerCapture={event => {
      if (drag.current.pointer === event.pointerId) { end(event); drag.current.moved = false; }
    }}
    onClickCapture={event => {
      if (drag.current.moved) { event.preventDefault(); event.stopPropagation(); drag.current.moved = false; }
    }}
  >
    {tags.map(tag => <span className={`mail-tag-chip${selected.includes(tag) ? ' is-selected' : ''}`} key={tag}>
      <button type="button" className="mail-tag-pick" onClick={() => onPick(tag)} aria-label={`הוספת ${tag} לשדה התגיות${selected.includes(tag) ? ' — תגית שנבחרה' : ''}`}><bdi>{tag}</bdi></button>
      {selected.includes(tag) && <button type="button" className="mail-tag-remove" onClick={() => onRemove(tag)} aria-label={`הסרת ${tag}`}>×</button>}
    </span>)}
  </div>;
}
