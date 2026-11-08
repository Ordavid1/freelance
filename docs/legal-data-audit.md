# Legal page evidence and release record

Research date: 8 November 2026. Application baseline: `eb2e6c1` on `app/deployment-readiness`. Pages: `/privacy` and `/terms`, in Hebrew to match the product. The user confirmed the operator as **Or David AI Assimilation Services (Or David)** and the monitored legal/privacy address as **or@ailead.work**. No postal address, company registration number, DPO, or legal-review certification was supplied; none is invented. No paid checkout exists, so the terms explicitly require the legally required trader details and transaction disclosures before any future sale.

## Source review

All application routes, components, libraries, configuration, deployment workflow, Terraform resources, package manifest, product plan, and existing readiness audit were inspected. Product plans and historical status documents are not treated as proof of implemented behavior. In particular, some deployment documents still say conversations are not durable, while the current code implements Firestore conversation/message reads and writes.

| Area | Evidence | Policy consequence |
| --- | --- | --- |
| Identity | `src/components/sign-in-form.tsx`, `src/lib/auth/firebase-client.ts`, `src/app/api/auth/session/route.ts` | Email/password go to Firebase/Identity Platform; verified email required for a server session. Google login is conditional on its runtime flag/provider setup. Client auth uses in-memory persistence. No claim that Google OAuth is currently configured. |
| Cookies | `src/lib/auth/session.ts`, `src/app/api/auth/csrf/route.ts` | `fz_session`: 5 days; `fz_csrf`: 10 minutes and cleared after session creation/logout; HttpOnly, SameSite=Lax, Secure in production. Logout is not account deletion or global session revocation. |
| Profile | `src/app/api/marketplace/profile/route.ts` | Owner-only GET/PUT of name, headline, bio, portfolio, experience, education and skills in `profiles/{uid}`. No public profile directory is implemented. No automatic profile publication promise. |
| Uploads | `src/components/profile-studio.tsx`, `src/app/api/uploads/profile-source/route.ts` | Choosing/dropping a file immediately uploads it. Up to 5 stored files, 8 MiB each / 40 MiB total. Private object content and source metadata retained separately. UI deletion removes the live source record; storage versions/soft deletion require qualified retention wording. |
| AI | `src/app/api/ai/profile/route.ts`, `src/app/api/ai/project-brief/route.ts`, `src/lib/ai.ts` | Authenticated requests to Vertex AI with source files, social source text, URLs and URL Context, or project seed text. Profile editor checkbox is a UI processing choice, not a durable consent ledger. Up to 24 MiB source files per AI request. Production fails when Vertex is unconfigured. No claim of zero provider retention, exclusive Israeli processing, output accuracy, or custom model training. |
| Social connections | `src/app/api/integrations/nango/*/route.ts`, `src/lib/integrations/nango.ts`, `src/components/profile-studio.tsx` | Nango receives Firebase UID/email tags and manages OAuth tokens. Imports refresh on opening the editor. GitHub public identity and up to 20 public repository metadata entries; LinkedIn userinfo fields depend on scopes. No claim of private repository, private employment history, or automatic access to restricted websites. |
| Disconnect | `connections/route.ts` DELETE | Requests deletion at Nango, not provider OAuth revocation or deletion of previously saved profile fields. Corrected the editor's previous claim that permission was removed. Provider settings remain a separate revocation path. |
| Public projects | `src/app/api/marketplace/projects/route.ts`, `src/lib/db/projects.ts` | Public unauthenticated listing exposes title, description, skills, budget, deadline, client display name and proposal count. Client name can derive from the email prefix. Explicit publication warning and public search/cache disclosure. |
| Proposals | `src/app/api/marketplace/proposals/route.ts` | Proposal records include participant UIDs/names, ILS price/type, delivery text, message and timestamps. Owner may view proposals; sender may view their submissions. Submission creates a participant conversation and initial message. No escrow, hiring, signing or payment workflow is implied. |
| Conversations | `src/app/api/marketplace/conversations/route.ts`, `src/components/studio-tools.tsx` | Server-stored participant messages, names, timestamps and last-message summaries; authorization checks on reads/writes. Not end-to-end encrypted. No claim that the operator or infrastructure cannot access content. |
| Saved/search | `saved-projects/route.ts`, `src/app/page.tsx`, `src/components/project-explorer.tsx` | Primary UI saves project IDs in Firestore. Query/skill filtering is browser-side. Secondary explorer retains `fz-saved` localStorage; acknowledge legacy local data without claiming the new account data is browser-only. |
| Payments | `src/app/membership/page.tsx`, home membership panel | No payment provider, checkout, card collection, invoices, renewals, active subscription or cancellation flow. ILS 19.99 is planned/demo pricing; no retrospective charge authority. |
| Analytics/fonts | Whole-source searches, `src/app/layout.tsx`, package manifest | No application analytics/ad pixel/marketing newsletter integrations. `next/font/google` bundles fonts at build time. Do not confuse Next.js build telemetry with visitor analytics. Provider authentication flows can have their own storage. |
| Removal | Entire route inventory | Source delete, saved-project removal, editable profile fields and connection disconnect exist. No complete account deletion/export/retention scheduler or project/proposal/message deletion UI exists. Requests go to the confirmed email; no invented dashboard or guaranteed instant erasure. |

## Live infrastructure metadata checks

Read-only Google APIs, no customer rows, document contents, secret values, or logs were read:

- Cloud Run in `me-west1`: no service at the initial inspection.
- Firestore `(default)`: `me-west1`, point-in-time recovery disabled at inspection.
- User source bucket: `me-west1`, versioning enabled, lifecycle deletes archived versions whose object age is at least seven days, soft-delete retention 604800 seconds (7 days). This does **not** expire live files after seven days. Cleanup is asynchronous; neither a seven-day nor a fourteen-day complete-erasure promise is made.
- Cloud Logging `_Default`: 30-day retention; `_Required`: 400-day retention. Does not imply every record contains every category of personal information or that request bodies are logged.
- Vertex runtime configuration uses `global`; regional database/storage does not prove regional AI/auth/integration processing.
- `freelance-place.com` still served Squarespace when initially inspected. Website DNS must be migrated only to an actually provisioned target, preserving unrelated email/domain-connect records.

## External primary sources consulted

- [Israel Privacy Protection Authority: collection notices](https://www.gov.il/he/pages/duty_to_notify): current search-index text describes voluntary/required provision, consequences, purposes, controller identity/contact, recipients, and access/correction rights. Direct retrieval returned 403; this limitation is recorded rather than treated as a fully retrieved document.
- [PPA: Amendment 13 professional guide](https://www.gov.il/he/pages/guide_tikon13_professional) and [PPA: database-controller duties](https://www.gov.il/he/pages/manager_duties): identify the applicable Israeli privacy framework without asserting certification or global GDPR/CCPA applicability.
- [Google Cloud generative AI data governance](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance): training restrictions do not establish zero retention; caching and abuse-monitoring conditions matter. Global endpoint does not guarantee Israeli data residency.
- [Nango security and retention](https://nango.dev/docs/guides/platform/security): connection deletion has separate soft/hard-deletion stages; log/audit retention is separate. Do not promise immediate token/data erasure everywhere.

The policies use original wording, avoid blanket consent and waivers, preserve mandatory consumer/privacy rights, and describe actual features rather than selling future capabilities. They do not claim to be a legal opinion or to have received independent counsel approval.

## Maintenance triggers

The concurrent profile-started trial implementation (`46e80d6`, reviewed with `cf0742f`) was reconciled before the final legal-page rollout. The privacy policy now covers `profiles.profileType`, publisher/business names, account-creation-time eligibility checks, `memberships/{uid}` state and trial start/end timestamps, and retained data after expiry. The terms explain the 14-day trigger, non-reset behavior, restricted actions after expiry, and the absence of available checkout/automatic billing. Relevant evidence: `src/lib/membership/{access,state}.ts`, `src/app/api/marketplace/{profile,access}/route.ts`, `src/components/publisher-profile-setup.tsx`, and `src/components/trial-status.tsx`. Dribbble's new setup document records an unavailable provider; there is still no implemented Dribbble OAuth flow, so the public-URL disclosure remains accurate.

Revisit both pages and point-of-collection notices before enabling billing/renewals, public profile discovery, new analytics/marketing, additional providers/scopes, AI training, a different processing region, a new retention schedule, self-service account deletion, or a material audience/operator change. Update the effective date deliberately. The legal footer is global; sign-in and the upload/AI editor have contextual policy links.

## Validation and deployment

- `npm run typecheck`, `npm run build`, Terraform formatting/validation and `git diff --check` passed.
- Chromium checks at 390px and 1440px passed: legal routes return 200, Hebrew/RTL, section anchors, canonical URLs, contact links, no document overflow, footer navigation and sign-in notices. Final-build checks also exercised the upload notice link and sitemap entries. Screenshots were visually inspected.
- [PR #2](https://github.com/Ordavid1/freelance/pull/2) merged to main at `756f05a664b19365a7860074d2e01b1ed001445f`. Its application tree matches image source commit `5b6e853d1edc51de4cf20d7126b23b861f33c5b3`.
- Cloud Build `ca2e5e97-1aeb-422b-8ee6-7920ccde824c` succeeded and pushed the immutable image listed in `deploy/LEGAL-RELEASE.md`. This validates the production container build; it does not establish that the website is live.
- The first-release Terraform plan has 14 additions, one Firebase display-name update and no deletions. The cloud identity's IAM permission test returned no `run.services.setIamPolicy`, `storage.buckets.setIamPolicy`, or `secretmanager.secrets.setIamPolicy` permissions. The existing GitHub deployment also fails while checking build-source bucket access. A bucket-scoped metadata-reader grant is prepared in Terraform.
- Public rollout is blocked pending an administrator's IAM/apply step, followed by DNS migration and HTTPS/live-route verification. No successful Cloud Run production deployment is claimed. See `deploy/LEGAL-RELEASE.md` for the exact release handoff.

Credentials and Terraform plans remain outside Git. No live customer records were accessed during this task.
