# Sign-in users to Resend audience

Every Google sign-in is mirrored into one Resend segment (the audience that broadcasts are sent to).

## Where names live

| Place | What it holds | Notes |
| --- | --- | --- |
| Firebase Auth user (`adminAuth().getUser(uid)`, `listUsers`) | one combined `displayName`, `email`, `photoURL` | The source for everyone who signed in before this feature. No separate first and last name. |
| Firebase ID token and session cookie (`decoded.name`) | the same combined `name` | `getCurrentUser()` exposes it as `user.name`. |
| Google OpenID profile (`given_name`, `family_name`) | separate parts | Reachable only in the sign-in result, `getAdditionalUserInfo(credential).profile`. Firebase does not store it. |
| Firestore `audienceContacts/{uid}` (new) | `email`, `firstName`, `lastName`, `nameSource`, Resend sync state | Server-written. Captured at sign-in; this is where the streaming job reads names. |
| Firestore `profiles/{uid}.name` | name the person typed in their freelancer profile | Free text and only for people with a profile. Do not use as the contact name. |

`nameSource` is `google-profile` (exact parts from Google), `display-name` (the combined name split at the first space) or `none`.

## Flow

1. `POST /api/auth/session` verifies the Google ID token, then after the response is sent calls `recordSignInContact`.
2. It stores the name in `audienceContacts/{uid}` and upserts the Resend contact (`src/lib/audience/resend-contact.ts`).
3. The upsert is idempotent. `unsubscribed` is set only when the contact is created, so an unsubscribe is never undone by a later sign-in. Names only fill empty fields.
4. A failure never affects sign-in. It is recorded as `resendSyncState: 'error'` on the document.

## Configuration (dormant until set)

| Variable | Meaning |
| --- | --- |
| `RESEND_API_KEY` | already provisioned for support mail; must be a full-access key (contacts endpoints reject sending-only keys) |
| `RESEND_AUDIENCE_SEGMENT_ID` | the Resend segment to fill, for example the existing "General" segment |
| `RESEND_AUDIENCE_NEW_CONTACTS` | `unsubscribed` (default) or `subscribed` for contacts created by sign-in |

Every release sets both variables from `deploy/production.env` (`scripts/deploy-engine.sh`), and the Terraform variable defaults match. To change them, edit both. Terraform: `resend_audience_segment_id` and, if wanted, `resend_audience_new_contacts = "subscribed"` in the production tfvars; they are passed to Cloud Run as the two variables above. Apply Terraform to enable the sync. Merging the code changes nothing until then.

**Decision (2026-11-13, Or):** sign-in contacts are created subscribed. The privacy and terms pages are to be updated by Or before the first broadcast; every broadcast carries the Resend unsubscribe link.

**Consent.** The default creates contacts as unsubscribed, because signing in is not consent to marketing mail, and the privacy page says Resend is used for support only. Switching to `subscribed` should follow a legal check (Israeli anti-spam rules) and an update of the privacy text.

## Backfill existing users

```
node --experimental-transform-types scripts/audience/backfill-resend-audience.ts --project <gcp-project-id>            # dry run
node --experimental-transform-types scripts/audience/backfill-resend-audience.ts --project <gcp-project-id> --apply
```

Needs Application Default Credentials plus the two Resend variables. It pauses between users to stay under Resend's 2 requests per second and is safe to re-run.
