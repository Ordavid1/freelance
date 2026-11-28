import 'server-only';
import { featureEnabled, type RuntimeFeature } from '@/lib/security/runtime-switch';
import { requiredFeatures } from './registry';

/**
 * The runtime features that are on right now, for every feature a registry page requires (`SeoPage.requiresFeature`).
 * Pass it to `indexablePages(...)`, `footerGroups(...)`, `llmsTxt(...)` and `llmsFullTxt(...)`: a page behind a switch that is off
 * is then left out of every list, exactly as its route answers 404. The features are read from the registry, not listed here.
 */
export async function servedFeatures(): Promise<ReadonlySet<RuntimeFeature>> {
  const features = requiredFeatures();
  const states = await Promise.all(features.map((feature) => featureEnabled(feature)));
  return new Set(features.filter((_, index) => states[index]));
}
