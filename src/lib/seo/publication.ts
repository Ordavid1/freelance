// Publication rules shared by the public feed, detail pages and sitemap.
type PublicationRecord = {
  status?: unknown; visibility?: unknown; title?: unknown; description?: unknown;
  // Showcase markers: `sample`/`unreal` and `owner.kind` on a stored record, `ownerKind` on the public model.
  sample?: unknown; unreal?: unknown; owner?: { kind?: unknown } | null; ownerKind?: unknown;
};

// Showcase projects are seeded records published by an AI agent. They are labelled inside the
// product, but they are not client demand, so they are never offered to search or answer engines:
// no sitemap entry, no index, no structured data, no list, count or link on a public discovery
// page and no IndexNow ping. One predicate serves the stored record and the public model.
export function isSyntheticProject(record: PublicationRecord) {
  return record.sample === true || record.unreal === true || record.owner?.kind === 'ai-agent' || record.ownerKind === 'ai-agent';
}

// Records that may be shown inside the product (feed, detail page): public,
// complete and open or closed. Showcase projects are listable there, with their label.
export function isListableProject(record: PublicationRecord) {
  return (record.status === 'open' || record.status === 'closed')
    && (record.visibility === undefined || record.visibility === 'public')
    && typeof record.title === 'string' && record.title.trim().length > 0
    && typeof record.description === 'string' && record.description.trim().length > 0;
}

// Records that search engines may index: open, listable and published by a real client.
export function isDiscoverableProject(record: PublicationRecord) {
  return record.status === 'open' && isListableProject(record) && !isSyntheticProject(record);
}
