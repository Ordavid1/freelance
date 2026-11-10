import Link from 'next/link';
import './guide-article.css';

export type Crumb = { name: string; path: string };

// The visible trail. A page feeds the same array to breadcrumbNode(), so the markup people see
// and the BreadcrumbList machines read cannot drift apart.
export function Breadcrumbs({ items }: { items: readonly Crumb[] }) {
  return <nav className="ga-crumbs" aria-label="פירורי לחם"><ol>{items.map((item, index) => <li key={item.path}>{index === items.length - 1 ? <span aria-current="page">{item.name}</span> : <Link href={item.path}>{item.name}</Link>}</li>)}</ol></nav>;
}
