import { dispatchNotifications } from '@/lib/notifications/delivery';
import { route } from '@/lib/security/policy';
export const runtime = 'nodejs';
export const POST = route('notifications.dispatch', {}, async () => {
  try {
    const result = await dispatchNotifications();
    console.info(JSON.stringify({ event: 'project_mail_dispatch', ...result }));
    return Response.json(result, { status: result.failed ? 503 : 200 });
  } catch { return Response.json({ error: 'DELIVERY_UNAVAILABLE' }, { status: 503 }); }
});
