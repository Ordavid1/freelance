# Application data infrastructure

The application data foundation is managed alongside Cloud Run:

- Firestore Native default database with deletion protection. The security hardening configuration adds point-in-time recovery, daily backups retained for 30 days, and explicit deny-all client rules (application access uses the Admin SDK).
- A private, versioned user uploads bucket in `data_location` (default `me-west1`).
- Runtime-only Firestore and bucket access.
- Identity Platform configuration and local/Firebase authorized domains. The current application accepts Google sessions only; the enabled Google provider and `google_sign_in_enabled` runtime flag must agree.
- A Firebase Web App whose public runtime SDK configuration is served by a no-store API route.

Firestore's location cannot be changed after creation. The current default is `me-west1` (Tel Aviv), matching the existing Cloud Run region. Review any data-residency requirement before applying the first plan. Google sign-in provider configuration and other social OAuth providers require owner-controlled OAuth client configuration and production-domain approval; do not put client secrets in Terraform variables/state. Membership billing secret references and its OIDC renewal scheduler are managed here; the GCP billing-account attachment and client–freelancer payments are separate.

## Security rollout

The hardening configuration also adds TTL cleanup for `securityRateLimits.expiresAt`, a modern TLS policy with a TLS 1.2 minimum, and an attached Cloud Armor API throttle in **preview**. Preview records potential limits but does not block traffic. Inspect shared-IP, sign-in, OAuth and Cardcom callback traffic before setting `edge_rate_limit_preview=false`. Account-level application quotas are enforced independently.

These are prepared changes, not a record of applied infrastructure. Review the actual production plan with the existing image, Google sign-in setting and secret-reference variables preserved. **Do not apply with the default `engine_image=null` to an existing deployment**: the conditional resources would be removed. Account for PITR, backup, Cloud Armor, TTL-delete and access-log charges; restrict log access and retention because provider callbacks can carry sensitive query parameters. Complete a restore into a separate database before relying on the recovery settings. See the [security plan](../../docs/security-plan.md) for the rollout and acceptance criteria.
