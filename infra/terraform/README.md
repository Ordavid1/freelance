# Application data infrastructure

The application data foundation is managed alongside Cloud Run:

- Firestore Native default database with deletion protection.
- A private, versioned user uploads bucket in `data_location` (default `me-west1`).
- Runtime-only Firestore and bucket access.
- Identity Platform email/password sign-in and local/Firebase authorized domains.
- A Firebase Web App whose public runtime SDK configuration is served by a no-store API route.

Firestore's location cannot be changed after creation. The current default is `me-west1` (Tel Aviv), matching the existing Cloud Run region. Review any data-residency requirement before applying the first plan. Google sign-in provider configuration and other social OAuth providers require owner-controlled OAuth client configuration and production-domain approval; do not put client secrets in Terraform variables/state. Billing integration and the GCP billing account are outside this configuration.
