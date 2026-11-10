import { llmsResponse, llmsTxt } from '@/lib/seo/llms';
// Product facts depend on runtime configuration (billing availability), so this is rendered per request.
export const dynamic = 'force-dynamic';
export function GET() {
  return llmsResponse(llmsTxt());
}
