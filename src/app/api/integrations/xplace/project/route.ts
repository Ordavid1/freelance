import { ImportError } from '@/lib/imports/errors';
import { importXPlaceProject } from '@/lib/imports/xplace';
import { handleImportRoute, withPublisherCrossReference } from '@/lib/imports/xplace/pipeline';
import { parseXPlaceUrl } from '@/lib/imports/xplace/urls';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Link import (secondary path, behind XPLACE_LINK_IMPORT_ENABLED): the server reads one pasted public project page.
export async function POST(request: Request) {
  return handleImportRoute(request, {
    kind: 'project', source: 'link', maxBodyBytes: 2_000, action: 'import.xplace',
    unauthenticatedMessage: 'יש להתחבר כדי לייבא פרויקט.',
    prepare: (body) => {
      const target = parseXPlaceUrl(body.url);
      if (!target || target.kind !== 'project') throw new ImportError('INVALID_URL');
      return { canonicalUrl: target.canonicalUrl, logUrl: target.fetchUrl, input: target };
    },
    run: async (target, user) => withPublisherCrossReference(await importXPlaceProject(target), user),
  });
}
