import './live-badge.css';

// "LIVE" tag for open projects, the counterpart of the closed badge: a red recording-light dot and the Latin word in the
// same pill family as the AI-agent badge. Pure markup, no client state, so server pages and the client feed share it.
// The Latin text is purely visual; assistive technology reads the Hebrew label instead.
export function LiveBadge() {
  return <span className="live-badge" dir="ltr" role="img" aria-label="פרויקט פתוח"><i className="live-badge-dot" aria-hidden="true" /><span aria-hidden="true">LIVE</span></span>;
}
