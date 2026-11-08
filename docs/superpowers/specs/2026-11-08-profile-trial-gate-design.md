# Profile-Started Trial and Preview Gate

## Intent

Give a new account a clear, low-pressure preview of Freelance Place, then reward a quick profile setup with 14 days of full marketplace access. Make the ₪19.99 monthly price clear before the trial starts and after it ends.

## Goals

- Let signed-in users browse public projects and profiles before setup, in read-only preview mode.
- Explain that completing a profile starts 14 days of full access, followed by ₪19.99/month.
- Start one account-wide trial when the user completes the profile step for their chosen role.
- Keep freelancer setup AI-assisted and editable; keep hiring-side setup to confirming a name or business name.
- After the trial, show membership and profile access while requiring a paid membership for full marketplace activity.
- Never imply a charge or collect payment until a billing provider is connected.

## Non-goals

- Selecting or integrating a payment provider in this change.
- Charging existing accounts or silently changing their access.
- Requiring a CV, long bio, or AI-generated profile for project publishers.

## Approaches

1. **Free preview, then profile-started trial (selected):** signed-in users can browse public discovery, while member actions stay gated. Completing a role-appropriate profile starts the 14-day account-wide trial. This matches the chosen preview flow and the product’s lightweight client setup.
2. **Profile-first gate:** only profile setup and membership are available after sign-in, then profile completion starts the trial. This is clearer as a gate but removes the requested free preview.
3. **Trial from first sign-in:** starts the clock before users complete setup, which can waste trial days and does not match the stated profile incentive.

## Experience and behavior

- New-account preview surfaces a clear notice: “Build your profile to unlock 14 days of full access. After that, membership is ₪19.99/month.” The notice links directly to the appropriate profile setup.
- Preview mode allows viewing and searching public discovery content. Actions that create or manage marketplace activity—such as bidding, publishing, messaging, saving, or managing work—prompt the user to complete their profile. The exact gate should be enforced in the server routes as well as the UI.
- A freelancer completes setup by generating or editing a profile and saving at least their name, a tagline or summary, and one skill tag. Imported sources and optional sections remain optional; setup should feel quick.
- A project publisher completes setup by confirming a name or business name. No CV, professional bio, or portfolio is required.
- The first completed role-appropriate profile starts a single 14-day trial for the account. Switching roles does not restart or extend it.
- During the trial, the membership view shows the start and end dates and the upcoming ₪19.99/month price. The UI must state that recurring payment is not yet active if billing is not connected.
- After day 14, full member actions are blocked until membership is active. Profile editing and membership information remain available. Until billing is connected, the expired state explains that payment setup is not available; it must not present a working purchase flow or claim the user can reactivate by paying.
- The proposed billing behavior is an intentional checkout after the free trial: do not charge automatically at trial end or collect payment details before a billing provider and clear checkout consent are in place. Once activated, membership is ₪19.99/month and can be cancelled from membership settings.
- Existing accounts are not retroactively changed by this new-account trial rule.

## Constraints and builder calls

- Use the existing Firebase-authenticated account and Firestore profile data. Persist trial state server-side so clients cannot start or extend a trial by editing browser state.
- Define profile completion and trial start in a single server-side operation to avoid inconsistent state. Store timestamps, not a client-provided duration.
- All marketplace mutations and member-only APIs must consult the same membership/trial access decision; UI-only gating is insufficient.
- Public read-only discovery remains available as described in the product plan.
- The application currently has no billing provider. Expired users cannot regain member access through payment until that integration exists.
