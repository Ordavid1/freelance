import { ImportError } from '@/lib/imports/errors';
import { importXPlaceProject } from '@/lib/imports/xplace';
import { handleImportRoute, importGate, withPublisherCrossReference } from '@/lib/imports/xplace/pipeline';
import { parseXPlaceUrl } from '@/lib/imports/xplace/urls';
import { route } from '@/lib/security/policy';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Link import (secondary path, behind XPLACE_LINK_IMPORT_ENABLED): the server reads one pasted public project page.
export const POST = route('import.xplace.project', { gate: () => importGate('link'), body: { type: 'json', maxBytes: 2_000 }, deferBudgets: true }, ({ user, body, charge }) =>
  handleImportRoute({ user, body, charge }, {
    kind: 'project', source: 'link',
    prepare: (payload) => {
      const target = parseXPlaceUrl(payload.url);
      if (!target || target.kind !== 'project') throw new ImportError('INVALID_URL');
      return { canonicalUrl: target.canonicalUrl, logUrl: target.fetchUrl, input: target };
    },
    run: async (target, importer) => withPublisherCrossReference(await importXPlaceProject(target), importer),
  }));
