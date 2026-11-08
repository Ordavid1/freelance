import type { Metadata } from 'next';
import { AppShell, PageHeading } from '@/components/marketplace';
import { TrialStatus } from '@/components/trial-status';
export const metadata: Metadata = { title: 'חברות ותשלום' };
export default function MembershipPage() { return <AppShell active="membership"><div className="page-body"><PageHeading title="החברות שלך, ברור ופשוט." description="14 ימים של פעילות מלאה אחרי הקמת פרופיל. לאחר מכן ₪19.99 לחודש."/><TrialStatus full/></div></AppShell>; }
