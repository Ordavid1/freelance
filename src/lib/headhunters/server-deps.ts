import 'server-only';
import { getHeadhunterByHandle, getHeadhunterConfig, isAccountActive } from '@/lib/db/headhunters';
import { getHeadhunterProjects } from '@/lib/db/projects';
import type { MinisiteDeps } from './minisite';

/** The server bindings of `resolveMinisite`, shared by the minisite page and its share image so they cannot diverge. */
export const minisiteDeps: MinisiteDeps = {
  enabled: async () => (await getHeadhunterConfig()).enabled,
  lookup: getHeadhunterByHandle,
  accountActive: isAccountActive,
  projects: getHeadhunterProjects,
};
