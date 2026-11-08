# Profile-Started Trial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add read-only discovery preview, a profile-triggered 14-day full-access trial, and clear ₪19.99/month membership states without collecting payment.

**Architecture:** Persist account membership state in Firestore and compute access server-side from the trial timestamps. Add a single access endpoint and shared authorization helper; enforce it in marketplace APIs and display the same state in onboarding, profile, and membership UI. Profile completion starts one account-wide trial; freelancer setup requires a name, a tagline or summary, and one skill, while hiring-side setup requires only a name or business name.

**Tech Stack:** Next.js 16 App Router, React 19, Firebase Admin Authentication, Firestore, TypeScript.

**Spec:** `docs/superpowers/specs/2026-11-08-profile-trial-gate-design.md`

## Global Constraints

- Keep public project/profile discovery read-only before profile completion.
- Start exactly one 14-day account-wide trial on completed role-appropriate profile save.
- Show ₪19.99/month clearly; do not collect payment or claim billing is available.
- Leave accounts created before the trial rollout unchanged.
- Keep hiring-side setup to name/business name; do not require a CV or long bio.
- Keep freelancer-generated profile content editable and require a name, headline or bio, and at least one skill to start the trial.
- Enforce access in server routes, not only in UI.

## Review Focus

- A profile save retried concurrently must not create multiple trials or extend `trialEndsAt`.
- A forged browser role or trial date must not unlock member actions.
- Trial expiry must be consistent across page state and every protected API.
- Accounts that predate rollout must preserve existing access.
- Profile-source upload and import must remain usable before the trial so freelancer setup can be completed.

---

### Task 1: Persist membership state and expose access status

**Files:**
- Create: `src/lib/membership/access.ts`
- Create: `src/app/api/marketplace/access/route.ts`
- Modify: `src/lib/auth/session.ts` only if a verified account creation timestamp is needed

**Interfaces:**
- `getMembershipAccess(uid: string)` returns `{ state: 'legacy' | 'preview' | 'trial' | 'expired' | 'active'; trialStartedAt: number | null; trialEndsAt: number | null; canUseMarketplace: boolean; canStartTrial: boolean }`.
- `requireMarketplaceAccess(uid: string)` returns the access object or a Hebrew 402 response payload for preview/expired accounts.
- Persist in `memberships/{uid}`. Never trust dates or membership claims from the browser.
- Determine pre-rollout eligibility from verified Firebase account creation time and a documented `MEMBERSHIP_TRIAL_ROLLOUT_AT` UTC setting; missing configuration uses the fixed release cutoff 2026-11-08T21:47:24Z; invalid configuration fails with a retryable error. Existing initialized records are never reclassified.

- [x] Define the Firestore state shape and timestamp conversion in `src/lib/membership/access.ts`.
- [x] Implement lazy initialization to `legacy` or `preview` from the verified Firebase account creation timestamp; preserve already initialized records.
- [x] Derive `expired` from the server clock when a stored trial has ended; do not extend the stored end timestamp.
- [x] Add `GET /api/marketplace/access` returning `no-store` access state for the authenticated user and 401 without a session.
- [x] Review that no response contains Firebase tokens, payment data, or writable client-controlled status.

### Task 2: Start trial from role-appropriate profile completion

**Files:**
- Modify: `src/app/api/marketplace/profile/route.ts`
- Modify: `src/components/profile-studio.tsx`
- Create: `src/components/publisher-profile-setup.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Store a validated `profileType: 'freelancer' | 'publisher'` in the profile.
- Freelancer completion is `name` plus (`headline` or `bio`) plus at least one `skill`.
- Publisher completion is `profileType === 'publisher'` and a non-empty name/business name.
- The first completed profile starts the trial in a Firestore transaction with server timestamps and a 14-day end time; saving later profile edits never resets it.

- [x] Add profile type validation and publisher name/business-name persistence to the profile PUT route.
- [x] Make profile save and trial start atomic; use the existing profile editor for freelancer completion.
- [x] Add a short publisher setup form with one name/business-name field and explicit save action.
- [x] Add role-specific setup links and a dismissible trial notice on the home dashboard for accounts in preview.
- [x] After a successful profile save, refresh the access display and show trial start/end dates.

### Task 3: Enforce preview, trial, and legacy access across marketplace APIs

**Files:**
- Modify: `src/app/api/marketplace/projects/route.ts`
- Modify: `src/app/api/marketplace/proposals/route.ts`
- Modify: `src/app/api/marketplace/conversations/route.ts`
- Modify: `src/app/api/marketplace/saved-projects/route.ts`
- Keep profile AI, upload, and Nango profile import routes available for profile setup

**Interfaces:**
- All protected routes use `requireMarketplaceAccess(uid)` from Task 1.
- Preview and expired responses return HTTP 402 with a stable code (`PROFILE_REQUIRED` or `MEMBERSHIP_REQUIRED`) and a Hebrew message.

- [x] Gate project listing with `mine=1` and project creation; keep public open-project listing readable.
- [x] Gate proposal list and submission.
- [x] Gate conversation list, conversation details, and sending messages.
- [x] Gate saved-project list and changes.
- [x] Preserve existing unauthenticated 401 behavior and object-ownership checks.
- [x] Confirm profile generation, source uploads/deletion, and Nango connect/import remain available before trial start.

### Task 4: Explain preview and membership states in the interface

**Files:**
- Create: `src/components/trial-status.tsx`
- Modify: `src/app/membership/page.tsx`
- Modify: `src/components/marketplace.tsx`
- Modify: `src/app/page.tsx`
- Modify: relevant action components in `src/components/actions.tsx` and `src/components/studio-tools.tsx`

- [x] Display “Build your profile to unlock 14 days of full access; then ₪19.99/month” with a direct profile setup action for preview accounts.
- [x] Show remaining trial time and trial end date while access is active.
- [x] Show an expired-membership view that keeps profile and membership available, explains that billing is not connected, and does not offer a fake checkout.
- [x] Disable or explain locked member actions in the UI while retaining API enforcement.
- [x] Verify public discovery remains usable in preview and role switching does not restart a trial.

### Task 5: Review and handoff

- [x] Inspect the final diff for accidental changes to existing untracked files and verify all trial paths use the shared access helper.
- [x] Run the focused membership-state tests, typecheck, and production build; live billing and real-user verification require configured services.
- [x] Keep this change separate from the subsequent Dribbble/Nango integration setup.

## Execution rulings

- The latest main extracted the workspace into `src/components/workspace-home.tsx`; apply workspace UI changes there.
- Use the fixed release UTC cutoff as the default instead of granting unrestricted access when an environment variable is absent. Never recompute this cutoff at startup.
- No billing-active state is accepted until a real payment integration can verify entitlement.

## Completion evidence

- Four focused tests pass: 14-day expiry boundary, preview/legacy access, malformed trials fail closed, and role-specific completion requirements.
- Typecheck and production build pass. The isolated worktree required a local dependency install because Turbopack rejects a node_modules symlink outside its root.
- An independent read-only review found no important issues. Firebase/Firestore transaction integration and live-user browser flows were not exercised.
- The new access endpoint, private reads, marketplace writes, and project-brief AI route use the shared server entitlement check. Profile AI/import/upload remain available for setup.
- Dribbble follow-on has a documented provider-support blocker and requires Dribbble sign-in; see `docs/nango-dribbble-setup.md`.
