import Link from 'next/link';
import { breadcrumbNode, withContext } from '@/lib/seo/schema';
import { StructuredData } from './structured-data';
import './guide-article.css';
import './taxonomy.css';

export type Crumb = { name: string; path: string };

// The visible breadcrumb trail. By default the BreadcrumbList JSON-LD is built from the same
// items, so the markup people see and the list machines read cannot drift apart; a page that
// already emits its own BreadcrumbList passes structured={false}. Guide and information pages
// use the "ga-crumbs" styling (guide-article.css), taxonomy pages the default "disc-crumbs".
export function Breadcrumbs({ items, structured = true, className = 'disc-crumbs' }: { items: readonly Crumb[]; structured?: boolean; className?: string }) {
  const last = items.length - 1;
  return <>
    <nav className={className} aria-label="פירורי לחם">
      <ol>{items.map((item, index) => <li key={item.path}>{index === last ? <span aria-current="page">{item.name}</span> : <Link href={item.path}>{item.name}</Link>}</li>)}</ol>
    </nav>
    {structured && <StructuredData data={withContext(breadcrumbNode([...items]))} />}
  </>;
}
