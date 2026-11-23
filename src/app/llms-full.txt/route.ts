import { indexableHeadhunterPages } from '@/lib/seo/headhunters';
import { indexingEnabled } from '@/lib/seo/site';
import { llmsFullTxt, llmsResponse } from '@/lib/seo/llms';
import { route } from '@/lib/security/policy';
// Product facts depend on runtime configuration (billing availability), so this is rendered per request.
export const dynamic = 'force-dynamic';
export const GET = route('seo.llmsFull', {}, async () => {
  // The agency section is advisory: when it cannot be read, the rest of the file is still served without it.
  const agencies = !indexingEnabled() ? [] : await indexableHeadhunterPages().catch((error) => { console.error('Agency pages unavailable for llms-full', error instanceof Error ? error.name : 'Error'); return []; });
  return llmsResponse(llmsFullTxt(undefined, agencies));
});
