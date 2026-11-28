import { llmsResponse, llmsTxt } from '@/lib/seo/llms';
import { route } from '@/lib/security/policy';
import { servedFeatures } from '@/lib/seo/served';
// Product facts depend on runtime configuration (billing availability), so this is rendered per request.
export const dynamic = 'force-dynamic';
export const GET = route('seo.llms', {}, async () => llmsResponse(llmsTxt(undefined, await servedFeatures())));
