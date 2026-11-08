// Publication rules shared by the public feed, detail pages and sitemap.
export function isDiscoverableProject(record: { status?: unknown; visibility?: unknown; sample?: unknown; title?: unknown; description?: unknown }) {
  return record.status === 'open'
    && (record.visibility === undefined || record.visibility === 'public')
    && record.sample !== true
    && typeof record.title === 'string' && record.title.trim().length > 0
    && typeof record.description === 'string' && record.description.trim().length > 0;
}
