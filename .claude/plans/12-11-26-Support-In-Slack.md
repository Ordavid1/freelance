# Customer support in Slack — plan (12-11-26)

Status: **Phase 0 done; Phase 1 and most of Phase 2 implemented, see the status section below.** Owner thread: "Plan moving customer support to Slack".

## Status (12-11-26)

- **Phase 0: done by Or.** `#support` channel created, Slack app installed, `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` stored in Secret Manager. Note: `#support` is a **public** channel (this plan said private), so the app's scopes are `channels:history` and the `message.channels` event, not the private-channel variants.
- **Phase 1 implemented**, except step 3's `appendSupportReply` refactor: `receiveSupportReply` was left as it was, and agent replies are delivered by `src/lib/support/delivery.ts`. Steps 1, 2, 4, 5, 6 and 7 are done. Step 1 uses a small fetch client instead of `@slack/web-api` (see D5).
- **Phase 2 items 1 and 2 implemented**: AI draft job with Send / Edit / Discard, superseded drafts, triage labels on the parent card, Close / Reopen buttons, and reopen on a new customer message. **Not done:** the urgency ping in item 2, and the Phase 2 items 3 onwards (attachments to Slack files, Assign to me, and the other Phase 2 commands in section 3.5).
- **Decisions taken:**
  - **D1: yes.** Terraform variables added: `slack_secrets`, `support_slack_channel_id`, `support_slack_agent_ids`, `support_slack_dispatch_enabled`, following the `resend_secrets` pattern.
  - **D2: yes.** A 1-minute Cloud Scheduler sweep (`freelance-support-slack` → `POST /api/support/slack/dispatch`) is the safety net. Inline processing is kept for agent replies, draft sends and status changes, which run before the response.
  - **D3: `//` or `note:` notes.** Every other thread message goes to the customer.
  - **D4: pending until live.** Whether the Resend inbox agent is switched off waits until Slack drafts are proven live.
  - **D5: changed.** No SDK. A small fetch client (`src/lib/support/slack/client.ts`) is used instead, so there is no new dependency.
- Docs: `docs/support-chat.md` has a "Slack console" section with the manifest and acceptance checklist.

## 1. Recommendation in one paragraph

Keep **Resend as the email transport** and keep **customer@freelance-place.com** as the public address. Add a first-party **Slack app ("Freelance Support")** to the existing Next.js service on Cloud Run. Every support conversation (site chat *and* plain email) becomes **one Slack parent message with all follow-ups in its thread**. Replying in the thread delivers the answer to the customer through the channel they came from (chat widget or email, threaded correctly). An AI bot posts a **triage card and a draft reply** into the thread, with Send / Edit / Discard buttons; nothing is ever sent to a customer without a human click. Firestore stays the system of record, Slack is the console, Resend is the pipe.

Do **not** move the support address to Google Workspace for this. It would cost per seat, require an MX change on the root domain that currently feeds Resend receiving, and make the Slack bridge *harder* (Gmail push via Pub/Sub watch instead of a webhook we already run).

## 2. What exists today (verified in code and accounts, 12-11-26)

| Piece | Where | Behaviour |
| --- | --- | --- |
| Site chat widget | `src/app/api/support/route.ts`, `src/lib/support/service.ts` | Visitor message → Firestore `supportConversations/{sha256(cookie)}/messages` → Resend email to `SUPPORT_INBOX_EMAIL` with `Reply-To: chat+<32-hex token>@SUPPORT_REPLY_DOMAIN`, subject `[Chat <id8>] <name> · Freelance Place`. |
| Inbound webhook | `src/app/api/support/webhook/route.ts` | Resend `email.received` (svix-verified) → `handleInboundEmail` (`autoreply.ts`). |
| Reply bridge | `receiveSupportReply` in `service.ts` | If a received mail is from an allowed sender and addressed to exactly one `chat+token`, the quote-stripped body is appended to the chat as a `support` message (idempotent on email id). |
| Auto-acknowledgment | `src/lib/support/autoreply.ts` | Loop-safe he/en ack to humans who mail customer@, 3/sender/day, 200/h, kill switch `SUPPORT_AUTOREPLY=off`. |
| Resend account | Resend MCP | One inbox `customer@freelance-place.com` (from name "Or from Support"). One webhook → `/api/support/webhook` (received, sent, delivered, opened). Inbox AI agent already configured (triage into 5 labels, draft replies, human review). Root MX of freelance-place.com points to Resend receiving. |
| Slack | Slack MCP | Workspace exists with `#all-freelance-space`; no support channel yet. No Slack code in the repo. |
| LLM | `src/lib/ai.ts` `generateWithVertex` | Vertex/Gemini, model from `VERTEX_MODEL_ID` env. Supports `responseJsonSchema`. |
| Background work | `src/lib/projects/events.ts` (`after()`), `infra/terraform/project-notifications.tf` | Outbox + Cloud Scheduler OIDC dispatch every 5 min pattern already used for project mail. Cloud Run has `cpu_idle = true`. |

### Root cause of the "one person, many threads" problem in the screenshot

Each visitor chat message sends a **brand-new email** with no `In-Reply-To`/`References` and no stable `Message-ID`, so the Resend inbox shows chat `15afb088` as four separate threads. Any email client would do the same. In Slack the conversation id → `thread_ts` mapping fixes this by construction. (Independently of Slack, the notification email should also carry a stable root `Message-ID` per conversation and `References` on follow-ups; this plan does that in step P1.4 so the email fallback threads too.)

## 3. Target architecture

```
                       ┌──────────────── Firestore (system of record) ────────────────┐
 Site chat ─POST /api/support──▶ supportConversations{channel:'chat'}                     │
 Email to customer@ ─Resend email.received─▶ /api/support/webhook ─▶ supportConversations{channel:'email'}
                       └───────────────┬──────────────────────────────────────────────────┘
                                       │ supportSlackOutbox (idempotent jobs)
                                       ▼
                         Slack #support  (parent = conversation, thread = every message)
                                       │
           human reply in thread ─Events API─▶ /api/support/slack/events
           Send/Edit/Discard buttons ─Interactivity─▶ /api/support/slack/interactions
                                       │
                deliver by channel: chat → append Firestore message (widget shows it)
                                    email → Resend send From customer@, In-Reply-To/References
```

### 3.1 Data model (additive)

- `supportConversations/{id}` gains: `channel: 'chat' | 'email'`, `slack: { channel, ts }`, `status: 'open' | 'waiting_on_customer' | 'closed'`, `triage: { category, urgency, language, summary }`, `email: { rootMessageId, lastMessageId, subject }` (email channel).
- Email conversations are new: id = `sha256('email:' + normalized sender + ':' + root Message-ID)`. Thread continuity is resolved from `In-Reply-To`/`References` → `supportEmailThreads/{sha256(messageId)}` → conversation id; a new subject with no references opens a new conversation. This replaces "one Resend inbox thread per email" with real conversation tracking for mail too.
- `supportSlackOutbox/{jobId}`: `{type: 'post_parent'|'post_message'|'ai_draft'|'react', conversationId, payload, state, attempts, nextAt}`. Job ids are deterministic (`<conversationId>/<messageId>/<type>`) so retries never double-post.
- `supportSlackEvents/{event_id}` dedupe receipts (Slack retries up to 3 times).

### 3.2 Inbound → Slack

1. Chat: `sendSupportMessage` keeps its transaction; it additionally creates an outbox job in the same transaction.
2. Email: `handleInboundEmail` keeps the auto-ack and chat-reply bridge, and for any human mail to customer@ that is *not* a `chat+` reply, records it as an email-channel message (quote-stripped with the existing `extractSupportReply`) plus an outbox job.
3. Outbox processor: runs immediately via `after()` and is swept by a scheduler (see 6.2). First message → `chat.postMessage` parent card (Block Kit: name, email, source, page, language, status) and stores `slack.ts`. Later messages → `chat.postMessage` with `thread_ts` and `reply_broadcast: false`, plus an @mention of the assigned agent so the phone always buzzes for follow-ups.
4. Attachments on email: posted as file links (Slack `files.uploadV2`) in phase 2; phase 1 posts a "N attachments, open in Resend" line.

### 3.3 Slack → customer

1. `message` event in `#support` with `thread_ts`, from a human (no `bot_id`, no `subtype`), whose Slack user id is in `SUPPORT_SLACK_AGENT_IDS`.
2. Internal notes: a message starting with `//` or `note:` is never sent (marked with 🔒 reaction). Everything else in the thread is a customer reply. (Alternative if Or prefers explicit sending: "only messages sent with the Send button go out". Decision D3.)
3. Delivery by conversation channel:
   - **chat** → shared `appendSupportReply(conversationId, text, sourceRef)` extracted from today's `receiveSupportReply` transaction, so email-replies and Slack-replies use one code path.
   - **email** → Resend `emails.send` from `SUPPORT_FROM_EMAIL`, `to` customer, subject `Re: <root subject>`, `In-Reply-To`/`References` from the stored chain, `Reply-To: customer@`, idempotency key `slack/<event_id>`.
4. Feedback in Slack: ✅ reaction when delivered, ⚠️ plus an ephemeral error when not. Edits/deletes in Slack after sending are **not** propagated (email cannot be unsent); the bot says so ephemerally.

### 3.4 AI triage and drafts

- Trigger: every inbound customer message enqueues an `ai_draft` job.
- Call: `generateWithVertex` from `src/lib/ai.ts` with `responseJsonSchema` `{category, urgency, language, summary, needsHuman, reasons[], draft}`. **The model comes from the existing `VERTEX_MODEL_ID` setting; no model change.** Respects `AI_GENERATION_ENABLED=false`.
- Grounding: conversation history (last 20 messages) plus the site's own facts modules (pricing/trial/legal identity already centralised for SEO, see memory "main moves fast"), never hard-coded copy. Same guardrails as the Resend inbox agent: no invented prices, refunds, timelines or commitments; legal/payment/account-access/safety → `needsHuman` and no draft.
- Output in Slack: a bot message in the thread with the summary, category/urgency chips, the draft, and buttons **Send**, **Edit & send** (modal with the draft prefilled), **Discard**. Bot messages are never delivered by the event handler; only the buttons send, and only for allowlisted agents.
- Parent card is updated (`chat.update`) with category and urgency; urgent items also ping the agent.
- Later (phase 3, opt-in per category): auto-send for clearly low-risk categories after N weeks of measured acceptance rate. Not in scope now.
- Resend's own inbox agent can stay on (it only drafts inside Resend) or be turned off to avoid two sets of drafts. Recommendation: turn it off once Slack drafts are live (D4).

### 3.5 Commands and status (phase 2)

Buttons on the parent card: Assign to me, Mark waiting on customer, Close / Reopen. `/support search <email>` slash command. A customer message on a closed conversation reopens it and re-pings.

## 4. Resend vs Google Workspace for the support address

| | Keep Resend (recommended) | Move customer@ to Google Workspace |
| --- | --- | --- |
| Slack bridge | Already webhook-first; we already verify and fetch bodies. | Need Gmail API `watch` + Pub/Sub topic + history sync, OAuth/domain-wide delegation. More moving parts. |
| DNS | No change. | Root MX → Google. Breaks Resend receiving on the root domain, so `chat+` aliases must first move to a subdomain (e.g. `chat.freelance-place.com`). |
| Deliverability | Outbound already DKIM/SPF-verified on Resend; replies from Slack use the same sender. | Same for Gmail, but two senders to keep aligned in SPF/DMARC. |
| Threading | We control `Message-ID`/`References` ourselves. | Gmail threads natively, but we still need our mapping for Slack. |
| Cost | Included in current Resend plan usage. | Per-user monthly seat (check current Google pricing before deciding). |
| Lock-in | Moderate: logic lives in our code and Firestore; Resend is replaceable by any provider with inbound webhooks (Postmark, SendGrid, SES). | Different lock-in, same app work. |
| Human mailbox | Resend inbox is a thin UI. Slack replaces it as the UI. | Full mailbox, useful for non-support mail. |

Verdict: keep Resend. If Or wants a normal mailbox for personal/legal mail, give that a **separate** address in Google Workspace later, but only after moving `SUPPORT_REPLY_DOMAIN` to a dedicated subdomain (the original docs already recommend that; today it is the root domain).

Rejected alternatives:
- **Slack "email to channel" address**: no threading per person and no reply path back. Fails the main goals.
- **Zapier/Make glue**: works for inbound, but the reply path needs our conversation mapping anyway, and it adds a third vendor holding customer data.
- **Off-the-shelf Slack helpdesks** (e.g. Plain, Pylon, Zendesk for Slack): fastest to start, but they do not know our chat widget, need customer@ forwarded to them, and are per-seat SaaS. Worth re-evaluating only if support grows to several agents.

## 5. Implementation steps

### Phase 0 — Or's manual setup (≈20 min, no code)
1. Create a private channel `#support` in the Freelance Slack workspace. Mobile: channel notifications → "All new messages".
2. Create the Slack app at api.slack.com/apps **from the manifest in this plan's appendix** (I will generate it). Install to the workspace. Copy **Bot token** (`xoxb-…`) and **Signing secret**.
3. Invite the app to `#support` (`/invite @Freelance Support`).
4. Add to Secret Manager (project `freelance-514118`): `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`. Never paste them into chat or Git.
5. Tell me Or's Slack member id (Profile → ⋯ → Copy member ID) for `SUPPORT_SLACK_AGENT_IDS`, and the `#support` channel id.

### Phase 1 — bridge (one PR)
1. `src/lib/support/slack/` — `client.ts` (`@slack/web-api` WebClient, retry/backoff on 429), `verify.ts` (v0 HMAC, 5-min replay window, raw body), `blocks.ts` (cards), `outbox.ts` (enqueue/process with deterministic ids), `config.ts` (`supportSlackConfig()` returns null unless all settings present → feature off by default).
2. Routes: `src/app/api/support/slack/events/route.ts` (url_verification, message events), `src/app/api/support/slack/interactions/route.ts` (buttons, modal submit). Both ack < 3 s; delivery work is a Firestore transaction + one Resend call.
3. Refactor `receiveSupportReply` → shared `appendSupportReply`; email-channel conversations in `handleInboundEmail`.
4. Stable `Message-ID` per chat conversation and `References` on follow-up notification emails, so the Resend/email fallback threads per person too.
5. Feature flags: `SUPPORT_SLACK=off` kill switch; email notifications to customer@ stay on during the trial (dual-run) and can be turned off with `SUPPORT_EMAIL_NOTIFY=off` once Slack is trusted.
6. Tests in `npm run test:support`: signature verification, retry dedupe, bot-message ignore, non-agent ignore, note prefix, chat delivery, email threading headers, outbox idempotency.
7. Docs: extend `docs/support-chat.md` with a Slack section.

### Phase 2 — AI drafts and workflow
1. `ai_draft` job, schema, Block Kit draft card with Send / Edit & send / Discard, modal.
2. Triage labels on parent card, urgency ping, status buttons, reopen on new message.
3. Attachments to Slack files.

### Phase 3 — optional
Measured auto-send for low-risk categories; email the chat visitor when a reply waits unseen for N minutes (today visitors must return to the same browser); weekly support digest.

## 6. Decisions for Or

- **D1 Deployment change (requires your approval):** add `SLACK_BOT_TOKEN`/`SLACK_SIGNING_SECRET` secret refs and `SUPPORT_SLACK_CHANNEL_ID`/`SUPPORT_SLACK_AGENT_IDS` env vars to the **existing** `infra/terraform/main.tf` Cloud Run service (same pattern as `resend_secrets`). No new deploy files.
- **D2 Background reliability (requires your approval):** Slack posting and AI drafts run via `after()`. Because Cloud Run uses `cpu_idle = true`, work after the response can be throttled. Recommended: reuse the existing Cloud Scheduler + OIDC dispatch pattern (`project-notifications.tf`) with a 1-minute sweep of `supportSlackOutbox` as the safety net. Alternative: Cloud Tasks (new service, more infra).
- **D3 Reply semantics:** every thread message goes to the customer except `//` notes (recommended, fastest), or only button-sent messages go out (safest, slower).
- **D4 Resend inbox agent:** turn off after Slack drafts are live (recommended) or keep both.
- **D5 New dependency:** `@slack/web-api` (official SDK). Bolt is not needed inside Next.js routes.

## 7. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Internal Slack chatter sent to a customer | Agent allowlist, `//` note prefix, bot messages never forwarded, ✅/🔒 reaction feedback; or D3 explicit-send mode. |
| Slack retries → duplicate emails | `event_id` receipts + Resend idempotency key `slack/<event_id>`. |
| 3-second Slack ack limit | Handler only does a transaction + one send; AI work is queued (D2). |
| Mail loops between auto-ack, Slack and Resend | Existing loop guards stay; Slack-originated sends carry our own sender, which `autoReplyDecision` already ignores. |
| Customer PII in Slack | Private channel, only name/email/page/message; no cookies or tokens; Slack free plan hides history after 90 days, Firestore remains the record. Update privacy notice to name Slack as a processor. |
| Slack outage | Dual-run email notifications during rollout; kill switch `SUPPORT_SLACK=off` falls back to today's flow. |
| AI drafts inventing commitments | Structured output, grounding only from facts modules, `needsHuman` for sensitive topics, human click required. |
| Root-domain reply aliases | Move `SUPPORT_REPLY_DOMAIN` to a subdomain before any future MX change (DNS, Or's call; not needed for this plan). |

## 8. Acceptance

- New chat from an incognito browser → one parent card in `#support`, phone push within seconds; three more chat messages → three thread replies under the same card.
- Reply in thread → appears in the widget within 8 s; ✅ on the Slack message.
- New email to customer@ → auto-ack as today + parent card; reply in Slack → customer receives it threaded under their original email in Gmail and Outlook; their answer lands in the same Slack thread.
- `//` note never leaves Slack. A non-allowlisted Slack user's reply is ignored with an ephemeral notice.
- Replaying a Slack event or Resend webhook creates no duplicates.
- AI draft card appears for a pricing question with no invented numbers; a refund request is flagged `needsHuman` with no draft.

## Appendix — Slack app manifest (draft)

```yaml
display_information:
  name: Freelance Support
features:
  bot_user:
    display_name: Freelance Support
    always_online: true
oauth_config:
  scopes:
    bot: [chat:write, reactions:write, groups:history, channels:history, users:read, files:write]
settings:
  event_subscriptions:
    request_url: https://freelance-place.com/api/support/slack/events
    bot_events: [message.groups, message.channels]
  interactivity:
    is_enabled: true
    request_url: https://freelance-place.com/api/support/slack/interactions
  org_deploy_enabled: false
  socket_mode_enabled: false
```

The request URLs use the canonical domain, matching `var.canonical_domain`; in code they are not hard-coded (routes are relative; Slack only needs the public URL at setup time).
