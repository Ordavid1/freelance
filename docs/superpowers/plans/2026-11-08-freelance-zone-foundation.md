# Freelance Zone — First Working Foundation

## Goal

Build a responsive Hebrew-first marketplace prototype that demonstrates the first key journeys: discover and inspect projects, draft/publish a project, import and review a freelancer profile, use project-linked messages, and understand membership. Public project routes must render meaningful SEO metadata. AI drafting must be routed server-side through Vertex AI when configured and clearly labeled demo behavior otherwise.

## Decisions

- Next.js App Router, TypeScript, React, and plain CSS modules/global CSS; use server-rendered routes for public project detail and metadata.
- A compact RTL studio shell and opportunity-signal project cards carry the identity. Use Heebo + Space Grotesk, the palette in `PRODUCT_PLAN.md`, a single desktop sidebar, and four-item mobile bottom navigation.
- Demo listings and browser-local drafts make journeys explorable without authentication/database/payment integrations. Label prototype behavior in the UI; do not imply that a project or message was sent to a real user.
- Vertex adapter runs only on the server with `@google/genai`, ADC, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` (default `global`), and `VERTEX_MODEL_ID` (default `gemini-3.8-flash`). No silent mock fallback when configured Vertex calls fail.
- Profile import starts with PDF, TXT, and Markdown uploads plus public URLs through Vertex URL Context; document source labels accompany editable draft fields. Show an explicit data-processing notice before the AI request. URL inputs reject non-HTTP(S), localhost, and literal private/local IPs. DOCX is left for a later extraction adapter.
- Billing, identity, persistent accounts, and real marketplace mutations are not integrated in this foundation.

## Tasks

### Task 1 — Application scaffold and design system

Create the Next.js app configuration, typed domain fixtures, shared responsive RTL shell, custom global styling, landing/discovery screen, and project cards. Use accessible labels, clear focus states, reduced-motion support, and responsive layouts.

### Task 2 — Public discovery and project pages

Add stable `/projects/[slug]` pages with server-side metadata, breadcrumb/content hierarchy, client history, budget/deadline/activity context, and a proposal CTA that opens the local proposal composer. Add `robots.txt` and `sitemap.xml` for public routes only.

### Task 3 — Client project creation

Add a concise Hebrew guided form that starts from a sentence, optional Vertex brief generation, an editable preview, and a local demo publish confirmation. Persist drafts locally and never claim server publication.

### Task 4 — Freelancer profile import and approval

Add CV/document and URL inputs, an explicit Vertex processing notice, AI profile draft endpoint with validation and source labels, an editable review screen, removable fields/tags, and explicit local approval before showing a public-preview state.

### Task 5 — Messages and membership surfaces

Add project-context inbox/conversation demo, functional local message composition, role switch, and clear ₪19.99/month membership summary with renewal/cancellation explainer. Show provider/payment boundaries honestly.

### Task 6 — Verification and handoff

Install dependencies, run production build, inspect the running application at desktop and narrow viewport, fix critical responsive/accessibility issues, and document runtime setup and prototype boundaries.

## Design sketch

```text
Desktop RTL
┌────────────────────────────────────────────────────────────┐
│ brand     role switch      search                inbox/user │
├──────────────┬─────────────────────────────────────────────┤
│ short nav    │ opportunity signal + project list            │
│              │ focused detail / composer                    │
└──────────────┴─────────────────────────────────────────────┘
Mobile: brand + role switch; one primary action; stacked project
signals and labeled values; bottom nav with Home/Discover/Inbox/Profile.
```

## Review focus

- No GCP credentials/project configured: demo must be visible and useful.
- GCP configured but call fails: show a clear error, never silently substitute demo output.
- Untrusted model output or malformed JSON: reject it and show an actionable error.
- Unsupported or oversized import: explain supported file types and limits.
- URL is local/private/non-HTTP: reject before provider request.
- Hebrew plus English titles, URLs, currency, and dates: preserve readable bidirectional text.

## Progress

- [x] Product direction updated with Vertex model/config default.
- [x] Task 1 — application scaffold and design system.
- [x] Task 2 — public discovery, project pages, metadata, robots, and sitemap.
- [x] Task 3 — guided client project draft with editable preview and local save.
- [x] Task 4 — Vertex profile import boundary, source review, editing, and approval.
- [x] Task 5 — project-context demo inbox and transparent membership surface.
- [ ] Task 6 — production build passed; browser visual review was blocked by the local browser access policy. Recheck visual behavior after the user grants local preview access.
