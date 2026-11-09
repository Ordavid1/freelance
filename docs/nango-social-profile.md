# GitHub and LinkedIn profile imports

The profile editor uses Nango Connect for user authorization. Google/Firebase signs a user into Freelance Place; Nango separately authorizes that user to share data from GitHub or LinkedIn.

## Nango setup

1. In the Nango environment whose API key is stored in Secret Manager as `NANGO_API_KEY`, create or configure GitHub and LinkedIn OAuth integrations.
2. Use the integration IDs `github` and `linkedin`, or set Terraform variables `nango_github_integration_id` and `nango_linkedin_integration_id` to the IDs shown in Nango.
3. Add each OAuth app's client ID and secret to its Nango integration. Register the OAuth callback URL shown by Nango in the corresponding GitHub/LinkedIn developer app.
4. Request the minimum scopes needed: GitHub `read:user`; LinkedIn OpenID Connect `openid` and `profile` (request `email` only if the integration configuration requires it). The app imports LinkedIn identity/profile fields exposed by the granted API scopes; it does not claim access to private experience data that LinkedIn has not granted.
5. Apply the Terraform change so the Cloud Run runtime service account can access the existing `NANGO_API_KEY` Secret Manager secret. The secret value is not stored in Terraform or sent to the browser.

## Runtime flow

- The signed-in user's Firebase UID is attached to a short-lived Nango Connect session.
- Nango's Connect UI performs OAuth in the browser.
- Server routes list only connections tagged to that Firebase UID and verify ownership before making provider requests.
- GitHub imports the user's public profile and up to 20 recent public repositories. Private repository content is not requested.
- LinkedIn imports the profile fields returned by its OpenID Connect userinfo endpoint and the scopes approved for the integration.
- Connected imports reload when the profile editor opens. They are sent to Vertex when the user selects Create profile with AI, beside the processing notice; there is no separate checkbox.

## Environment values

Production uses Terraform variables for integration IDs and a Secret Manager reference for the Nango key. For local development, set `NANGO_API_KEY` only in an ignored local environment file and set the two integration IDs there; never prefix these values with `NEXT_PUBLIC_`.

## LinkedIn developer-app configuration

`deploy/production.env` records `LINKEDIN_CLIENT_ID=77gm9un3qkh70o` and the Secret Manager names/versions. `LINKEDIN_CLIENT_SECRET` version 1 is the source of the developer-app secret. No secret value is stored in deployment files or Terraform.

Configure the existing `linkedin` integration in the environment selected by the deployed Nango API key:

```sh
python3 scripts/configure-nango-linkedin.py --apply
python3 scripts/configure-nango-linkedin.py
```

The command uses gcloud's active identity to read the pinned secrets and sends them directly to Nango over HTTPS. It prints only integration metadata and missing-field status. Run it from an operator session with permission to access those secrets; normal image deployment does not need this permission or rerun configuration. The live Nango key currently selects **dev**; this is independent of the Cloud Run service being production. A later Nango environment migration must configure the destination integration before changing the runtime key.

Register `https://api.nango.dev/oauth/callback` in the LinkedIn app's authorized redirect URLs and enable **Sign In with LinkedIn using OpenID Connect**. The importer requests `openid,profile`; this does not grant access to employment history. Nango stores and manages the developer-app credentials, so the app does not read `LINKEDIN_CLIENT_ID` or `LINKEDIN_CLIENT_SECRET` at runtime.

## GitHub OAuth app settings

For the existing Nango `github` (User OAuth) integration:

- Homepage URL: `https://freelance-place.com`
- Redirect URI: `https://api.nango.dev/oauth/callback`
- Allow wildcard matching: off
- Enable Device Flow: off (the app uses the browser authorization-code flow)
- Expire user access tokens: on; Nango handles token refresh
- Requested import scope: `read:user`

The callback is Nango's callback, distinct from the direct Dribbble callback hosted by Freelance Place. These settings assume Nango's default callback; update the provider registration if a custom Nango callback is configured later.
