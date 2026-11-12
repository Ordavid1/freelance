import { noIndex } from '@/lib/seo/site';
import type { Metadata } from 'next';
import { AppShell, PageHeading } from '@/components/marketplace';
import { StudioInbox } from '@/components/studio-tools';
export const metadata: Metadata = { robots: noIndex, title: 'הודעות' };
export default function MessagesPage() { return <AppShell active="messages"><div className="page-body messages-page"><PageHeading eyebrow="מרחב השיחות" title="הודעות" description="כל שיחה נשארת מחוברת לפרויקט ולהצעה שלה."/><StudioInbox/></div></AppShell>; }
