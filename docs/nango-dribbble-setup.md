# Dribbble profile import through Nango

Status checked 8 November 2026: the connected Nango dev environment has GitHub and LinkedIn integrations, but the integration picker returns no match for Dribbble. The Dribbble app-registration URL redirects to a sign-in screen. No Dribbble OAuth integration or connection has been created.

## Provider support required

Nango documents two paths for APIs absent from its catalog: request provider support from Nango, or contribute a tested provider configuration to Nango. Creating a generic integration ID alone does not add OAuth provider support. Do not substitute a different API provider or the generic MCP OAuth provider.

Ready-to-send provider request (not sent):

> Please add Dribbble v2 OAuth support for Freelance Place. We need read-only profile and public portfolio import for a user who explicitly connects their own account. Authorization URL: https://dribbble.com/oauth/authorize. Token URL: https://dribbble.com/oauth/token. API base URL: https://api.dribbble.com/v2. Scope: public only. Initial endpoints: GET /user and GET /user/shots. We do not need upload, modification, or deletion permissions.

## After provider support is available

1. Sign in at https://dribbble.com/account/applications/new and register the Freelance Place app, using https://freelance-place.com as the website.
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
