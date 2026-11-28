import { buildPastedProfileImport, buildProfileImport, buildProjectImport, validateIngestPayload } from '@/lib/imports/xplace/ingest';
import { handleImportRoute, importGate, withPublisherCrossReference } from '@/lib/imports/xplace/pipeline';
import { route } from '@/lib/security/policy';

export const runtime = 'nodejs';

// Primary path: payloads captured by the browser extension on the user's own XPlace page (or profile text the user
// pasted). No network access. The payload is untrusted: it is re-validated, cleaned and capped before anything is built.
export const POST = route('import.xplace.ingest', { gate: () => importGate('ingest'), body: { type: 'json', maxBytes: 300_000 }, deferBudgets: true }, ({ user, body, charge }) =>
  handleImportRoute({ user, body, charge }, {
    kind: 'ingest', source: 'ingest',
    prepare: (payload) => {
      const valid = validateIngestPayload(payload.payload);
      return { canonicalUrl: valid.canonicalUrl, kind: valid.kind, input: valid };
    },
    run: async (valid, importer) => {
      if (valid.kind === 'profile') return buildProfileImport(valid);
      if (valid.kind === 'profile-text') return buildPastedProfileImport(valid);
      return withPublisherCrossReference(buildProjectImport(valid), importer);
    },
  }));
