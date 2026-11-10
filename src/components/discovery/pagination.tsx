import Link from 'next/link';
import { pageWindow } from '@/lib/seo/pagination';
import './taxonomy.css';

// Crawlable pager: every page is a plain link (`hrefFor` gives the URL, page 1 being the
// clean base URL), with rel prev/next and the current page marked for assistive technology.
export function Pagination({ page, totalPages, hrefFor, label = 'עימוד' }: { page: number; totalPages: number; hrefFor: (page: number) => string; label?: string }) {
  if (totalPages <= 1) return null;
  return <nav className="disc-pager" aria-label={label}>
    <ul>
      {page > 1 && <li><Link href={hrefFor(page - 1)} rel="prev">הקודם</Link></li>}
      {pageWindow(page, totalPages).map((item, index) => item === null
        ? <li key={`gap-${index}`}><span className="disc-pager-gap" aria-hidden="true">…</span></li>
        : <li key={item}>{item === page ? <span aria-current="page" aria-label={`עמוד ${item}, העמוד הנוכחי`}>{item}</span> : <Link href={hrefFor(item)} aria-label={`עמוד ${item}`}>{item}</Link>}</li>)}
      {page < totalPages && <li><Link href={hrefFor(page + 1)} rel="next">הבא</Link></li>}
    </ul>
  </nav>;
}
