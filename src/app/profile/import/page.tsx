import { noIndex } from '@/lib/seo/site';
import type { Metadata } from 'next';
import { AppShell, PageHeading } from '@/components/marketplace';
import { ProfileSetup } from '@/components/publisher-profile-setup';
export const metadata: Metadata = { robots: noIndex, title: 'הקמת פרופיל' };
export default function ProfileImportPage() { return <AppShell active="profile"><div className="page-body"><PageHeading eyebrow="הפרופיל שלך" title="תני לעבודה שלך לדבר." description="מתחילים ממה שכבר קיים. את בודקת כל מילה לפני שהיא מופיעה בפרופיל."/><ProfileSetup/></div></AppShell>; }
