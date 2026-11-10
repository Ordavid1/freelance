# Customer support chat (Resend)

The site has a Hebrew, RTL support conversation that works for guests and signed-in users. Desktop uses a bottom-right launcher; at widths up to 760px, the launcher is a small icon next to sign-in/sign-out in the header. The mobile conversation opens as a native modal sheet. It supports suggested topics, delivery/retry states, unread replies, reduced motion, and a private conversation that survives page navigation and reloads in the same browser.

## How the email bridge works

1. The visitor supplies a message and contact email (name optional). Contact details from an existing signed-in session are prefilled. Contact emails supplied by visitors are not verified.
2. `POST /api/support` saves a private Firestore message and sends a plain-text notification through Resend to `SUPPORT_INBOX_EMAIL`, defaulting to **customer@freelance-place.com**. Visitor input cannot choose notification recipients. The notification includes their name, contact email, and pathname (no query string).
3. Each conversation gets a private, random reply alias, `chat+<token>@SUPPORT_REPLY_DOMAIN`. Click **Reply** in your normal inbox and write above the quoted original. Do not replace the Reply-To address with the visitor's email if you want the reply to appear in chat.
4. Resend emits `email.received` to `POST /api/support/webhook`. The server verifies the raw body with the webhook signing secret, retrieves the received email through the Resend API, checks that the sender is your inbox or an explicitly allowed team address, extracts the new reply, and appends it to the matching chat exactly once.
5. A visible, open chat checks for replies every 8 seconds. An existing, minimized chat checks every 45 seconds. Hidden tabs stop polling. No typing, online presence, or read receipts are fabricated. Visitors must return to the same browser to see replies; this version does not email notifications to visitors.

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

## Verification

`npm run test:support` exercises the actual Resend SDK and webhook signature verifier with mocked HTTP/Firestore (no external email). Coverage includes the round trip, sender allowlist, quote removal, account isolation, retry idempotency, simultaneous sends, request-size limits, cookie options, and rate limits. Run `npm run typecheck` and `npm run build` before release.
