import Link from 'next/link';
import { categories } from '@/lib/seo/categories';
import { contactFacts } from '@/lib/seo/facts';
import { indexablePages } from '@/lib/seo/registry';
import { skillCompleteness, skills } from '@/lib/seo/skills';
import type { PageKind, SeoPage } from '@/lib/seo/types';

export type FooterLink = { label: string; href: string };
export type FooterGroup = { id: string; title: string; links: FooterLink[] };

// Registry titles are written for search results; the footer uses the short names people know.
const SHORT_LABELS: Record<string, string> = {
  '/': 'דף הבית', '/alternatives/xplace': 'אלטרנטיבה ל־XPlace.com', '/privacy': 'מדיניות פרטיות', '/terms': 'תנאי שימוש',
  '/how-it-works': 'איך זה עובד', '/pricing': 'מחיר וחברות', '/faq': 'שאלות נפוצות', '/about': 'אודות', '/glossary': 'מילון מונחים',
  '/guides': 'כל המדריכים', '/skills': 'כל הכישורים', '/projects': 'כל הפרויקטים',
};
const MAX_SKILLS = 8;
const MAX_GUIDES = 6;

// Every link comes from the registry (or the contact facts), so the footer never links to a
// page that does not exist and a group with nothing to show is dropped.
export function footerGroups(): FooterGroup[] {
  const pages = indexablePages();
  const ofKind = (...kinds: PageKind[]) => pages.filter((page) => kinds.includes(page.kind));
  const link = (page: SeoPage, label = SHORT_LABELS[page.path] ?? page.title): FooterLink => ({ label, href: page.path });
  const contact = contactFacts();
  const registered = new Set(pages.map((page) => page.path));
  const groups: FooterGroup[] = [
    { id: 'categories', title: 'תחומים', links: categories.filter((category) => registered.has(`/categories/${category.slug}`)).map((category) => ({ label: category.name, href: `/categories/${category.slug}` })) },
    { id: 'skills', title: 'כישורים', links: skills.filter((skill) => skillCompleteness(skill).complete && registered.has(`/skills/${skill.slug}`)).slice(0, MAX_SKILLS).map((skill) => ({ label: skill.name, href: `/skills/${skill.slug}` })) },
    { id: 'guides', title: 'מדריכים', links: ofKind('guide').slice(0, MAX_GUIDES).map((page) => link(page)) },
    { id: 'product', title: 'Freelance Place', links: [...ofKind('home').map((page) => link(page)),...ofKind('comparison', 'hub', 'info').map((page) => link(page))] },
    { id: 'legal', title: 'מידע משפטי', links: [...ofKind('legal').map((page) => link(page)), { label: 'יצירת קשר', href: `mailto:${contact.email}` }] },
  ];
  return groups.filter((group) => group.links.length > 0);
}

export function SiteFooter() {
  const groups = footerGroups();
  return <footer className="site-footer">
    <div className="site-footer-inner">
      <p className="site-footer-brand"><span lang="en" dir="ltr">Freelance Place</span></p>
      <div className="site-footer-groups">
        {groups.map((group) => <nav key={group.id} aria-labelledby={`footer-${group.id}`}>
          <p className="site-footer-title" id={`footer-${group.id}`}>{group.title}</p>
          <ul>{group.links.map((item) => <li key={item.href}>{item.href.startsWith('mailto:') ? <a href={item.href}>{item.label}</a> : <Link href={item.href}>{item.label}</Link>}</li>)}</ul>
        </nav>)}
      </div>
    </div>
  </footer>;
}
