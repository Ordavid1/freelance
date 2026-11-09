import { noIndex } from '@/lib/seo/site';
import type { Metadata } from 'next';
import WorkspaceHome from '@/components/workspace-home';
export const metadata: Metadata = { robots: noIndex, title: 'הקמת פרופיל' };
export default function ProfileImportPage() { return <WorkspaceHome initialView="פרופיל"/>; }
