# Production Readiness Implementation Plan

> **For agentic workers:** Use this plan task by task. Keep production deployment gated until the launch checklist is met.

**Goal:** Replace the browser-only Freelance Zone prototype with authenticated, durable GCP-backed marketplace workflows and prepare a verified private Cloud Run release.

**Architecture:** Use Google Identity Platform/Firebase Authentication for email and Google sign-in, Firestore for user-owned marketplace records, and private Cloud Storage for user-uploaded source documents. Next.js server routes verify Firebase ID tokens from secure sessions, authorize every data operation, and use the Cloud Run service identity with least privilege. Vertex AI remains the only generative AI provider. Social profile imports use explicitly configured OAuth providers and scopes; public URL ingestion remains separate.

**Tech Stack:** Next.js 16 App Router, TypeScript, Firebase Admin SDK, Firebase client SDK, Firestore, Cloud Storage, Google Cloud Identity Platform, Cloud Run, Terraform, Vertex AI.

**Spec:** `PRODUCT_PLAN.md`; current gaps in `deploy/READINESS-AUDIT.md`.

## Global Constraints

- GCP project: `freelance-514118`; deployment region: `me-west1`.
- Use GCP service identity / ADC; never put service account keys in the repo, browser, GitHub secrets, or chat.
- Do not modify the project's billing account or billing attachment.
- Keep billing integration disabled until the owner selects a payment provider; membership UI must not imply a charge or active subscription.
- Keep all generative AI on Vertex AI and require a user to approve generated profile/project content before publication.
- Keep private uploads private, validate type and size, and enforce user ownership in server-side routes and storage rules.
- Do not enable public Cloud Run access or deploy to production until authentication, authorization, privacy behavior, domain, and smoke checks pass.
- Main-branch pushes trigger the production deployment workflow; use the existing review branch until explicit release approval.

## Review Focus

- Unauthenticated or cross-user access to profiles, proposals, messages, uploads, and projects must be rejected.
- OAuth callback mismatch, replay, CSRF, and untrusted redirect input must not create sessions or leak provider tokens.
- Oversized, malformed, unsupported, or hostile uploaded files/URLs must fail safely and never become public profile claims automatically.
- Missing provider configuration or Vertex access must fail closed with a useful error, never silently produce demo content.
- Duplicate submissions, stale sessions, and partial writes must not create inconsistent proposals or conversations.

## File Structure

- `infra/terraform/main.tf`: service APIs, Firestore database, private uploads bucket, runtime roles, and Identity Platform configuration where supported.
- `src/lib/auth/`: server session verification, client auth setup, and authorization helpers.
- `src/lib/db/`: typed Firestore access functions by entity; no direct client-side privileged access.
- `src/app/api/auth/`: sign-in/session/logout handlers and OAuth callback handlers only for approved providers.
- `src/app/api/marketplace/`: authenticated project, bid, profile, and conversation handlers.
- `src/app/api/uploads/`: authenticated signed upload/download flow with size/type/ownership checks.
- `src/components/`: replace demo identity and local-only action feedback with session-aware UI and real API calls.
- `deploy/READINESS-AUDIT.md`: update only after each corresponding proof exists.
- `.gitignore`, `.dockerignore`, `.gcloudignore`: exclude local secrets, generated output, Terraform state/plans, and irrelevant build context while retaining lockfiles and source templates.

---

### Task 1: Confirm provider, data-region, and production-origin inputs

**Files:**
- Modify: `deploy/READINESS-AUDIT.md`
- Modify: this plan

**Interfaces:**
- Consumes: owner-approved email and Google sign-in; GCP project `freelance-514118`.
- Produces: confirmed Identity Platform/Firebase project path, supported data location, canonical production origin, Google OAuth client configuration, and explicit third-party social providers/scopes (if any).

- [ ] Verify supported Firestore and Cloud Storage locations and the chosen location's implications for user profile/CV data.
- [ ] Record the canonical origin and exact callback URLs after routes exist; do not infer from the placeholder domain.
- [ ] Identify where OAuth client secrets will be provisioned in Secret Manager; never request them in chat.
- [ ] Leave billing account and billing integration untouched.

### Task 1a: Keep repository and build inputs clean

**Files:**
- Modify: `.gitignore`
- Modify: `.dockerignore`
- Modify: `.gcloudignore`
- Modify: `deploy/README.md`
- Modify: `deploy/STATUS.md`
- Modify: `package.json` to expose a valid Next.js 16 type-check command and remove obsolete CLI commands

**Interfaces:**
- Consumes: current repository source tree and deployment workflow.
- Produces: a clean tracked tree and build contexts that exclude secrets, generated output, local state, and irrelevant files.

- [ ] Check tracked files for secrets, local environment files, Terraform state/plans/caches, generated Next.js output, and build artifacts.
- [ ] Verify ignore rules cover nested local state and variable files while retaining `.env.example` and Terraform provider lockfiles.
- [ ] Remove stale deployment status text and ensure the documented commands still match the current repository and CLI; Next.js 16 does not expose `next lint`.
- [ ] Inspect `git diff --check` and the final tracked/untracked file list; don't remove or rewrite unrelated user files.

### Task 2: Provision GCP identity and data foundation

**Files:**
- Modify: `infra/terraform/main.tf`
- Modify: `infra/terraform/variables.tf`
- Modify: `infra/terraform/outputs.tf` (create if needed)
- Test: `infra/terraform` validation and reviewed plan

**Interfaces:**
- Consumes: Task 1 approved project services, region, Identity Platform configuration, and storage location.
- Produces: managed auth/data resources, private upload bucket, narrowly scoped runtime roles, and outputs consumed by the application.

- [ ] Add required APIs and Terraform-managed Firestore/database and private uploads bucket with uniform access, public access prevention, retention/lifecycle policy, and deletion protection where appropriate.
- [ ] Configure Identity Platform/Firebase Authentication for approved email and Google providers without changing billing attachment.
- [ ] Grant the Cloud Run runtime identity only required Firestore, Storage, Vertex, and Secret Manager access.
- [ ] Run Terraform format, validate, inspect the complete plan, and apply only the approved resources; confirm zero billing-account changes.

### Task 3: Implement authentication and session authorization

**Files:**
- Create: `src/lib/auth/*`
- Create: `src/app/api/auth/*`
- Modify: `src/app/layout.tsx`
- Modify: `src/components/marketplace.tsx`
- Create: sign-in UI under `src/app/`
- Test: auth/session/authorization unit and route tests

**Interfaces:**
- Consumes: Task 2 identity configuration; Firebase client token exchange.
- Produces: `getCurrentUser(): Promise<AuthenticatedUser | null>`, server-verified session cookie, and sign-in/sign-out UI.

- [ ] Implement email and Google sign-in, email verification behavior, secure HttpOnly session cookies, logout, expiry, and CSRF-safe session exchange.
- [ ] Add server authorization helpers; protect all member actions and AI routes, keeping only approved public read routes anonymous.
- [ ] Replace hard-coded “אור דוד” identity/avatar with verified account data and a real account menu.
- [ ] Verify missing/malformed/expired sessions return 401/redirect without disclosing protected data.

### Task 4: Add durable marketplace records

**Files:**
- Create: `src/lib/db/*`
- Create: `src/app/api/marketplace/*`
- Modify: `src/lib/data.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/components/actions.tsx`
- Modify: `src/components/studio-tools.tsx`
- Test: database repository and route ownership tests

**Interfaces:**
- Consumes: Task 3 `getCurrentUser()` and Task 2 Firestore.
- Produces: authenticated project/profile/proposal/conversation repository functions with owner-scoped reads and writes.

- [ ] Define typed records, indexes, status transitions, ownership rules, and server-side validation for projects, profiles, proposals, saved projects, and conversations/messages.
- [ ] Seed demo content only as explicit read-only sample data; keep sample users and actions visibly separate from real marketplace records.
- [ ] Replace browser-local writes and hard-coded conversation/proposal flows with authenticated API calls and durable state.
- [ ] Add idempotency/duplicate-submit protection for project publishing and proposal submission.

### Task 5: Add private document storage and profile source workflow

**Files:**
- Create: `src/app/api/uploads/*`
- Modify: `src/components/profile-studio.tsx`
- Modify: `src/app/api/ai/profile/route.ts`
- Modify: `infra/terraform/main.tf`
- Test: upload authorization, bounds, and deletion tests

**Interfaces:**
- Consumes: Task 3 authenticated user and Task 2 private uploads bucket.
- Produces: short-lived signed upload/download operations, user-owned source metadata, and deletion path.

- [ ] Restrict uploads to approved formats, enforce per-file and per-user quotas server-side, inspect content type/signature, and use opaque object names.
- [ ] Keep CV/portfolio imports private by default, record consent and source provenance, and provide deletion controls.
- [ ] Require authentication and rate limits before profile AI processing; validate supplied public URLs against SSRF, redirects, DNS rebinding, and response-size risks.
- [ ] Persist only user-approved profile fields; never expose extracted claims before explicit approval.

### Task 6: Implement approved social OAuth connections

**Files:**
- Create: `src/app/api/connections/*`
- Create: `src/lib/oauth/*`
- Modify: `src/components/profile-studio.tsx`
- Modify: `deploy/README.md`
- Test: OAuth state/PKCE/callback validation tests

**Interfaces:**
- Consumes: Task 1 approved provider list, canonical origin, client IDs/secrets; Task 3 authenticated sessions.
- Produces: per-user encrypted provider grants, scoped source imports, revocation/disconnect behavior.

- [ ] Implement only providers for which the owner has supplied approved credentials and scopes; do not claim URL entry is OAuth authorization.
- [ ] Use state and PKCE where supported, exact redirect URI matching, strict redirect allowlists, and server-side token storage.
- [ ] Request minimum read scopes, display imported fields and provenance for review, and support disconnect/token revocation/deletion.
- [ ] Keep a provider disabled when API access/scopes are unavailable; public URL ingestion remains an independent path.

### Task 7: Prepare and verify private Cloud Run release

**Files:**
- Modify: `infra/terraform/main.tf`
- Modify: `deploy/engine.Dockerfile`
- Modify: `.github/workflows/deploy.yml`
- Modify: `deploy/READINESS-AUDIT.md`
- Test: CI build, container startup, authenticated smoke checks

**Interfaces:**
- Consumes: Tasks 1–6 and runtime configuration/secrets provisioned without exposing values.
- Produces: immutable verified image and private Cloud Run revision with deployment/rollback evidence.

- [ ] Wire only secret references and nonsecret runtime configuration; keep model ID and database/storage identifiers explicit.
- [ ] Ensure unauthenticated invocations are denied at Cloud Run until the approved auth boundary is verified.
- [ ] Run `npm ci`, `npm run build`, tests, and container smoke checks; confirm startup/readiness and logs.
- [ ] Build and deploy a digest-pinned image to a private Cloud Run service; verify sign-in, data ownership, profile import, Vertex requests, and error paths.
- [ ] Do not merge to `main`, expose public traffic, or enable billing until the owner explicitly approves that release step.

## Open owner inputs

- Canonical production domain/origin and DNS access.
- Whether data must remain in a specific country/region; this determines Firestore and Storage locations.
- Google OAuth web client configuration and Secret Manager path to use for the client secret.
- Which third-party profile connections are actually wanted (for example LinkedIn, GitHub, Dribbble, Behance) and which API access/scopes the owner has approved.
- Billing provider and tax/receipt requirements remain undecided; billing stays disabled and the existing GCP billing account is not to be modified.
- A repository hygiene review must verify that ignore patterns cover nested Terraform caches/state, local variable files, generated Next.js/build output, credentials, and OS/editor noise; ignore rules do not remove files already committed.

