import { ImportError } from '@/lib/imports/errors';
import { importXPlaceProfile } from '@/lib/imports/xplace';
import { handleImportRoute } from '@/lib/imports/xplace/pipeline';
import { parseXPlaceUrl } from '@/lib/imports/xplace/urls';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Link import (secondary path, behind XPLACE_LINK_IMPORT_ENABLED): the server reads one pasted public profile page.
export async function POST(request: Request) {
  return handleImportRoute(request, {
    kind: 'profile', source: 'link', maxBodyBytes: 2_000, action: 'import.xplace',
    unauthenticatedMessage: 'יש להתחבר כדי לייבא פרופיל.',
    prepare: (body) => {
      const target = parseXPlaceUrl(body.url);
      if (!target || target.kind !== 'profile') throw new ImportError('INVALID_URL');
      return { canonicalUrl: target.canonicalUrl, logUrl: target.fetchUrl, input: target };
    },
    run: (target) => importXPlaceProfile(target),
  });
}
