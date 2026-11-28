// Runtime switches for tests that load a surface reading `servedFeatures()` (sitemap, llms routes, footer): every switch is off
// unless the test turns it on, which is what a deployment without MCP_ENABLED looks like.
//   loadModule('src/app/sitemap.ts', { stubs: { ...switchStub(['mcp']) } })
export const switchStub = (on = []) => ({ '@/lib/security/runtime-switch': { featureEnabled: async (feature) => on.includes(feature) } });
