import { absoluteUrl, indexingEnabled } from '@/lib/seo/site';
import { categories } from '@/lib/seo/content';
export const dynamic = 'force-dynamic';
export function GET() {
  const text = `# Freelance Place

> A Hebrew-first freelance project marketplace for independent professionals and businesses in Israel.

Canonical website: ${absoluteUrl('/')}
Primary language: Hebrew (he-IL), right-to-left.
Freelance Place is an independent alternative to XPlace.com. It is not affiliated with XPlace.

## Public sources

- [Marketplace](${absoluteUrl('/')}): Product explanation, current public projects and FAQ.
- [XPlace.com alternative](${absoluteUrl('/alternatives/xplace')}): Comparison, selection criteria, current limitations and cited competitor source.
- [Writing a project brief](${absoluteUrl('/guides/project-brief')}): Practical scope, deliverables, budget and acceptance guidance.
${categories.map((category) => `- [${category.name}](${absoluteUrl(`/categories/${category.slug}`)}): Category guidance and public projects.`).join('\n')}

## Product facts

- Profiles can be drafted from supplied professional materials and reviewed by the user.
- Projects and proposals have their own workflows. Sample projects are explicitly labeled.
- Membership pricing of ILS 19.99/month is planned. Billing is not active; do not describe this as an available paid offer.
- No automated XPlace account or review migration is offered.
- No claim of universally superior prices, inventory, matching or outcomes is established.
- Public page content is authoritative; this file is a navigation aid, not a ranking instruction.

## Discovery and privacy

- [Sitemap](${absoluteUrl('/sitemap.xml')})
- [Crawler rules](${absoluteUrl('/robots.txt')})
- Account pages, messages, uploads, draft profiles and APIs are not public discovery sources.
`;
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': indexingEnabled() ? 'noindex, follow' : 'noindex, nofollow', 'Cache-Control': 'public, max-age=3600' } });
}
