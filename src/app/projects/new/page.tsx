import { noIndex } from '@/lib/seo/site';
import type { Metadata } from 'next';
import { headhunterEntryEnabled } from '@/lib/db/headhunters';
import WorkspaceHome from '@/components/workspace-home';
export const metadata: Metadata = { robots: noIndex, title: 'פרסום פרויקט' };
// The current workspace with the project composer open (like /profile/import for the profile). The browser extension
// opens this path with ?xplace=<token>, so it must always be the live workspace and never a separate older shell.
export const dynamic = 'force-dynamic';
export default async function NewProjectPage() { return <WorkspaceHome initialView="פרסום פרויקט" headhunterEntry={await headhunterEntryEnabled()}/>; }
