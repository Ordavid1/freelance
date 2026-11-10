'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useViewer } from './viewer-context';

type Proposal = { id: string; conversationId: string; freelancerName: string; amount: number; currency: string; pricingType: string; delivery: string; message: string; status: string };

export function ProjectProposals({ projectSlug, initialStatus = 'open', onClosed }: { projectSlug: string; initialStatus?: string; onClosed?: () => void }) {
  const viewer = useViewer();
  const [status, setStatus] = useState(initialStatus);
  const [closing, setClosing] = useState(false);
  useEffect(() => { setStatus(initialStatus); }, [projectSlug, initialStatus]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (viewer.status !== 'signed-in') return;
    fetch(`/api/marketplace/proposals?projectSlug=${encodeURIComponent(projectSlug)}`, { cache: 'no-store' })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setProposals(data.proposals || []); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'לא ניתן לטעון הצעות.'));
  }, [projectSlug, viewer.status]);
  async function closeProject() {
    setClosing(true); setError('');
    try { const response = await fetch('/api/marketplace/projects', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: projectSlug, status: 'closed' }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setStatus('closed'); onClosed?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'לא הצלחנו לסגור את הפרויקט.'); }
    finally { setClosing(false); }
  }
  if (error) return <p className="error-text" role="alert">{error}</p>;
  if (!proposals.length) return <section className="bid-comparison"><div className="proposal-row"><h3>{status === 'closed' ? 'הפרויקט סגור' : 'הצעות שהתקבלו'}</h3>{status === 'open' && <button type="button" className="button-outline" disabled={closing} onClick={() => void closeProject()}>{closing ? 'סוגרים…' : 'סגירת הפרויקט'}</button>}</div><p>{status === 'closed' ? 'לא ניתן לשלוח הצעות חדשות לפרויקט.' : 'עדיין לא התקבלו הצעות לפרויקט הזה.'}</p></section>;
  return <section className="bid-comparison"><div className="proposal-row"><h3>הצעות שהתקבלו ({proposals.filter(proposal => proposal.status !== 'withdrawn').length})</h3>{status === 'open' ? <button type="button" className="button-outline" disabled={closing} onClick={() => void closeProject()}>{closing ? 'סוגרים…' : 'סגירת הפרויקט'}</button> : <span>הפרויקט סגור להצעות</span>}</div>{proposals.map((proposal) => <article className="proposal-card" key={proposal.id}><div className="proposal-row"><strong>{proposal.freelancerName}</strong><strong>{new Intl.NumberFormat('he-IL', { style: 'currency', currency: proposal.currency || 'ILS', maximumFractionDigits: 0 }).format(proposal.amount)} · {proposal.pricingType === 'hourly' ? 'לשעה' : 'קבוע'}</strong></div><p>{proposal.message}</p><small>זמן משוער: {proposal.delivery} · סטטוס: {proposal.status === 'withdrawn' ? 'ההצעה בוטלה' : proposal.status === 'submitted' ? 'הצעה חדשה' : proposal.status}</small><Link className="button-outline" href={`/messages?conversation=${encodeURIComponent(proposal.conversationId)}`}>פתיחת שיחה</Link></article>)}</section>;
}
