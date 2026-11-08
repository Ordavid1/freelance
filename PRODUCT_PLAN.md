# Freelance Place — Product and UX Blueprint

**Status:** Product direction for discovery and first build  
**Brand:** Freelance Place
**Market:** Israel first; Hebrew and right-to-left by default  
**Research basis:** Representative public and logged-in XPlace pages reviewed on 8 November 2026. No bid, message, profile change, or subscription change was made during the review.

## Product in one sentence

A clear, trusted two-sided marketplace where clients describe work and choose a freelancer, while freelancers find relevant work, send a thoughtful proposal, and manage the relationship from one calm workspace.

## The product promise

**Good work, with less chasing.** People should understand what to do next, what something costs, and what happens after they press a button. The product should feel active because useful opportunities and conversations move forward, not because the interface is noisy.

The platform serves two roles in one account:

- **Client:** describe a project, find and compare suitable freelancers, talk, choose someone, and manage the work.
- **Freelancer:** discover suitable projects, understand the client and budget, prepare a clear proposal, communicate, and manage accepted work.

People can switch roles without creating a second account or paying twice.

## Goals

1. Make the next useful action obvious on every main screen.
2. Reduce the time and effort required to post, find, bid on, compare, and discuss a project.
3. Make the ₪19.99 monthly membership, renewal date, cancellation, and access rules easy to understand and manage.
4. Help clients and freelancers make better matches than a generic chronological feed or lowest-price race.
5. Make profiles, project briefs, proposals, and conversations legible on mobile and desktop.
6. Build public pages that can be discovered through search engines and answer engines without exposing private account content.

## Non-goals for the first release

- Reproducing every XPlace screen or carrying forward its role-specific menus and scattered settings.
- Building a full accounting suite, payroll product, or freelancer CRM.
- Choosing or integrating a payment provider before the owner selects one.
- Claiming that the platform holds project funds, guarantees delivery, or offers escrow until those services and their operating rules are defined.
- Using AI to publish project briefs, send proposals, or message people without the user reviewing and confirming the action.

## Product decisions and assumptions

- **Membership:** one membership at **₪19.99 per month** for an account using either or both roles. The account pays once, not once per role. This follows the stated monthly price and “anyone who joins” requirement.
- **Billing integration:** provider is intentionally undecided. Design the membership and billing experience so a provider can be connected later without changing user-facing concepts.
- **Marketplace transaction:** membership billing is in scope; payment between a client and freelancer is not yet defined. Treat project payment, escrow, platform fees, and disputes as open business decisions.
- **Language:** Hebrew-first, RTL-first. Provide a clear language switch and support English content and LTR text without breaking mixed-language project titles or messages.
- **Public discovery:** allow visitors to understand the marketplace and inspect public project/profile information before asking them to join. Require an active membership for member actions such as publishing, bidding, messaging, or managing work.
- **AI:** use AI as an editor and matching aid. Keep suggestions visible, editable, explainable, and optional.
- **AI provider:** route all generative AI features through Vertex AI in the owner’s GCP project. Keep project ID, region, and model ID as runtime configuration. Use `gemini-3.8-flash` as the initial configurable model default, subject to the target project’s enabled catalog and region. Use server-side Google Cloud credentials and never expose credentials or Vertex calls in the browser.
- **Profile creation:** let freelancers start by uploading a CV/PDF or adding public website URLs. Extract candidate profile facts and searchable skill tags, show where each came from, and require user review before saving or publishing. Every claim remains editable; the system must not invent credentials, clients, years, or outcomes.
- **Website ingestion:** only fetch explicitly supplied public URLs, restrict requests to public HTTP/S destinations, and guard against private-network/localhost targets, oversized responses, and unsupported content. Uploaded documents and extracted data need clear retention, deletion, and privacy controls.
- **Project brief creation:** a client may enter one sentence or use guided prompts. Vertex AI can turn that input into a structured brief, but the client previews and approves it before publication.
- **Client profile:** keep setup minimal. Project history and marketplace activity are the primary trust context; do not require a personal biography or CV to publish a project.

## What the XPlace review revealed

The review covered project search and detail pages, the proposal form and saved templates, proposal management, freelancer profiles and directory filters, messaging, account settings, membership/pricing, billing history, and the first client project-posting step.

Useful marketplace capabilities to retain:

- Project categories, payment types, deadlines, sorting, saved projects, and project attachments.
- Project details that show the client, requirements, timeline, budget, and activity.
- Hourly and fixed-price bids, proposal text, reusable templates, and attachments.
- Freelancer profiles with specialties, portfolio, languages, history, reviews, and rates.
- Client discovery with filters and ways to invite or message a freelancer.
- A conversation connected to its project and proposal, plus post-award workroom tools.
- Proposal status, archive, message count, notifications, invoices, and membership controls.

Problems the new product should solve:

- Navigation spreads primary actions across two rows, category menus, account menus, and footer links.
- A freelancer has to combine separate project pages, bid pages, profile pages, inbox tabs, and billing pages to understand their work and account.
- Proposal entry is a dense form. Price, proposal copy, template selection, attachments, privacy, and a binding-submission warning compete for attention.
- Billing uses several concepts and pages. Membership, placement, certification, taxes, billing period, and cancellation are not presented as one simple account summary.
- Profiles and discovery expose many filters and profile sections without a clear order of importance.
- The inbox has useful project context but divides attention across several tabs and panels.

The response is not to remove useful power. It is to stage it: show the essentials first, keep advanced filters and profile details available on demand, and preserve context when moving between a project, a proposal, and a conversation.

## Experience principles

### One account, two modes

Keep a persistent, plainly named role switch: **אני מחפש/ת עבודה** / **אני מחפש/ת פרילנסר/ית**. Switching changes the home view and primary action, not the person’s identity, messages, or membership.

### Keep context attached

Every proposal and conversation links back to its project. Keep the project title, budget, deadline, status, and the other person’s profile one tap away. Do not make users reconstruct context from a long chat history.

### Put price and consequences beside the action

Show the bid type, amount, currency, included work, and next step together. Before a proposal is sent, show a concise review of the commitment. Before membership checkout, show the charge today, recurring amount, renewal date, tax treatment, and cancellation rule.

### Progressive detail

Start with the five or six details needed to act. Reveal advanced filters, secondary profile sections, and optional proposal details only when useful. Keep powerful search available without making every control visible at once.

### Useful motion, never noise

Use motion to confirm a state change: a proposal was saved, a message arrived, a filter was applied, or a project moved into a workroom. Avoid autoplay, constant movement, fake urgency, and decorative motion that competes with the task.

### Empty states should guide the next step

An empty inbox explains how to start a conversation. An empty project feed offers a saved search or specialty adjustment. An incomplete profile shows the one or two improvements most likely to help, with a direct action to make them.

## Navigation and information architecture

Keep the signed-in shell compact and role-aware:

- **Home** — next actions, activity, and recommendations for the current role.
- **Discover** — projects for freelancers; freelancers for clients.
- **Messages** — one shared inbox with project, proposal, and workroom context.
- **Work** — the user’s proposals and active projects, grouped by status.
- **Profile** — public profile, portfolio, preferences, and account.
- **Membership & billing** — reachable from the profile menu and always visible in account settings.

On desktop, use a compact top bar with brand, role switch, global search, inbox/unread indicator, and account controls. Keep the main section navigation in one consistent rail or compact menu. Do not add a second row of category links to the authenticated shell.

On mobile, use a short bottom navigation for **Home, Discover, Messages, Profile**. Put Work and billing inside the relevant home/profile surfaces. Keep one prominent, role-specific action: **פרסום פרויקט** for clients or **חיפוש פרויקטים** for freelancers.

## Core journeys

### Client: post a project and choose a freelancer

1. Select **פרסום פרויקט**.
2. Write one sentence or answer a few guided prompts: desired result, scope, skills, timing, budget, and payment type.
3. Optionally ask the Vertex AI brief helper to clarify or organize the text. Show the original and suggested version; the client edits and approves it.
4. Preview the public project page, including privacy choices and what freelancers will see.
5. Sign in or join. Before checkout, clearly explain the ₪19.99 monthly membership and renewal terms.
6. Publish the project after an explicit confirmation.
7. Receive proposals in a project inbox. Compare price, bid type, proposed deliverables, availability, profile, and relevant work in a consistent comparison view.
8. Ask a question, shortlist, decline, or choose a freelancer. Keep messages and the project brief side by side.
9. When chosen, create a workroom with agreed scope, milestones, files, decisions, and a clear project status.
10. Close the project and invite both parties to leave a review.

### Freelancer: find work and submit a proposal

1. Create a profile by uploading a CV/PDF, adding one or more public website URLs, or both. The user may also skip imports and start with a short prompt.
2. Vertex AI extracts a profile draft, portfolio candidates, and skill tags from the supplied sources. Show source snippets/URLs next to candidate facts; ask the freelancer to review, edit, remove, and approve before any data becomes public.
3. Select **חיפוש פרויקטים** or open the personalized project feed.
4. See relevant projects with title, category, budget, payment type, deadline, client trust signals, and recent activity. Explain the match with user-editable tags and plain-language reasons.
5. Refine with a small set of visible filters; open advanced filters only when needed. Save the search and choose whether to receive alerts.
6. Open a project without losing the feed position. Review the complete brief, client project history, files, timing, and budget.
7. Choose **הגשת הצעה**. Use a short, progressive composer: price and pricing model first; scope, delivery timing, and proposal message next; portfolio/file additions and privacy options last.
8. Offer saved proposal templates with editable placeholders such as project title, scope, timing, and relevant portfolio item. Never silently overwrite the user’s draft.
9. Show the selected template, amount, payment model, and commitment summary in a final review step. A clear **שליחת הצעה** action sends it; saving a draft is separate.
10. Confirm submission and show the proposal in **Work → הצעות שנשלחו**, with its current status, edit/withdraw options when allowed, and the project conversation.

### Both roles: continue a conversation

1. Open a message from the inbox, notification, project, or proposal.
2. Show the person, project title, proposal amount/status, and last activity in the conversation header.
3. Keep the message composer simple, with attachments and clear send behavior. Do not make Enter-to-send the only mode; let users choose it.
4. Provide search, unread, and status filters. Archive is reversible and distinct from deletion.
5. Move an accepted project into a workroom without losing the message history or agreements.

### Either role: understand and manage membership

1. The membership page shows **₪19.99 per month**, current state, next renewal date, payment method, and exactly which actions membership enables.
2. Receipts and invoices are listed with date, amount, tax, status, and download action.
3. **Cancel membership** is available directly from the membership summary. Explain when access ends and whether renewal stops immediately; do not hide the action behind support.
4. Confirm cancellation, show the end date and remaining access, and send a receipt/confirmation. Let the user reactivate without contacting support.
5. If payment fails, explain the failed charge, access impact, and one direct way to update payment details.

## Feature scope

### Marketplace and project management

- Public project detail pages and authenticated project management.
- Guided project creation with title, result, scope, category/skills, payment type, budget or range, deadline, location/remote needs, attachments, and confidentiality options.
- Draft, preview, publish, pause, edit, close, and archive states.
- Project list filters: skill/category, payment type, budget, remote/location, deadline, newest, and saved searches.
- Project cards with concise, comparable metadata; client trust and response signals; save/favorite; and one consistent apply action.
- Freelancer’s project pipeline: saved, viewed, draft proposal, submitted, shortlisted, awarded, not selected, withdrawn, and archived.
- Client’s pipeline: draft, open, reviewing, shortlisted, awarded, paused, completed, and archived.
- Clear labels for a formal proposal, with editable/withdrawal rules shown before submission.

### Profiles and reputation

- A public profile with name or business name, concise introduction, skills, starting rates, availability, languages, location/remote preference, portfolio, selected experience, reviews, response time, and completed work.
- Profile creation by CV/PDF upload and/or public website URL import, followed by an AI-generated editable profile draft and searchable skill tags.
- Source-aware review: each extracted fact can be traced to the supplied document or URL, edited, removed, or explicitly approved. No profile is published by extraction alone.
- Profile editor as a guided checklist with autosave and a public preview. Put high-value fields first; make education, volunteer work, patents, and external widgets optional sections rather than equal-weight form blocks.
- Client profile stays lightweight: project history, completion and response signals, and completed hires are primary; no CV or long personal bio is required.
- Verification indicators with a plain explanation of what was checked. Never imply a badge guarantees work quality.
- Reviews tied to completed collaborations, with response and reporting paths.
- Portfolio media and attachments with ownership, privacy, and access rules defined before upload.

### Proposals and templates

- Hourly, fixed-price, and (if needed in the business model) retainer proposals, with the unit always visible next to the amount.
- Proposal scope, assumptions, milestones/deliverables, availability, delivery estimate, message, and relevant portfolio work.
- Draft, preview, duplicate, edit, withdraw, and track status.
- Reusable templates with names, categories, editable placeholders, preview, and easy management. Avoid artificial template limits on a single membership tier.
- Optional suggested price range based on project details and prior marketplace data, clearly labeled as guidance rather than a required price.
- No public bid-count or average-price UI that pushes a race to the bottom by default. If benchmark data is shown, make it contextual, explain sample size, and let the user hide it.

### Messaging and workrooms

- One searchable inbox with unread, role, project status, and recent-activity filters.
- Conversation grouped under a project, with the relevant proposal visible in context.
- Attachments, links, read state, notifications, archive/restore, and participant controls.
- Workroom after award: agreed scope, milestones, due dates, files, decisions, change requests, and completion checklist.
- Tasks and project notes belong to a workroom, not an unrelated global panel.
- Block/report and notification controls are visible and understandable.

### Membership, billing, and account

- One membership for either or both marketplace roles at ₪19.99 per month.
- Single source of truth for active, trial (if introduced), payment issue, canceled, and expired states.
- Billing summary, invoices/receipts, payment method, renewal date, access end date, and cancellation/reactivation.
- Provider-independent billing boundary; no provider credentials or provider-specific concepts in product copy.
- Account details, language, notification preferences, privacy, login/security, and data export/delete requests grouped in one account area.
- Membership status and billing history must not be split across unrelated menu labels.

### AI and GCP architecture

- All product AI features use Vertex AI in the owner’s GCP project: profile extraction and drafting, skill-tag suggestions, project-brief drafting, and (later) explainable project matching.
- Keep a small server-side AI service boundary with separate tasks and typed inputs/outputs. It reads `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, and `VERTEX_MODEL_ID` from runtime configuration and uses Application Default Credentials or the hosting platform’s attached service identity.
- Never ship service-account keys, access tokens, or provider credentials to the browser. Do not create or enable GCP resources automatically as part of app startup.
- Start with configurable model ID `gemini-3.8-flash` and location `global`; verify model access and quotas in the owner’s target project before production use. The model is an operational default, not a product dependency.
- Vertex responses are untrusted drafts. Validate response shape, retain source references, and require user approval before public profile/project changes.
- For local development without GCP credentials, provide an explicit demo provider with deterministic example output and a visible “demo” state. Production must not silently fall back to mock AI.

## Visual and interaction direction

### Character

Build a **working studio for independent talent**: editorial, human, energetic, and precise. Use real project language and real portfolio work. Avoid stock handshake imagery, generic “AI gradient” backgrounds, identical rounded cards everywhere, dashboard charts without meaning, and endless promotional banners.

### Compact visual system

- **Night ink — `#17263A`:** primary text and deep navigation surfaces.
- **Pine — `#145A4E`:** primary action and trusted/active states.
- **Mineral — `#F4F6F2`:** main canvas and quiet page backgrounds.
- **Paper — `#FFFFFF`:** focused content surfaces.
- **Signal saffron — `#E8BF42`:** focus, selected controls, and opportunity highlights; use dark text for contrast.
- **Coral — `#EA6A4F`:** attention and time-sensitive states, never the only warning signal.

Use Heebo for Hebrew-first interface text and Space Grotesk for Latin text and prominent figures. Use a clear type scale and right-align Hebrew content. Keep paragraphs short and labels in sentence case. Do not rely on all-caps labels, decorative eyebrows, generic gradients, or a uniform card radius to create personality.

### Signature interaction

Give each project a compact **opportunity signal**: a readable state combining fit, deadline, client activity, and budget clarity. Show the reason in words (“Matches 3 of your skills”; “Client replied today”), never as an unexplained score. One small edge marker and clear text can carry the visual identity across feeds, details, and proposals.

### Layout sketch

```text
Desktop (Hebrew / RTL)
┌──────────────────────────────────────────────────────────────────┐
│ Freelance Place  [role switch]      חיפוש…       הודעות   חשבון │
├────────────────┬─────────────────────────────────────────────────┤
│ ניווט קצר      │ כותרת פעולה ברורה     [פעולה ראשית אחת]         │
│ בית            │                                                 │
│ גילוי          │ פיד / פרטי פרויקט / הצעות                       │
│ הודעות         │ תוכן עשיר, פרטים לפי הצורך, מצב ברור            │
│ עבודה          │                                                 │
│ פרופיל         │                                                 │
└────────────────┴─────────────────────────────────────────────────┘

Mobile
┌──────────────────────────────┐
│ לוגו       תפקיד       הודעות│
├──────────────────────────────┤
│ פעולה ראשית אחת              │
│ חיפוש / סינון קצר             │
│ פרויקט                        │
│ התאמה, תקציב, תאריך ומצב      │
│ [שמירה]        [הגשת הצעה]   │
├──────────────────────────────┤
│ בית   גילוי   הודעות   פרופיל│
└──────────────────────────────┘
```

Use responsive grids, not scaled-down desktop tables. On narrow screens, show project comparison as vertically stacked, labeled values; keep the primary action reachable without covering content. Use motion only to show a user-triggered transition, and respect reduced-motion settings.

## Responsive, accessibility, and content rules

- Hebrew RTL is the default across navigation, form order, menus, icons with direction, and email templates. Mixed Hebrew/English strings, URLs, and numbers must remain readable.
- Every action works by keyboard with a visible focus style. Use semantic headings, labels, error messages, and status announcements.
- Meet WCAG AA color contrast for text and controls; never communicate status by color alone.
- Support zoom, reflow, touch targets, and screen readers. Avoid horizontal scrolling for primary workflows.
- Provide clear loading, empty, success, offline, validation, permission, and failure states.
- Preserve form drafts through navigation and interrupted sessions. Confirm before discarding an unsaved proposal or project brief.
- Write in plain Hebrew and English with consistent action labels. A button says what it will do (“Save draft”, “Publish project”, “Send proposal”), and the confirmation uses the same verb.

## SEO and answer-engine visibility

- Build indexable public landing, category, public project, and public freelancer pages with stable, descriptive URLs.
- Render meaningful page titles, descriptions, canonical URLs, Open Graph data, breadcrumbs, and internal links on the server or in pre-rendered output.
- Add structured data only when the visible page satisfies the relevant schema requirements. Keep private projects, drafts, messages, member-only data, and personal contact details out of indexing.
- Publish a sitemap and deliberate robots rules. Give users control over which profile fields are public.
- Use descriptive category pages, concise answers to real marketplace questions, and editorial resources that demonstrate expertise. Do not generate thousands of near-duplicate SEO pages.
- Make project and profile pages useful when shared directly, with clear context and a safe route to join or contact through the platform.

## First-release priorities

### Phase 1 — Marketplace foundation

- Public home, category pages, public project pages, and public freelancer profiles.
- Account creation and one membership explanation/checkout boundary.
- Role-aware onboarding, user settings, and membership summary.
- Freelancer source import (CV/PDF and public website URL), Vertex-generated profile draft and tags, source review, and explicit approval before publishing.
- Client project draft from one sentence, optional Vertex brief helper, preview, and publish flow.
- Freelancer discovery feed, project detail, saved projects, and proposal submission.
- Basic client proposal review and shortlist.

AI output is only available through the server-side Vertex boundary; local demo output is clearly labeled. Project-payment processing, escrow, commissions, taxes on project work, and dispute operations remain separately scoped.

### Phase 2 — Relationships and retention

- Unified inbox with project and proposal context.
- Freelancer proposal pipeline and client project pipeline.
- Saved searches and useful alerts.
- Profiles, portfolio manager, reviews, and reusable proposal templates.
- Self-service invoices, cancellation, reactivation, and payment-failure states.

### Phase 3 — Delivery and marketplace quality

- Workrooms, scope confirmation, milestones, files, change requests, and completion.
- Trust signals, verification workflow, moderation, reporting, and fraud prevention.
- Match explanations and optional pricing guidance based on quality marketplace data.
- Operational dashboards for project response, time-to-first-proposal, time-to-hire, completion, and member retention.

Project-payment processing, escrow, commissions, taxes on project work, and dispute operations require a separate business decision before implementation.

## Success measures

Measure the marketplace outcome, not page views alone:

- Time from client project draft to publish.
- Time from freelancer landing to first relevant project view and proposal draft.
- Project view-to-proposal and project-post-to-first-qualified-proposal rates.
- Client shortlist-to-hire rate and time to hire.
- Proposal response rate and time to first client response.
- Share of projects with a completed outcome and mutual review.
- Membership checkout completion, renewal, cancellation completion, and billing support contacts.
- Search success, saved-search return rate, and alert-to-project engagement.
- Mobile completion rate for posting, bidding, messaging, and cancellation.
- Accessibility defects and task completion by keyboard/screen reader.

Use quality guardrails alongside conversion: spam reports, irrelevant proposals, unanswered projects, suspicious accounts, failed payments, and complaints about cancellation or billing confusion.

## Decisions to make before the corresponding implementation

1. Which billing provider and tax display/receipt requirements apply in Israel?
2. Is project payment handled on-platform, through escrow, or directly between client and freelancer? What support and dispute process accompanies that choice?
3. What client and freelancer identity checks are required, and which details may appear publicly?
4. Which project and profile fields are public, private, or visible only to logged-in members?
5. Which notifications are email, in-app, or push, and how often may the platform send them?
6. What constitutes a completed project and an eligible review?
7. What is the final product name, logo, and domain?

These decisions should not delay the UX direction or clickable prototype. They should be explicit before the system processes real payments, publishes private data, or makes guarantees about project outcomes.
