# Dribbble profile import

Dribbble uses direct server-side OAuth in Freelance Place because Dribbble is not currently a provider in the configured Nango Cloud environment. GitHub and LinkedIn continue to use Nango.

## OAuth app configuration

Register a Dribbble OAuth application and use the callback for the environment where it will run:

- Production: `https://freelance-place.com/api/integrations/dribbble/callback`
- Local development: `http://localhost:3000/api/integrations/dribbble/callback`

Use a separate Dribbble OAuth app for local development and production so each app can keep its exact callback URI. The Dribbble app callback was verified saved to the production URI on 2026-11-09. It must match `DRIBBBLE_REDIRECT_URI` in the runtime.

Request only the `public` scope. Do not request `upload`; the importer reads the authenticated user's profile and published shots and never creates or edits Dribbble content.

## Runtime configuration

For local development, set these server-only values in an ignored local environment file:

```dotenv
DRIBBBLE_CLIENT_ID=
DRIBBBLE_CLIENT_SECRET=
DRIBBBLE_REDIRECT_URI=http://localhost:3000/api/integrations/dribbble/callback
```

For production, set the Terraform inputs `dribbble_client_id` and `dribbble_client_secret_name`. Create the referenced Secret Manager secret and add an enabled version containing the **rotated** client secret before applying Terraform. The runtime service account receives secret accessor access only to that configured secret; Cloud Run reads it through a secret reference. `dribbble_redirect_uri` defaults to `https://${canonical_domain}/api/integrations/dribbble/callback` and can be overridden when needed.

Generate a fresh Dribbble client secret before use. Enter secrets directly into the local ignored environment file or Secret Manager; do not put them in Terraform variable values, source control, browser-visible settings for this app, or chat.

## Import and removal behavior

- The signed-in user approves OAuth with `public` scope. The callback validates state and the same Firebase user before exchanging the code.
- The app fetches the Dribbble profile and up to 20 published shots, strips markup, caps imported text, and stores only the normalized snapshot under that user's Firestore profile sources.
- The access token is discarded after the import and is never stored. To refresh the snapshot, the user authorizes Dribbble again.
- Removing the import deletes the saved snapshot from Freelance Place. It does not revoke the app's grant at Dribbble; the user can revoke that grant in [Dribbble application settings](https://dribbble.com/account/applications).
- The snapshot is sent to Vertex AI only when the user selects Create profile with AI after the processing notice. There is no separate checkbox.

Production setup on 2026-11-09: the callback is registered in Dribbble, `DRIBBBLE_CLIENT_SECRET` version 1 exists in Secret Manager, and Cloud Run is configured with the client ID, callback URI, and secret reference. No credential values belong in this document. Terraform inputs for future applies must retain these settings; the secret value is managed outside Terraform.
