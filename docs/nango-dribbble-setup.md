# Dribbble profile import through Nango

Status checked 8 November 2026: the connected Nango dev environment has GitHub and LinkedIn integrations, but the integration picker returns no match for Dribbble. Dribbble sign-in is now complete. The Freelance Place registration form is filled but unsubmitted. No OAuth app, credentials, Nango integration, or connection has been created. Registration requires accepting API terms that list designer-hiring and job-search services among excluded uses; this appears to cover the marketplace and needs explicit written permission from Dribbble before proceeding.

## Dribbble permission required

The API terms explicitly list designer search, designer-hiring/contact tools, and job advertising/search services as excluded uses. They also say developers should contact Dribbble to check whether a proposed use is permitted. User OAuth consent alone does not resolve the marketplace restriction.

Draft permission request (not sent):

> We are building Freelance Place (https://freelance-place.com), a paid freelance marketplace with project listings, proposals, messaging, and recommendations. We would like to let a freelancer explicitly connect their own Dribbble account through Nango with the public read-only scope, import their own profile and public portfolio links into an editable profile draft, and use their reviewed profile and skill tags for project matching. Profile generation may process the imported information through Vertex AI. We would not post, modify, delete, or harvest other users' content. Your API terms list hiring and job-search uses as excluded categories. Can you provide written authorization for this specific use, including the proposed profile-generation and matching processing, and identify any restrictions on storage, attribution, retention, and removal? We will keep the integration inactive pending your approval.

Terms checked: https://developer.dribbble.com/terms/

## Provider support required

Nango documents two paths for APIs absent from its catalog: request provider support from Nango, or contribute a tested provider configuration to Nango. Creating a generic integration ID alone does not add OAuth provider support. Do not substitute a different API provider or the generic MCP OAuth provider.

Ready-to-send provider request (not sent):

> Please add Dribbble v2 OAuth support for Freelance Place. We need read-only profile and public portfolio import for a user who explicitly connects their own account. Authorization URL: https://dribbble.com/oauth/authorize. Token URL: https://dribbble.com/oauth/token. API base URL: https://api.dribbble.com/v2. Scope: public only. Initial endpoints: GET /user and GET /user/shots. We do not need upload, modification, or deletion permissions.

## After provider support is available

1. Obtain Dribbble written permission for the marketplace use. Then at https://dribbble.com/account/applications/new register the Freelance Place app, using https://freelance-place.com as the website.
2. Register the exact callback shown by the Nango integration. Nango's default is https://api.nango.dev/oauth/callback; use a configured custom callback only when both systems agree.
3. Keep the OAuth client secret in Nango's credential settings; do not put it in chat, frontend code, or Git.
4. Configure `public` scope, not `upload`.
5. Add the Dribbble provider to the site's existing authenticated Nango session/import/disconnect flows. Keep end-user ownership checks and the fixed provider API host.
6. Import the user's name, bio, profile URL, public shots and portfolio links into an editable profile draft. Review and save explicitly before publishing anything.
7. Verify a real consent, import, disconnect, and reconnect cycle before marking the feature operational. Until then the existing Dribbble button accepts a public URL; it is not an OAuth connection.

References:
- https://developer.dribbble.com/v2/
- https://developer.dribbble.com/v2/oauth/
- https://nango.dev/docs/integrations/contribute-or-request-api.md
- https://nango.dev/docs/guides/auth/auth-guide.md
