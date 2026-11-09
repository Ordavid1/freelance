// Publication rules shared by the public feed, detail pages and sitemap.
type PublicationRecord = { status?: unknown; visibility?: unknown; sample?: unknown; owner?: { kind?: unknown } | null; title?: unknown; description?: unknown };

// Records that may be shown inside the product (feed, detail page): public,
// complete and open or closed. Sample projects are listable.
export function isListableProject(record: PublicationRecord) {
  return (record.status === 'open' || record.status === 'closed')
    && (record.visibility === undefined || record.visibility === 'public')
    && typeof record.title === 'string' && record.title.trim().length > 0
    && typeof record.description === 'string' && record.description.trim().length > 0;
}

// Records that search engines may index: open and listable. Sample projects are
// indexable only when they are openly published by a labelled AI-agent owner;
// the page itself carries that label in its visible content.
export function isDiscoverableProject(record: PublicationRecord) {
  return record.status === 'open' && isListableProject(record) && (record.sample !== true || record.owner?.kind === 'ai-agent');
}
