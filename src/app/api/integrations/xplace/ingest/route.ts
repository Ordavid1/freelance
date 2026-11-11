import { buildPastedProfileImport, buildProfileImport, buildProjectImport, validateIngestPayload } from '@/lib/imports/xplace/ingest';
import { handleImportRoute, withPublisherCrossReference } from '@/lib/imports/xplace/pipeline';

export const runtime = 'nodejs';

// Primary path: payloads captured by the browser extension on the user's own XPlace page (or profile text the user
// pasted). No network access. The payload is untrusted: it is re-validated, cleaned and capped before anything is built.
export async function POST(request: Request) {
  return handleImportRoute(request, {
    kind: 'ingest', source: 'ingest', maxBodyBytes: 300_000, action: 'import.xplace.ingest',
    unauthenticatedMessage: 'יש להתחבר כדי לייבא מ־XPlace.',
    prepare: (body) => {
      const valid = validateIngestPayload(body.payload);
      return { canonicalUrl: valid.canonicalUrl, kind: valid.kind, input: valid };
    },
    run: async (valid, user) => {
      if (valid.kind === 'profile') return buildProfileImport(valid);
      if (valid.kind === 'profile-text') return buildPastedProfileImport(valid);
      return withPublisherCrossReference(buildProjectImport(valid), user);
    },
  });
}
