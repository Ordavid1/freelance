# Dribbble OAuth Design

## Intent

Let a signed-in Freelance Place user authorize Dribbble and import their own profile plus recent public shots into the profile editor. The import is read-only and follows the existing explicit consent step before profile generation.

## Approaches

- **Nango Connect:** preserves the existing auth architecture, but the Dribbble provider is not in the Nango Cloud catalog and cannot be created by this tenant. Rejected for this implementation because it cannot complete without upstream Nango provider support.
- **Direct OAuth in Freelance Place (selected):** use Dribbble's documented OAuth flow and API from server routes. This works with the already registered Dribbble app and keeps credentials on the server.
- **Self-host or fork Nango:** keeps the Nango model but adds a separately operated integration platform and ongoing maintenance. Rejected as disproportionate for one read-only source.

## Design

- Add a Dribbble authorization start route and callback route. Bind a cryptographically random OAuth `state` to a short-lived, HTTP-only, same-site cookie; require the existing signed-in Freelance Place session on both routes; validate state before exchanging the authorization code.
- Keep `DRIBBBLE_CLIENT_ID`, `DRIBBBLE_CLIENT_SECRET`, and the registered callback URL in server-only environment configuration. Request only Dribbble's `public` scope; never request `upload`.
- In the callback, exchange the code server-to-server, fetch `/v2/user` and up to 20 items from `/v2/user/shots`, normalize and bound all imported text, then discard the access token without persisting it.
- Save only the normalized Dribbble profile and shot snapshot under the authenticated user's Firestore subcollection. Provide authenticated read and delete routes that operate only on that user's snapshot. Refresh requires authorizing again; deleting the snapshot does not revoke the grant at Dribbble, so the UI must describe this as removing imported data and direct users to Dribbble settings to revoke app access.
- Add a Dribbble connect/import card to the profile editor, reload the saved snapshot when the editor opens, include it among profile-generation sources only after the existing consent checkbox is checked, and remove the existing manual Dribbble URL control while leaving Behance and Website links intact.
- Add environment and deployment documentation. Production deployment and external Dribbble application changes are outside this implementation; the Dribbble app callback must be changed to the deployed callback URL and the client secret must be entered by the user into the deployment's secret store.

## Constraints and non-goals

- Do not use Nango for Dribbble, change GitHub or LinkedIn handling, store a Dribbble access token, publish or modify Dribbble content, deploy, apply Terraform, or enter provider credentials into a browser form.
- Use the app's existing Firebase session and Firestore ownership patterns. The OAuth callback URI must be the exact deployed app callback registered with Dribbble.
- Treat Dribbble descriptions and profile text as untrusted imported content; remove markup and cap lengths before persistence or model submission.

## Review points

- Confirm that storing an imported snapshot while discarding the token matches the expected refresh and disconnect behavior.
- Confirm that the user will update Dribbble's registered callback and provide the rotated client secret through the deployment secret store before live use.
