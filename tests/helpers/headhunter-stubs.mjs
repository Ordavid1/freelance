// Stub of '@/lib/db/headhunters' for tests of the project routes that do not exercise headhunters:
// the owner has no headhunter record, so nothing is counted and nothing is invalidated.
export const noHeadhunters = {
  readHeadhunterForCounter: async () => null,
  applyProjectCreated: () => null,
  invalidateAfterCounter: () => {},
};

// Stub of '@/lib/db/headhunters' for tests that load the real src/lib/db/projects.ts or the project page: the feature
// switch is off, so no project gets a tag and nothing is read.
export const headhunterTagsOff = {
  getHeadhunterConfig: async () => ({ enabled: false, applicationsOpen: false }),
  getPublicHeadhunters: async () => new Map(),
  getHeadhunterByHandle: async () => null,
  isAccountActive: async () => true,
};
