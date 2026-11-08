# GitHub and LinkedIn profile imports

The profile editor uses Nango Connect for user authorization. Google/Firebase signs a user into Freelance Zone; Nango separately authorizes that user to share data from GitHub or LinkedIn.

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
- Connected imports reload when the profile editor opens. They are sent to Vertex only after the user checks the profile-generation consent box and presses Generate.

## Environment values

Production uses Terraform variables for integration IDs and a Secret Manager reference for the Nango key. For local development, set `NANGO_API_KEY` only in an ignored local environment file and set the two integration IDs there; never prefix these values with `NEXT_PUBLIC_`.
