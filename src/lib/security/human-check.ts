import 'server-only';

// Contract shared by the request policy layer (caller) and the bot-protection provider (implementation).
// See .claude/plans/23-11-26-Security-Phase1.md. Signatures are fixed; the body is the provider's.

export type HumanCheckAction = 'support_message' | 'ai_profile' | 'ai_project_brief';

/** True when a human check is configured and required for this action. */
export function humanCheckEnabled(action: HumanCheckAction): boolean {
  void action;
  return false;
}

/** Verifies the request's human-check token for `action`. Returns null when allowed, or the response to send. */
export async function verifyHumanCheck(request: Request, action: HumanCheckAction): Promise<Response | null> {
  void request;
  void action;
  return null;
}
