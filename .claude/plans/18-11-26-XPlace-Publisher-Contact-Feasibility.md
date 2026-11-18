# XPlace publisher contact: feasibility check (18-11-26)

Owner: thread "Verify XPlace publisher contact flow feasibility" · Branch: `claude/project-thread-8w839h` · Type: research and decision. No application code, no outbound email, no deploy.

Status legend: `[ ]` open · `[x]` done · `[!]` needs Or (decision or counsel).

---

## 0. The question

Or's idea: copy XPlace projects into Freelance Place project cards. When a freelancer applies, the platform emails the XPlace publisher, and the publisher's email reply appears as a native message in the Messages board.

Or's concern: XPlace does not show publisher email addresses.

## 1. Verdict

**Do not build the flow as described.** It fails on three independent grounds, and any one of them is enough:

1. **No email address exists to send to.** XPlace exposes no publisher email on any public page, in the page's embedded data, or through the paths we already use (extension, paste, PDF, project link). Nothing legitimate fills that gap (section 3).
2. **Sending it would very likely be unlawful spam.** An unsolicited email telling a publisher "a freelancer offers to do your project, reply here" promotes a service. Under section 30A of the Israeli Communications Law that needs the recipient's prior consent. Statutory damages are up to ₪1,000 per message, with no need to prove harm, and class actions are common (section 4.2).
3. **The listing itself would mislead our own paying members.** A card that accepts applications for a project whose owner never chose Freelance Place, and who may never answer, breaks the honesty model the project already adopted for seed projects (section 4.4). XPlace's terms also bar copying its content for commercial use (section 4.1).

**What to build instead (recommended, section 6):** the same user experience, but only for publishers who **chose** to bring their XPlace projects to Freelance Place. Most of it already exists (the extension's project import, which reads XPlace's own `isProjectOwner` flag). The missing pieces are a "new proposal" email to the project owner and a reply-by-email path that lands in Messages. That gives exactly what Or described ("freelancer applies → publisher gets an email → reply appears in Messages"), lawfully, for every consenting publisher, and it also benefits native publishers.

---

## 2. What XPlace actually exposes (checked 18-11-26, public pages only, no login)

Method: one anonymous HTTPS request per page, identified user agent, at least 10 s apart (XPlace `Crawl-delay: 10`). Only field **names** and value **shapes** were inspected; no personal values were stored or copied into this repo.

| Source | Publisher identity data present | Email? |
|---|---|---|
| Public project page `xplace.com/project?id=<id>` (server-rendered Next.js; embedded flight JSON) | `userDto.firstName`, `userDto.lastName`, `companyDto.companyNameHe/En`, `companyDto.tel` (a **full phone number**, shape `+972 xx-xxx-xxxx`), `companyLogoUrl`, `lastLogin`, account type | **No.** No `email` key, no `mailto:` link, no address in the HTML |
| Legacy page `/il/job-bids/<id>` | Title and short description; body loads from `/rest/…` | No (and `/rest/` is `Disallow` in robots.txt) |
| Public profile `/il/u/<slug>` | schema.org name, slogan, about, logo | No |
| Extension (user's own logged-in tab) | Reads an allowlist only: `projectId`, `isProjectOwner`, title, description, amount, due date, categories, company name. Contact fields are never read (`extensions/xplace-import/src/shared/extract-project.js`) | No, by design |
| Paste / PDF | Whatever is visible on screen; XPlace shows no publisher email on a project | No |
| XPlace terms, "project publishing policy" | Publishers commit **not** to put contact details ("פרטי התקשרות") in a project | So descriptions should not contain one either |

Notes:

- The phone number in the anonymous payload is a data-leak risk on XPlace's side, not an opportunity. Our importer's allowlist already ignores it (`src/lib/imports/xplace/project.ts`, `draftFromProject`), and it must stay that way. SMS or calls to it fall under the same spam section (SMS and automatic dialing are covered) and under privacy law.
- `robots.txt` (fetched 18-11-26): `Allow: /`, `Crawl-delay: 10`, `Disallow: /*rest/`, `/*SearchProjects.xpl`, `/*SearchProviders.xpl`, `/*jobs*?` and others. Bulk discovery of projects through XPlace search is disallowed, so a server-side "import all projects" crawler would also break robots rules.

## 3. Can an email be obtained or inferred legitimately?

| Route | Assessment |
|---|---|
| Guess from name + company domain (`first@company.co.il`) | Unreliable (many publishers are private people with Gmail), and it is still collecting personal data the person never gave us, for a purpose they never agreed to. Not legitimate. |
| Paid enrichment services (look up email by name/phone) | Same privacy problem, plus they rely on scraped data. Not legitimate for this purpose. |
| XPlace on-platform messaging to the publisher | Exists only inside XPlace for logged-in, paying experts who bid. XPlace terms ban unsolicited ("ללא הזמנה") messages and spam to any user, with account closure. Using it to pull publishers off-platform would breach those terms. |
| XPlace public API or partner / data-feed program | None found. The only programs in the terms are an affiliate ("חבר מביא חבר") scheme for referring paying users and CallMe virtual phone numbers. Neither gives contact data. |
| Official channel to XPlace | `support@xplace.com` (from the terms). A business partnership (official feed with publisher opt-in) is the only route through XPlace, and is unlikely since Freelance Place is a direct competitor. |
| The publisher gives it to us | **The only legitimate source.** Happens when the publisher signs in to Freelance Place (verified Firebase email), for example through the extension's import button on their own XPlace project. |

## 4. Legal and policy risk (not legal advice; `[!]` counsel should confirm before any outreach feature)

### 4.1 XPlace terms of use (`/il/terms`, read 18-11-26)

- Copying, reproducing or otherwise exploiting the site or parts of it **for any commercial purpose** without XPlace's prior written consent is prohibited. Content licences that users grant go to XPlace, not to third parties.
- Unsolicited messages to users are banned.
- Publishers must not include contact details in projects.

Consequence: copying other people's XPlace projects into Freelance Place as a competitor is a clear terms breach and an easy basis for a cease-and-desist or a claim. Importing **your own** project (the existing extension path) is different: the content belongs to the user who chooses to move it.

### 4.2 Israeli anti-spam law (Communications Law, section 30A)

- An "advertisement" (דבר פרסומת: a message sent commercially that encourages buying a service or spending money) sent by email, SMS, fax or automatic dialing needs the recipient's **prior explicit consent**.
- The one exception that might look relevant, a single approach to a **business** asking for consent, does not fit: many XPlace publishers are private individuals, the message we would send is the offer itself rather than a consent request, and we still have no address.
- Statutory damages up to **₪1,000 per message without proof of damage**, personal liability for managers in some cases, and a large body of class actions. An email that says "a freelancer bid ₪X on your project, reply here" promotes the freelancer's service and the platform, so a court would very likely treat it as an advertisement.

### 4.3 Privacy Protection Law, including Amendment 13 (in force since 14-08-2025)

- Publicly visible personal data (name, phone, company) is still personal data. Collecting it from another site into our database and using it for a new purpose (contacting the person) needs a lawful basis and a notice that the person never received.
- The direct-mail provisions (דיוור ישיר) require stating the data source and offering removal; the Privacy Protection Authority's enforcement powers and fines were raised sharply by Amendment 13.
- Our privacy policy describes data that users give us. Third-party publisher records would not be covered by it.

### 4.4 Honesty model (Freelance Place's own rules)

- On 2026-11-17 all AI showcase projects were closed and labelled because cards that look open but have no reachable client mislead freelancers. An imported third-party listing whose owner never joined is the same problem in a stronger form: members pay for access, apply, and most applications would go nowhere.
- Even with a "sourced from XPlace" label, it would also be legally a consumer-protection risk (misleading representation about an available deal).

## 5. How the current system works (read 18-11-26 on `origin/main` 8c88715)

- **Apply flow** (`src/app/api/marketplace/proposals/route.ts`, `POST`): inside one Firestore transaction it creates `proposals/{sha256(slug:uid)}`, `conversations/{same id}` with `clientUid = project.ownerUid`, and a first message `kind: 'proposal'`, after `assertContactAllowed` (blocks, account state). Sample projects go to `demo-proposals` instead. **No email is sent to the project owner today.**
- **Messages board** (`src/app/api/marketplace/conversations/route.ts`): lists conversations where the user is `clientUid` or `freelancerUid`; `POST` appends a message in a transaction, again through `assertContactAllowed`. Both sides must be Freelance Place users (uids).
- **Project import** (`src/app/api/marketplace/projects/route.ts`, `src/lib/imports/xplace/*`): the importer **becomes the owner** (`ownerUid = user.uid`) after an attestation that they own or may publish the project; provenance in `importSource`; idempotency per owner. The extension also sends XPlace's own `isProjectOwner` flag as `ownerSignal`.
- **Resend outbound**: project digest mail (`src/lib/notifications/delivery.ts`) with idempotency keys, one-click `List-Unsubscribe`, verified-email check, preferences in `projectMailPreferences`.
- **Resend inbound**: one webhook `/api/support/webhook` (signature-verified). `src/lib/support/service.ts` routes replies by a per-conversation address `chat+<32 hex token>@<SUPPORT_REPLY_DOMAIN>` (`replyRoute`, `supportReplyRoutes`), strips quoted text (`extractSupportReply`), dedupes by receipt, and filters auto-replies and bulk mail. Today this only feeds `supportConversations` and only from allowlisted staff senders.

So the hard parts of "email in, native message out" already exist in the support stack and can be generalised.

## 6. Architecture options

### Option A. Cold email to XPlace publishers with reply routing into Messages
Third-party listings, email the publisher on each application, route replies through `chat+token@` into a conversation.
- Technically feasible only with an address, which we do not have.
- Blocked by sections 3 and 4 (terms, spam law, privacy, honesty).
- **Not recommended. Do not build.**

### Option B. "Claim your listing" invitation
Show XPlace projects as unclaimed listings and invite the publisher to claim them.
- Still needs a contact channel to send the invitation, so it hits the same wall. Displaying the copied listings breaches XPlace terms on its own.
- **Not recommended.**

### Option C. Aggregator card that links out to XPlace ("apply on XPlace")
- No contact needed, but it is still commercial copying of XPlace content and adds no messaging value.
- **Not recommended** without XPlace's written consent.

### Option D (recommended). Publisher-initiated mirroring + email bridge for project owners
Keep the rule that every project on Freelance Place has an owner who is a Freelance Place user. Make it effortless for XPlace publishers to bring their projects, and give **all** owners the email loop Or wants.

1. **Acquisition (mostly built):** the extension shows the publisher card on the user's own XPlace project (`isProjectOwner === true`), one click imports it. Follow-up: a "mirror all my open XPlace projects" action in the extension, run only from the publisher's own logged-in tab and only for projects XPlace marks as theirs.
2. **New-proposal notification (new, generic):** when a proposal is created for a real project, queue a transactional email to the owner's verified Freelance Place address (Firebase Auth `emailVerified`). Written through an outbox document in the same transaction as the proposal, then sent by the existing dispatch job pattern with a Resend idempotency key. Per-owner preference and one-click unsubscribe, reusing `projectMailPreferences`-style settings. This is transactional mail to a member about their own listing, so it is not an advertisement under 30A.
3. **Reply by email → native message (new, generalised from support):** each notification carries `Reply-To: msg+<token>@<reply domain>`, token stored in a `conversationReplyRoutes` collection (hash of token → conversationId + recipient uid + expiry). The existing webhook dispatches by local-part prefix: `chat+` to support, `msg+` to marketplace. The marketplace handler accepts the email only if the sender address equals the verified email of the uid the token was issued to, strips quoted text with the shared extractor, rejects auto-replies and bulk mail, dedupes by email id, and writes a message through the **same** transaction and `assertContactAllowed` check as `POST /api/marketplace/conversations`. The freelancer sees it in Messages like any other message.
4. **Symmetric later:** the same bridge can notify freelancers of client messages.

Why this is the right shape:
- It delivers Or's described experience end to end, for every publisher who opted in, and it improves the core product for native publishers too (today owners get no email when someone applies).
- Contact data always comes from the person themselves; consent and lawful basis are clear.
- It reuses existing, tested pieces (Resend inbound/outbound, reply extraction, idempotency, outbox, contact policy) instead of a special case for XPlace.
- No change to deployment architecture beyond the existing webhook and dispatch job; no LLM change.

Open design points for the implementation plan (if Or approves D):
- Generalise `src/lib/support/service.ts` reply parsing into a shared `src/lib/mail/inbound` module so support and marketplace share one extractor and one auto-reply filter.
- Rate limits for inbound replies per conversation; size caps equal to the message API (4,000 chars).
- Attachments: ignore in v1, tell the sender in the reply footer.
- Hebrew copy for the notification and a footer explaining "reply to this email to answer in Freelance Place".
- Tests: routing token parsing, sender mismatch rejection, dedupe, contact block, auto-reply filter.

### Option E. Partnership with XPlace
Ask XPlace (business contact via `support@xplace.com`) for an official feed with publisher opt-in. Lawful if agreed, but unlikely given the competition. Optional, business decision for Or.

## 7. Decisions for Or

- `[!]` Confirm that third-party XPlace listings (options A, B, C) are dropped.
- `[!]` Approve option D for a separate implementation plan and PR (new-proposal email + reply-by-email into Messages, then the extension "mirror all my projects" action).
- `[!]` Optional: counsel review of the notification copy and of option E if pursued.

## 8. Work done in this thread

- [x] Read the XPlace importer, extension extractor, apply flow, Messages API, notification delivery and support inbound/outbound code.
- [x] Fetched `robots.txt`, the terms page and one public project page (field names and shapes only).
- [x] Searched for an XPlace API or partner program (none found).
- [x] Reviewed anti-spam and privacy law points.
- [x] This plan file. No application code changed, no email sent.

## Sources

- XPlace terms: https://www.xplace.com/il/terms (read 18-11-26)
- XPlace robots.txt: https://www.xplace.com/robots.txt (read 18-11-26)
- Kol Zchut, spam law compensation: https://www.kolzchut.org.il/he/פיצוי_בגין_משלוח_דברי_פרסומת_ללא_הסכמה_של_הנמען_(חוק_הספאם)
- Chamber of Commerce, spam law refresher: https://www.chamber.org.il/serviceslobby/legal/74023/115485/
- Amendment 13 in force: https://digitalpolicyalert.org/event/32795-privacy-protection-bill-amendment-no-13-formerly-no-14-entered-into-force
- Chambers Data Protection & Privacy 2026, Israel: https://practiceguides.chambers.com/practice-guides/data-protection-privacy-2026/israel
