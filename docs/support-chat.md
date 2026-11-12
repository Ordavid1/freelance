# Customer support chat (Resend)

The site has a Hebrew, RTL support conversation that works for guests and signed-in users. Desktop uses a bottom-right launcher; at widths up to 760px, the launcher is a small icon next to sign-in/sign-out in the header. The mobile conversation opens as a native modal sheet. It supports suggested topics, delivery/retry states, unread replies, reduced motion, and a private conversation that survives page navigation and reloads in the same browser.

## How the email bridge works

1. The visitor supplies a message and contact email (name optional). Contact details from an existing signed-in session are prefilled. Contact emails supplied by visitors are not verified.
2. `POST /api/support` saves a private Firestore message and sends a plain-text notification through Resend to `SUPPORT_INBOX_EMAIL`, defaulting to **customer@freelance-place.com**. Visitor input cannot choose notification recipients. The notification includes their name, contact email, and pathname (no query string).
3. Each conversation gets a private, random reply alias, `chat+<token>@SUPPORT_REPLY_DOMAIN`. Click **Reply** in your normal inbox and write above the quoted original. Do not replace the Reply-To address with the visitor's email if you want the reply to appear in chat.
4. Resend emits `email.received` to `POST /api/support/webhook`. The server verifies the raw body with the webhook signing secret, retrieves the received email through the Resend API, checks that the sender is your inbox or an explicitly allowed team address, extracts the new reply, and appends it to the matching chat exactly once.
5. A visible, open chat checks for replies every 8 seconds. An existing, minimized chat checks every 45 seconds. Hidden tabs stop polling. No typing, online presence, or read receipts are fabricated. Visitors must return to the same browser to see replies; this version does not email notifications to visitors.

## Automatic acknowledgment of inbox email

Every email that arrives at `SUPPORT_INBOX_EMAIL` (customer@freelance-place.com) receives an instant, friendly acknowledgment that a person will answer within a few minutes. It uses the same `email.received` webhook as the chat bridge, so no new secrets, webhooks or DNS records are needed.

- **Language:** Hebrew when at least 20% of the message letters are Hebrew, otherwise English (RTL layout for Hebrew). Add a language in `COPY` in `src/lib/support/autoreply.ts`.
- **Threading:** subject `Re: <original>`, `In-Reply-To` and `References` point at the received message; `Reply-To` is the inbox, so the customer's answer lands back in it.
- **Loop and abuse protection:** never replies to our own addresses/domain, `no-reply`/daemon senders, `Auto-Submitted`, `Precedence: bulk/list/junk`, list or vendor auto-response headers, delivery reports, empty return-path, SPF/DKIM/DMARC failures, or auto-reply/out-of-office subjects. The reply carries `Auto-Submitted: auto-replied`.
- **Limits:** one acknowledgment per provider email id and per RFC Message-ID; at most 3 per sender per rolling 24h; at most 200 per hour site-wide. Only hashes of sender addresses are stored (`supportAutoReplies`, `supportAutoReplyLimits`, `supportRateLimits/autoreply-hour`). Failed sends return 503 so Resend redelivers, without spending the sender's allowance.
- **Kill switch:** set the optional runtime variable `SUPPORT_AUTOREPLY=off` (also `false`, `0`, `disabled`) to stop replies without a code change. Unset means on.
- Replies to a private `chat+…` alias still go to the chat bridge, never to the responder.

## Runtime variables

All settings are server-only. Do not use `NEXT_PUBLIC_*` for Resend keys.

| Variable | Value |
| --- | --- |
| `RESEND_API_KEY` | Full-access Resend key that can send messages **and retrieve received email bodies**. A sending-only key is insufficient. |
| `RESEND_WEBHOOK_SECRET` | Signing secret of the webhook below (`whsec_…`). |
| `SUPPORT_INBOX_EMAIL` | Your existing inbox, default `customer@freelance-place.com`. |
| `SUPPORT_FROM_EMAIL` | A sender on a Resend-verified domain, e.g. `Freelance Place <customer@freelance-place.com>`. |
| `SUPPORT_REPLY_DOMAIN` | A dedicated subdomain enabled for receiving in Resend, e.g. `chat.freelance-place.com`. Domain only; no scheme or `@`. |
| `SUPPORT_ALLOWED_REPLY_EMAILS` | Optional comma-separated addresses if you reply from another alias or allow another team member. The inbox address is always allowed. |

The example sending and receiving domains are proposed configuration, not a claim that their DNS is configured. Chat sending becomes available when both secrets and the sender/receiving settings are present. Before then, the widget offers a direct email link and does not claim messages were sent. Invalid configurations also keep sending disabled.

## Resend setup

1. Verify your sending domain in Resend and enter `SUPPORT_FROM_EMAIL`.
2. Add a **dedicated receiving subdomain** in Resend. Add the exact MX/verification records Resend gives you for that subdomain, then enter it as `SUPPORT_REPLY_DOMAIN`. **Preserve the existing MX records for your main domain and normal inbox.** A Resend-provided receiving domain can also be used if assigned to your account.
3. In Resend, create a webhook with URL `https://freelance-place.com/api/support/webhook` and event **`email.received`**. Copy its signing secret into `RESEND_WEBHOOK_SECRET` via Secret Manager/runtime settings.
4. Add the API key as `RESEND_API_KEY`. For local development use an ignored `.env.local`; production uses Secret Manager. No secret values belong in Git, Terraform variable files, or chat.
5. Deploy the code and runtime settings together. The existing Terraform template now supports the four configuration values and optional `resend_secrets` references. Copy [the reference-only example](../deploy/resend.tfvars.json.example) to an ignored variable file, set real secret names and pinned enabled versions, and review the complete Terraform plan before applying. No secrets, DNS records, Resend account changes, or production deployment are performed by this source change.

## End-to-end acceptance after adding secrets

- Open the site in an incognito browser; start a support conversation without signing in. Verify that exactly one notification reaches your inbox, with a private `chat+…` Reply-To.
- Reply normally from the configured inbox. Verify the webhook returns 200 in Resend and your reply appears in that browser within 8 seconds, without the original quoted notification or signature.
- Minimize the chat, reply again, and verify the unread badge. Reload and verify the conversation returns. Use an unrelated browser and verify it cannot read the first conversation.
- Replay the same webhook in Resend; it must not duplicate the reply. An auto-reply or an email from an unapproved sender must not enter chat.
- Disconnect the browser network, send a message, reconnect, and retry it. The same message ID/provider idempotency key is reused. If more than 23 hours pass after an uncertain delivery, an old retry is rejected to avoid crossing Resend's 24-hour idempotency window.
- Check desktop, mobile header placement, keyboard navigation, Escape/minimize, long messages, and the soft keyboard on a real phone.

## Storage, privacy, and limits

Firestore collections are `supportConversations` (private contact data and `messages` subcollection), `supportReplyRoutes` (hashed alias → conversation), `supportInboundReceipts` (email deduplication), and `supportRateLimits` (one shared hourly budget counter). All access uses the server Admin SDK; no new client Firestore permissions are required. There are no composite-index requirements.

The browser has a random 256-bit HttpOnly cookie, scoped to `/api/support`, with a 30-day lifetime, Secure in production and SameSite=Lax. Only its hash identifies a database conversation. Account-bound conversations also require the same authenticated user; logout clears the support cookie. New/unknown browsers cannot recover a conversation from an email address alone. Local storage holds only a return flag and seen-reply timestamp, never the conversation body, contact details, or private tokens. API responses are private and uncached.

Each conversation is limited to 10 new messages per 10 minutes and 200 total visitor messages; the application also limits new outbound notifications to 100/hour across instances, including clients that rotate cookies. Retries do not spend extra budget. The latest 100 messages are displayed. Webhook receipt IDs and Firestore transactions prevent duplicate replies; automatic responses, unknown senders, and ambiguous reply routes are ignored. Attachments are not forwarded to chat. Email bodies are rendered as plain text, never executable HTML. There is no automatic database retention/deletion job; support messages and inbox copies are covered by the site's updated privacy notice and manual deletion process.

## Slack console

When Slack is configured, `#support` is the agent console. Site chat and mail to customer@ both become one Slack parent card per conversation, and every later message is a reply in its thread. Firestore remains the record; Slack is only the console.

### Flow

1. **Customer message.** A chat message or a new human email creates or updates the Firestore conversation (`channel: 'chat' | 'email'`) and queues outbox jobs. The first message posts the parent card (name, email, page or subject, status, conversation id). Each visitor message is posted in the thread, mentioning the agent allowlist.
2. **Agent reply.** A message in the thread from an allowlisted agent is delivered to the customer by the conversation's channel. Chat replies appear in the widget. Email replies are sent from `SUPPORT_FROM_EMAIL` to the customer, threaded under their message. The agent gets ✅ on success, or ⚠️ and an ephemeral note on failure.
3. **Internal notes.** A message starting with `//` or `note:` is never delivered. It gets 🔒 instead.
4. **Non-agents** who post in the thread get an ephemeral notice; nothing is delivered.
5. **AI triage and drafts.** After a customer message, the bot posts a triage card and, when it is safe to answer, a suggested reply with **Send**, **Edit** and **Discard** buttons. Drafts never auto-send; only a human click, or the Edit modal submit, delivers one. Legal, payment, refund, account-access, safety and personal-data topics get `needsHuman` and no draft. The model comes from the existing `VERTEX_MODEL_ID`; `AI_GENERATION_ENABLED=false` turns drafts off.
6. **Superseded drafts.** A newer draft marks older open drafts of the same conversation as **superseded** and updates their cards with "Superseded by a newer draft". A superseded draft counts as handled and cannot be sent or edited.
7. **Status.** The parent card's **Close** and **Reopen** buttons set `closed` or `open`. A visitor message reopens a conversation and refreshes the card. An agent reply sets `waiting_on_customer`. The card refreshes after each change.

Routes: `POST /api/support/slack/events` (Events API, url_verification, message events; `event_id` receipts dedupe Slack retries), `POST /api/support/slack/interactions` (buttons, modal submission), and `POST /api/support/slack/dispatch` (scheduler sweep). Requests are verified with the v0 signing secret over the raw body, with a 5-minute replay window. Agent replies and draft sends run inline before the response, because Cloud Run throttles CPU after a response (`cpu_idle = true`) and each delivery is one Firestore transaction plus one Resend call.

### Outbox and dispatch sweep

Slack work is queued in `supportSlackOutbox` with deterministic job ids, so a retried transaction cannot duplicate a job. Jobs are processed right after the request when possible. Cloud Scheduler runs `freelance-support-slack` every minute (`POST /api/support/slack/dispatch`, OIDC as `freelance-support-slack`, 60 s deadline, no scheduler retries) to pick up whatever is still due. Failed Slack calls back off exponentially, honour `Retry-After`, and stop after 8 attempts (state `failed`). Terraform sets `support_slack_dispatch_enabled` to turn the sweep on.

### Configuration

| Name | Kind | Notes |
| --- | --- | --- |
| `SLACK_BOT_TOKEN` | Secret Manager | Bot token, `xoxb-…`. Terraform: `slack_secrets["SLACK_BOT_TOKEN"]`. |
| `SLACK_SIGNING_SECRET` | Secret Manager | Signing secret of the app. Terraform: `slack_secrets["SLACK_SIGNING_SECRET"]`. |
| `SUPPORT_SLACK_CHANNEL_ID` | Env (`support_slack_channel_id`) | Channel id of `#support`, `C…` or `G…`. |
| `SUPPORT_SLACK_AGENT_IDS` | Env (`support_slack_agent_ids`) | Comma-separated Slack member ids, `U…` or `W…`. Only these users can reply to customers, send drafts or close conversations. |
| `SUPPORT_SLACK_SCHEDULER_EMAIL` | Env (set by Terraform) | Service account `freelance-support-slack` that may call the dispatch route. |
| `SUPPORT_SLACK` | Kill switch | `off`, `false`, `0` or `disabled` turns Slack off. Routes then return 503 and chat falls back to email only. Unset means on, provided the configuration is valid. |
| `SUPPORT_EMAIL_NOTIFY` | Kill switch | Only with Slack configured. `off` stops the per-message notification email to customer@, so Slack is the only notice. Unset means on (dual-run). |

Slack stays off unless the token, signing secret, channel id and at least one agent id are all valid.

### Slack app

Create the app from this manifest, install it to the workspace, invite it to `#support` (`/invite @Freelance Support`), and store its token and signing secret in Secret Manager. `#support` is a **public** channel, so the app needs the public-channel history scope and event.

```yaml
display_information:
  name: Freelance Support
features:
  bot_user:
    display_name: Freelance Support
    always_online: true
oauth_config:
  scopes:
    bot: [chat:write, reactions:write, channels:history, users:read]
settings:
  event_subscriptions:
    request_url: https://freelance-place.com/api/support/slack/events
    bot_events: [message.channels]
  interactivity:
    is_enabled: true
    request_url: https://freelance-place.com/api/support/slack/interactions
  org_deploy_enabled: false
  socket_mode_enabled: false
```

The app talks to Slack with a small fetch client (`src/lib/support/slack/client.ts`). It adds no SDK dependency.

### Limits

- Replies an agent writes directly in the Resend inbox to customer@ are **not** mirrored into Slack or the conversation. Reply in the Slack thread instead.
- Edits and deletions made in Slack after a send are not propagated. Email cannot be unsent.
- Attachments are shown as a count ("open in Resend"), not forwarded.

### Firestore additions

`supportSlackThreads/{sha256(channel:ts)}` (thread to conversation), `supportEmailThreads/{sha256(messageId)}` (email thread to conversation), `supportSlackOutbox/{jobId}` (`type`, `state`, `attempts`, `nextAt`, `leaseUntil`), `supportSlackDrafts/{jobId}` (`draft`, `triage`, `state: open | sent | discarded | superseded`, Slack message ref), and `supportSlackEvents/{event_id}` (receipts). Conversations gain `channel`, `status`, `triage`, `slack`, `slackClaim` and `emailThread`. Email messages carry `source: 'email'`, and Slack-sent agent replies carry `source: 'slack'` and the agent id. No composite indexes are needed.

### Slack acceptance checklist

- Start a chat in an incognito window: one parent card appears in `#support`, and the agent gets a notification. Three more chat messages become three replies in its thread.
- Reply in the thread: the widget shows it within 8 seconds, and the message gets ✅.
- `// note` in the thread: nothing reaches the widget, and the message gets 🔒.
- A non-agent in the thread gets an ephemeral refusal and nothing is delivered.
- Send an email to customer@: auto-ack once, one parent card with the subject, and a Slack reply reaches the customer threaded under their email.
- A pricing question gets a draft with no invented numbers. A refund request gets `needsHuman` and no draft.
- Two drafts in a row: the first card says "Superseded by a newer draft" and its buttons no longer work.
- Close, then send a customer message: the card shows open again.
- Replay the Slack event (same `event_id`) and the Resend webhook: no duplicate message or email.
- Set `SUPPORT_SLACK=off`: routes return 503 and chat falls back to the email flow.

## Verification

`npm run test:support` exercises the actual Resend SDK and webhook signature verifier with mocked HTTP/Firestore (no external email). Coverage includes the round trip, sender allowlist, quote removal, account isolation, retry idempotency, simultaneous sends, request-size limits, cookie options, and rate limits. The Slack tests cover signatures and replay windows, the Slack client and its errors, Block Kit escaping, outbox retries and the sweep, thread-root email headers, card refreshes, superseded drafts, inline route delivery, and the Slack routes (agents, notes, drafts, modals, status, and event dedupe). Run `npm run typecheck` and `npm run build` before release.
