import { noIndex } from '@/lib/seo/site';
import type { Metadata } from 'next';
import WorkspaceHome from '@/components/workspace-home';
import { getHeadhunterConfig } from '@/lib/db/headhunters';
export const metadata: Metadata = { robots: noIndex, title: 'הקמת פרופיל' };
export const dynamic = 'force-dynamic';
// The link to the headhunter page appears only while the feature switch is on; an unreadable switch means off.
async function headhunterEntry() {
  try { return (await getHeadhunterConfig()).enabled; } catch { return false; }
}
export default async function ProfileImportPage() { return <WorkspaceHome initialView="פרופיל" headhunterEntry={await headhunterEntry()}/>; }
