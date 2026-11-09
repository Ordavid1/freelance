# Dribbble OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add direct, read-only Dribbble OAuth to the profile importer while keeping the access token ephemeral and the existing GitHub and LinkedIn Nango flows intact.

**Architecture:** Next.js Route Handlers initiate Dribbble OAuth, validate a session-bound state on callback, exchange the code server-side, fetch the user's profile and up to 20 public shots, and persist only a normalized snapshot in that user's Firestore subcollection. ProfileStudio loads/removes that snapshot through authenticated routes and submits it to profile generation only with the existing user consent. Terraform maps the client ID and Secret Manager-backed client secret into the runtime but is not applied.

**Tech Stack:** Next.js 16 Route Handlers, TypeScript, Firebase Admin Auth/Firestore, Dribbble OAuth 2.0 API, Google Secret Manager/Cloud Run Terraform.

**Spec:** `docs/superpowers/specs/2026-11-09-dribbble-oauth-design.md`

## Global Constraints

- Request only Dribbble's `public` OAuth scope; never request `upload`.
- Never persist the Dribbble access token or expose client credentials to the browser.
- Bind OAuth state to the signed-in Firebase UID in a short-lived HTTP-only cookie; use this state/session check for the cross-site provider callback and enforce same-origin on the destructive import-removal route.
- Store and return Dribbble data only under `users/{uid}/profileSources/dribbble` after verifying the owner UID.
- Treat provider text as untrusted: remove HTML, bound field lengths and shot count, and avoid logging authorization codes or tokens.
- Do not modify the existing GitHub/LinkedIn Nango flow, apply Terraform, deploy, or update Dribbble application settings.
- Do not add or run tests unless requested; use typecheck/build and focused manual review only.

## Review Focus

- Mismatched, missing, expired, or cross-user OAuth state must stop before token exchange; inspect callback branches and cookie handling.
- Missing OAuth configuration and Dribbble error responses must not leak codes, tokens, or raw provider messages; inspect redirects and error responses.
- HTML or oversized profile/shot content must be normalized and capped before Firestore persistence and model submission; inspect normalizer and AI source validation.
- A different Firebase user must not read/delete another user's import; inspect UID-scoped references and owner checks.
- User denial, callback failure, refresh-by-reconnect, and local import removal must leave UI source state accurate; inspect each corresponding UI transition.

---

### Task 1: Dribbble OAuth routes and snapshot persistence

**Files:**
- Create: `src/lib/integrations/dribbble.ts`
- Create: `src/app/api/integrations/dribbble/connect/route.ts`
- Create: `src/app/api/integrations/dribbble/callback/route.ts`
- Create: `src/app/api/integrations/dribbble/route.ts`

**Interfaces:**
- `dribbble.ts` exports server-only configuration lookup, state-cookie helpers/constants, a safe text normalizer, `fetchDribbbleImport(accessToken)` and `exchangeDribbbleCode(code)`.
- `GET /api/integrations/dribbble/connect` requires a signed-in user and redirects to Dribbble with `client_id`, the configured exact callback URI, `scope=public`, and random `state`; it sets a 10-minute HTTP-only, same-site cookie that binds state to the current UID.
- `GET /api/integrations/dribbble/callback` validates the cookie, state, and same signed-in UID; exchanges the code; fetches `/v2/user` and `/v2/user/shots?per_page=20`; stores the normalized snapshot in `users/{uid}/profileSources/dribbble`; drops the token; and redirects to `/profile/import` with a non-sensitive result flag.
- `GET /api/integrations/dribbble` returns only the current user's stored normalized import. `DELETE` requires same origin and deletes only that user's import document.

- [x] **Step 1: Add the server-only Dribbble helper** with configuration checks for `DRIBBBLE_CLIENT_ID`, `DRIBBBLE_CLIENT_SECRET`, and `DRIBBBLE_REDIRECT_URI`; implement URL-encoded code exchange and bearer-authenticated read-only API calls.
- [x] **Step 2: Implement connect and callback Route Handlers** with random state, a UID-bound short-lived HTTP-only cookie, session/state verification (including the cross-site callback), bounded normalized profile/shot data, no token persistence, and safe redirect result flags.
- [x] **Step 3: Implement UID-scoped snapshot GET/DELETE handlers** using `firestore()` and an `ownerUid` check before returning or deleting the document.
- [x] **Step 4: Run `npm run typecheck`** and manually review the OAuth and Firestore ownership paths against the Review Focus items.

### Task 2: Profile editor and profile-generation source

**Files:**
- Modify: `src/components/profile-studio.tsx`
- Modify: `src/app/api/ai/profile/route.ts`

**Interfaces:**
- Keep the `SocialProvider` union and Nango session/import/disconnect logic limited to `github | linkedin`.
- Add a Dribbble-specific imported-source shape with normalized `sourceText`, profile fields, public profile URL, and shot links.
- `GET /api/integrations/dribbble` returns `{ import: { provider: 'dribbble', sourceText, profile, url } | null }`; `DELETE` returns `{ ok: true }`. There is no `connectionId` because the access token is discarded and the saved record is an import snapshot.
- On editor load, fetch the current user's Dribbble snapshot; connect by navigating to the Dribbble connect route; remove it through the Dribbble DELETE route.
- Add Dribbble source text to the existing `socialSources` submission, allow only `github | linkedin | dribbble`, and preserve the existing generation consent gate.
- Replace the Dribbble manual-URL button with the OAuth import control; leave Behance and Website manual URL inputs intact. Label removal as removing imported data, not revoking Dribbble authorization.

- [x] **Step 1: Extend ProfileStudio state and loading** to reload the Dribbble snapshot and display the returned profile/shot summary alongside the existing social import cards.
- [x] **Step 2: Add connect, result, and remove interactions**; use redirect status flags to show a localized success/denial/failure message and retain current Nango behavior for GitHub/LinkedIn.
- [x] **Step 3: Extend profile generation validation** to accept bounded Dribbble source text and include Dribbble in the source instruction only when submitted through the existing consent-gated action.
- [x] **Step 4: Run `npm run typecheck`** and manually review reload, denial, removal, and consent states.

### Task 3: Runtime configuration and operator instructions

**Files:**
- Modify: `.env.example`
- Modify: `infra/terraform/variables.tf`
- Modify: `infra/terraform/main.tf`
- Modify: `deploy/README.md`
- Create: `docs/dribbble-profile-import.md`

**Interfaces:**
- Local runtime configuration uses `DRIBBBLE_CLIENT_ID`, `DRIBBBLE_CLIENT_SECRET`, and `DRIBBBLE_REDIRECT_URI`; do not prefix credentials with `NEXT_PUBLIC_`.
- Terraform accepts a non-secret client ID and an optional existing Secret Manager secret name/version for the Dribbble client secret; the runtime service account receives access only to that secret and Cloud Run receives it through a secret reference.
- Documentation gives the exact callback pattern `https://<canonical-domain>/api/integrations/dribbble/callback`, the minimum `public` scope, secret rotation/storage steps, and notes that deployment, applying Terraform, and changing the Dribbble app callback remain operator actions.

- [x] **Step 1: Add example runtime variables and Terraform inputs** for Dribbble client ID, callback URI derived from the canonical domain, Secret Manager secret name/version, least-privilege runtime IAM, and Cloud Run secret environment mapping.
- [x] **Step 2: Document OAuth app setup and data handling** including callback registration, rotated client secret storage, read-only scope, snapshot refresh/removal behavior, and the required later operator actions.
- [x] **Step 3: Run `npm run typecheck` and `npm run build`**; inspect the Terraform diff for configuration correctness without applying it.
