import type { Metadata } from 'next';
import { AppShell, PageHeading } from '@/components/marketplace';
import { ProjectComposer } from '@/components/actions';
export const metadata: Metadata = { title: 'פרסום פרויקט' };
export default function NewProjectPage() { return <AppShell active="home"><div className="page-body"><PageHeading eyebrow="פרסום פרויקט" title="מתחילים ממה שצריך." description="כתבו משפט אחד. אחר כך נבנה יחד בריף שאפשר להבין ולהציע עליו."/><ProjectComposer/></div></AppShell>; }
