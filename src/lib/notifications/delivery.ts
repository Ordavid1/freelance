import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import type { DocumentReference } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import { firestore } from '@/lib/db/firestore';
import { adminAuth } from '@/lib/auth/firebase-admin';
import { notificationConfig } from './config.ts';
import { dailyDue, eligibleProfile, matchesProject, parsePreferences } from './preferences.ts';

type Cursor = { at: Timestamp; id: string };
type Item = { id: string; title: string; budget: string };
type Pending = { nextIndex?: number; key: string; created: number; items: Item[]; cursor: Cursor; complete: boolean; day: string; interval: 'daily' | 'project'; revision: string; to: string; token: string; from: string; origin: string };
const escape = (s: string) => s.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
export function renderMail(uid: string, batch: Pending) {
  const unsubscribe = `${batch.origin}/api/notifications/unsubscribe?uid=${encodeURIComponent(uid)}&token=${batch.token}`;
  const title = batch.interval === 'daily' ? 'הפרויקטים החדשים שמתאימים לך' : 'פרויקט חדש שמתאים לך';
  const links = batch.items.map(item => ({ ...item, url: `${batch.origin}/projects/${encodeURIComponent(item.id)}` }));
  return { from: batch.from, to: batch.to, subject: title,
    text: `${title}\n\n${links.map(i => `${i.title}\n${i.budget}\n${i.url}`).join('\n\n')}\n\nהפסקת עדכונים: ${unsubscribe}`,
    html: `<div dir="rtl" lang="he" style="font-family:Arial,sans-serif;color:#17263a;max-width:600px;margin:auto"><h2>${title}</h2>${links.map(i => `<p><a href="${escape(i.url)}" style="color:#145a4e">${escape(i.title)}</a><br>${escape(i.budget)}</p>`).join('')}<hr><p><a href="${escape(unsubscribe)}">הפסקת עדכונים במייל</a> · <a href="${batch.origin}/messages">ניהול העדפות</a></p></div>`,
    headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
}

async function processSubscriber(ref: DocumentReference, config: NonNullable<ReturnType<typeof notificationConfig>>, deadline: number) {
  const db = firestore();
  let saved = (await ref.get()).data();
  const prefs = parsePreferences(saved);
  if (!saved || !prefs?.enabled || saved.reviewRequired) return;
  const profile = await db.collection('profiles').doc(ref.id).get();
  if (!eligibleProfile(profile.data())) { await ref.update({ enabled: false, pending: null }); return; }
  const identity = await adminAuth().getUser(ref.id);
  if (identity.disabled || !identity.emailVerified || !identity.email) { await ref.update({ enabled: false, pending: null }); return; }
  if (!saved.pending && prefs.interval === 'daily' && !dailyDue(Date.now(), saved.lastDaily)) return;
  let pending = saved.pending as Pending | null;
  if (!pending) {
    const cutoff = Timestamp.fromMillis(Date.now() - 60_000);
    const cursor = saved.cursor as Timestamp;
    if (!cursor?.toMillis) throw new Error('INVALID_CURSOR');
    let query = db.collection('projects').orderBy('createdAt').orderBy(FieldPath.documentId()).where('createdAt', '<=', cutoff);
    query = saved.cursorId ? query.startAfter(cursor, saved.cursorId) : query.where('createdAt', '>', cursor);
    const projects = await query.limit(prefs.interval === 'project' ? 20 : 100).get();
    const items = projects.docs.filter(doc => matchesProject(doc.data(), ref.id, prefs)).map(doc => ({ id: doc.id, title: String(doc.get('title')), budget: String(doc.get('budget') || '') }));
    const last = projects.docs.at(-1);
    const complete = projects.size < (prefs.interval === 'project' ? 20 : 100);
    const nextCursor = complete ? { at: cutoff, id: '' } : { at: last!.get('createdAt') as Timestamp, id: last!.id };
    if (nextCursor.at.toMillis() < cursor.toMillis()) return;
    pending = { key: randomUUID(), created: Date.now(), items, cursor: nextCursor, complete, day: new Date().toISOString().slice(0, 10), interval: prefs.interval, revision: saved.revision, to: identity.email, token: saved.unsubscribeToken, from: config.from, origin: config.origin };
    const prepared = pending;
    const stored = await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (!current.get('enabled') || current.get('revision') !== prepared.revision) return false;
      tx.update(ref, { pending: prepared }); return true;
    });
    if (!stored) return;
  }
  // Resend retains idempotency keys for 24h. Quarantine ambiguous older sends instead of risking duplicates.
  if (pending.items.length && Date.now() - pending.created > 23 * 60 * 60_000) { await ref.update({ reviewRequired: true }); throw new Error('DELIVERY_REQUIRES_REVIEW'); }
  saved = (await ref.get()).data();
  if (!saved?.enabled || saved.revision !== pending.revision) return;
  if (identity.email !== pending.to) { await ref.update({ pending: null }); return; }
  if (pending.items.length) {
    const messages = pending.interval === 'project' ? pending.items.map(item => ({ ...pending!, items: [item] })) : [pending];
    for (let index = pending.nextIndex || 0; index < messages.length; index++) {
      if (Date.now() > deadline) throw new Error('DELIVERY_TIME_BUDGET');
      const current = await ref.get();
      if (!current.get('enabled') || current.get('revision') !== pending.revision) return;
      const key = createHash('sha256').update(`${ref.id}/${pending.key}/${index}`).digest('hex');
      const result = await new Resend(config.apiKey).emails.send(renderMail(ref.id, messages[index]), { idempotencyKey: `project-mail/${key}`, signal: AbortSignal.timeout(15_000) });
      if (result.error || !result.data?.id) throw new Error('DELIVERY_FAILED');
      await db.runTransaction(async tx => {
        const latest = await tx.get(ref);
        if (latest.get('revision') === pending!.revision && latest.get('pending')?.key === pending!.key) tx.update(ref, { 'pending.nextIndex': index + 1 });
      });
      // Resend's default rate limit is two requests/second; leave headroom for other mail.
      await new Promise(resolve => setTimeout(resolve, 600));
    }
  }
  const completed = pending;
  await db.runTransaction(async tx => {
    const current = await tx.get(ref);
    if (current.get('revision') !== completed.revision || current.get('pending')?.key !== completed.key) return;
    tx.update(ref, { cursor: completed.cursor.at, cursorId: completed.cursor.id, pending: null, ...(completed.interval === 'daily' && completed.complete ? { lastDaily: completed.day } : {}) });
  });
}

// One leased, bounded sweep, resumed across invocations. Enabled subscribers are paged by document id.
export async function dispatchNotifications() {
  const config = notificationConfig();
  if (!config) throw new Error('NOTIFICATIONS_NOT_CONFIGURED');
  const db = firestore(), state = db.collection('notificationJobs').doc('projects'), lease = randomUUID();
  const start = Date.now();
  const cursor = await db.runTransaction(async tx => {
    const current = await tx.get(state);
    if ((current.get('leaseUntil') || 0) > start) return null;
    tx.set(state, { lease, leaseUntil: start + 240_000 }, { merge: true });
    return String(current.get('cursor') || '');
  });
  if (cursor === null) return { busy: true, processed: 0, failed: 0 };
  let processed = 0, failed = 0, next = cursor;
  try {
    let query = db.collection('projectMailPreferences').where('enabled', '==', true).orderBy(FieldPath.documentId()).limit(100);
    if (cursor) query = query.startAfter(cursor);
    const subscribers = await query.get();
    for (const subscriber of subscribers.docs) {
      if (Date.now() - start > 120_000) break;
      try { await processSubscriber(subscriber.ref, config, start + 120_000); processed++; }
      catch { failed++; }
      next = subscriber.id;
    }
    if (!subscribers.size || next === subscribers.docs.at(-1)?.id) next = subscribers.size < 100 ? '' : next;
  } finally {
    await db.runTransaction(async tx => {
      const current = await tx.get(state);
      if (current.get('lease') === lease) tx.update(state, { cursor: next, leaseUntil: 0 });
    });
  }
  return { processed, failed };
}
