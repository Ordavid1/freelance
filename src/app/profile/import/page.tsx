import type { Metadata } from 'next';
import { AppShell, PageHeading } from '@/components/marketplace';
import { ProfileImport } from '@/components/actions';
export const metadata: Metadata = { title: 'הקמת פרופיל' };
export default function ProfileImportPage() { return <AppShell active="profile"><div className="page-body"><PageHeading eyebrow="הפרופיל שלך" title="תני לעבודה שלך לדבר." description="מתחילים ממה שכבר קיים. את בודקת כל מילה לפני שהיא מופיעה בפרופיל."/><ProfileImport/></div></AppShell>; }
