import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Breadcrumbs } from '@/components/discovery/breadcrumbs';
import { HeadhunterEditor } from '@/components/headhunter-editor';
import { HeadhunterShowcase } from '@/components/headhunter-showcase';
import { SupportHeaderActions } from '@/components/support-chat';
import { getCurrentUser } from '@/lib/auth/session';
import { signInHref } from '@/lib/auth/safe-next';
import { getHeadhunter, getHeadhunterConfig, isAccountActive } from '@/lib/db/headhunters';
import { EDITOR_PATH, EDITOR_TEXT as T } from '@/lib/headhunters/editor-copy';
import { ownerView } from '@/lib/headhunters/view';
import { noIndex } from '@/lib/seo/site';

// Private (the /profile prefix is in privatePaths and noindex here as well). Signed-in only; 404 while the feature switch is
// off (or unreadable: it fails closed). The owner's record is loaded here with the functions behind GET /api/headhunter,
// so the first paint needs no client fetch.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: noIndex, title: T.pageTitle };

export default async function HeadhunterEditorPage() {
  let config: Awaited<ReturnType<typeof getHeadhunterConfig>>;
  try { config = await getHeadhunterConfig(); } catch { notFound(); }
  if (!config.enabled) notFound();
  const user = await getCurrentUser();
  if (!user) redirect(signInHref(EDITOR_PATH));

  let view = null;
  let failed = false;
  try {
    const record = await getHeadhunter(user.uid);
    view = record ? ownerView(record, { accountActive: await isAccountActive(user.uid) }) : null;
  } catch (error) {
    console.error('Headhunter editor unavailable', error instanceof Error ? error.name : 'Error');
    failed = true;
  }

  const trail = [{ name: T.breadcrumbHome, path: '/' }, { name: T.breadcrumbProfile, path: '/profile/import' }, { name: T.pageTitle, path: EDITOR_PATH }];
  return <>
    <header className="discovery-header"><Link href="/" aria-label="Freelance Place — דף הבית"><Image src="/freelance-place-logo.svg" width={52} height={52} alt="Freelance Place" /></Link><span lang="en" dir="ltr">Freelance Place</span><SupportHeaderActions><Link href="/profile/import">{T.back}</Link></SupportHeaderActions></header>
    <main className="discovery-content hh-site hh-page">
      <div className="hh-page-head">
        <Breadcrumbs items={trail} structured={false} />
        <h1>{T.title}</h1>
        <p className="disc-brief"><strong>{T.briefLabel}</strong> {T.brief}</p>
      </div>
      <HeadhunterShowcase />
      <div className="hh-page-body">
        {failed
          ? <p className="hh-empty" role="alert">{T.unavailable}</p>
          : <HeadhunterEditor view={view} applicationsOpen={config.applicationsOpen} />}
      </div>
    </main>
  </>;
}
