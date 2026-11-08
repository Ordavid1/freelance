'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Proposal = { id: string; conversationId: string; freelancerName: string; amount: number; currency: string; pricingType: string; delivery: string; message: string; status: string };

export function ProjectProposals({ projectSlug }: { projectSlug: string }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch(`/api/marketplace/proposals?projectSlug=${encodeURIComponent(projectSlug)}`, { cache: 'no-store' })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setProposals(data.proposals || []); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'לא ניתן לטעון הצעות.'));
  }, [projectSlug]);
  if (error) return <p className="error-text" role="alert">{error}</p>;
  if (!proposals.length) return <section className="bid-comparison"><h3>הצעות שהתקבלו</h3><p>עדיין לא התקבלו הצעות לפרויקט הזה.</p></section>;
  return <section className="bid-comparison"><h3>הצעות שהתקבלו ({proposals.length})</h3>{proposals.map((proposal) => <article className="proposal-card" key={proposal.id}><div className="proposal-row"><strong>{proposal.freelancerName}</strong><strong>{new Intl.NumberFormat('he-IL', { style: 'currency', currency: proposal.currency || 'ILS', maximumFractionDigits: 0 }).format(proposal.amount)} · {proposal.pricingType === 'hourly' ? 'לשעה' : 'קבוע'}</strong></div><p>{proposal.message}</p><small>זמן משוער: {proposal.delivery} · סטטוס: {proposal.status}</small><Link className="button-outline" href={`/messages?conversation=${encodeURIComponent(proposal.conversationId)}`}>פתיחת שיחה</Link></article>)}</section>;
}
