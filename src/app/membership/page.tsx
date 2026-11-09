import type { Metadata } from 'next';
import { AppShell, PageHeading } from '@/components/marketplace';
import { TrialStatus } from '@/components/trial-status';
export const metadata: Metadata = { title: 'מנוי ותשלומים' };
export default function MembershipPage() { return <AppShell active="membership"><div className="page-body"><PageHeading title="החברות שלך, ברור ופשוט." description="פרסום פרויקטים חינם תמיד. לפרילנסרים: 14 ימים להגשת הצעות אחרי הקמת הפרופיל, ולאחר מכן ₪19.99 לחודש."/><TrialStatus full/></div></AppShell>; }
