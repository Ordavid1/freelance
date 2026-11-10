import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicHeader } from '@/components/discovery/public-content';
import { categories } from '@/lib/seo/categories';
import { indexablePages } from '@/lib/seo/registry';
import { noIndex } from '@/lib/seo/site';
import '@/components/discovery/taxonomy.css';

// The 404 page for every unknown URL and every notFound() call. It renders inside the root
// layout (site footer and structured data included) and Next.js answers with status 404 and a
// noindex tag. The links come from the registry, so the page never points at a page that is not
// published: a hub appears only while it is registered and indexable.
export const metadata: Metadata = {
  title: 'העמוד לא נמצא',
  description: 'העמוד שביקשתם לא קיים או שהוסר. אפשר להמשיך לפרויקטים הפתוחים, לכישורים או לתחומי העבודה ב־Freelance Place.',
  robots: noIndex,
};

// Short names for the hub links, in the order they are listed; a hub without an entry falls
// back to its registry title and goes last.
const HUB_LABELS: Record<string, string> = { '/projects': 'פרויקטים פתוחים', '/skills': 'כישורים ושירותי פרילנסרים' };
const HUB_NOTES: Record<string, string> = {
  '/projects': 'הפרויקטים שפתוחים להצעות, מהחדש לישן, עם קישורים לפי תחום וכישור.',
  '/skills': 'הסבר על כל שירות: מה הוא כולל, איך בוחרים נותן שירות ומה משפיע על המחיר.',
};
const hubRank = (path: string) => { const index = Object.keys(HUB_LABELS).indexOf(path); return index === -1 ? Object.keys(HUB_LABELS).length : index; };

export default function NotFound() {
  const pages = indexablePages();
  const registered = new Set(pages.map((page) => page.path));
  const hubs = pages.filter((page) => page.kind === 'hub').sort((a, b) => hubRank(a.path) - hubRank(b.path));
  const areas = categories.filter((category) => registered.has(`/categories/${category.slug}`));
  return <>
    <PublicHeader />
    <main className="discovery-content">
      <p className="disc-eyebrow">שגיאה 404</p>
      <h1>העמוד לא נמצא</h1>
      <p className="disc-brief"><strong>בקיצור:</strong> הקישור אינו תקין, או שהעמוד הוסר או הועבר. אפשר להמשיך מאחד המקומות שמופיעים כאן.</p>
      {hubs.length > 0 && <section aria-labelledby="not-found-hubs">
        <h2 id="not-found-hubs">לאן אפשר להמשיך?</h2>
        <ul className="disc-link-list">{hubs.map((page) => <li key={page.path}><Link href={page.path}>{HUB_LABELS[page.path] ?? page.title}</Link>{HUB_NOTES[page.path] && <p>{HUB_NOTES[page.path]}</p>}</li>)}</ul>
      </section>}
      {areas.length > 0 && <section aria-labelledby="not-found-areas">
        <h2 id="not-found-areas">עיון לפי תחום</h2>
        <ul className="disc-browse">{areas.map((category) => <li key={category.slug}><Link className="disc-chip disc-chip-category" href={`/categories/${category.slug}`}>{category.name}</Link></li>)}</ul>
      </section>}
      <p className="disc-actions"><Link className="discovery-cta" href="/">לדף הבית</Link><Link href="/projects/new">לפרסום פרויקט</Link></p>
    </main>
  </>;
}
