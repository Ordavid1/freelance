# MCP for Freelance Place: research and platform plan

Date: 23-11-26. Status: plan for Or's review, no code written.

The full plan (competitor research for Upwork, Fiverr and Freelancer.com; repo findings; tool/scope design; abuse, privacy and spam-law notes; hosting fit; SEO/AEO; phased roadmap; open decisions) is maintained in the project's shared folder at `plans/23-11-26-MCP-Platform.md` and is the source of truth while the plan is under review. It will be copied here in full once Or has settled the open decisions.

## Summary

1. **Competitors.** Upwork has an official hosted MCP (`mcp.upwork.com/mcp`, OAuth 2.1 with dynamic client registration, all-or-nothing scopes, draft-then-confirm writes, binding money actions finished on the website, free). Fiverr has an official hosted connector (`mcp.fiverr.com/mcp`, 7 buyer-side tools, browsing without sign-in, checkout on fiverr.com, plus its Mira AI intake agent). No official Freelancer.com MCP was found (unverified); only community servers using a personal token and no confirmation layer.
2. **Repo blockers.** Auth is cookie-only (Firebase session, Google provider, same-origin writes); business logic sits inside route handlers; routes return raw Firestore documents; no anonymous rate limiter; Terms and Privacy do not cover AI agents. Fix at the root: a shared service layer plus DTOs, an OAuth 2.1 authorization server, and granular scopes.
3. **Design.** Tier 0 public read-only (projects, categories, platform facts, agency minisites); Tier 1 signed-in reads; Tier 2 writes with two-step payload-bound confirmation; Tier 3 headhunter tools. No cold-outreach tool, no freelancer directory, no payments through MCP, showcase projects never exposed.
4. **Roadmap.** Phase 0 foundations, Phase 1 public MCP, Phase 2 OAuth and authenticated reads, Phase 3 confirmed writes, Phase 4 headhunter and growth.
5. **Open decisions for Or:** endpoint location (`/mcp` path vs `mcp.` subdomain, an infra change), build vs buy the authorization server, write-confirmation model, anonymous public tier, client allowlist, legal review, membership interplay, headhunter scope, connector name.
