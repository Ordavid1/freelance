// Stub of '@/lib/db/headhunters' for tests of the project routes that do not exercise headhunters:
// the owner has no headhunter record, so nothing is counted and nothing is invalidated.
export const noHeadhunters = {
  readHeadhunterForCounter: async () => null,
  applyProjectCreated: () => null,
  invalidateAfterCounter: () => {},
};
