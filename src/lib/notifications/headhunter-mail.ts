import 'server-only';
import { Resend } from 'resend';
import { adminAuth } from '@/lib/auth/firebase-admin';
import { buildDecisionMail, type DecisionMailInput } from '@/lib/headhunters/mail';
import { mailbox } from '@/lib/support/config';

// Sends the decision email to the headhunter's account address. Same transport and sender as the project notifications
// (Resend, PROJECT_NOTIFICATIONS_FROM_EMAIL or SUPPORT_FROM_EMAIL) and the same recipient rules (the account's verified
// address, never a disabled account). It is a one-off transactional mail, so the daily-digest switch
// PROJECT_NOTIFICATIONS_ENABLED does not apply. Missing configuration skips the send. It never rejects: the caller is a
// moderation action that must not fail because of mail.
export async function sendHeadhunterDecisionMail(uid: string, input: DecisionMailInput): Promise<'sent' | 'skipped' | 'failed'> {
  try {
    const mail = buildDecisionMail(input);
    if (!mail) return 'skipped';
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = (process.env.PROJECT_NOTIFICATIONS_FROM_EMAIL || process.env.SUPPORT_FROM_EMAIL)?.trim();
    if (!apiKey || !from || !mailbox(from)) { console.warn('Headhunter decision email skipped: mail is not configured'); return 'skipped'; }
    const identity = await adminAuth().getUser(uid);
    if (identity.disabled || !identity.emailVerified || !identity.email) return 'skipped';
    const result = await new Resend(apiKey).emails.send({ from, to: identity.email, subject: mail.subject, text: mail.text, html: mail.html }, { signal: AbortSignal.timeout(15_000) });
    if (result.error || !result.data?.id) throw new Error('DELIVERY_FAILED');
    return 'sent';
  } catch (error) {
    console.warn('Headhunter decision email failed', { error: error instanceof Error ? error.name : 'Error' });
    return 'failed';
  }
}
