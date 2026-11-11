import 'server-only';
import { ImportError } from '../errors';
import { safeFetchHtml } from '../safe-fetch';
import type { XPlaceProfileImport, XPlaceProjectImport, XPlaceTarget } from '../types';
import { parseXPlaceProfileHtml } from './profile';
import { parseXPlaceProjectHtml } from './project';

async function fetchPage(url: string): Promise<string> {
  try {
    return await safeFetchHtml(url);
  } catch (error) {
    throw error instanceof ImportError ? error : new ImportError('UPSTREAM_UNAVAILABLE');
  }
}

function parsePage<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    throw error instanceof ImportError ? error : new ImportError('NOT_ENOUGH_DATA');
  }
}

export async function importXPlaceProfile(target: Extract<XPlaceTarget, { kind: 'profile' }>): Promise<XPlaceProfileImport> {
  const html = await fetchPage(target.fetchUrl);
  const parsed = parsePage(() => parseXPlaceProfileHtml(html, target));
  return { ...parsed, fetchedAt: new Date().toISOString() };
}

export async function importXPlaceProject(target: Extract<XPlaceTarget, { kind: 'project' }>): Promise<XPlaceProjectImport> {
  const html = await fetchPage(target.fetchUrl);
  const parsed = parsePage(() => parseXPlaceProjectHtml(html, target));
  return { ...parsed, fetchedAt: new Date().toISOString() };
}
