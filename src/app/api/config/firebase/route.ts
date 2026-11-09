import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { FIREBASE_WEB_API_KEY, FIREBASE_AUTH_DOMAIN, GOOGLE_CLOUD_PROJECT, FIREBASE_WEB_APP_ID } = process.env;
  if (!FIREBASE_WEB_API_KEY || !FIREBASE_AUTH_DOMAIN || !GOOGLE_CLOUD_PROJECT || !FIREBASE_WEB_APP_ID) {
    return NextResponse.json({ error: 'Authentication is not configured.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json({
    apiKey: FIREBASE_WEB_API_KEY,
    authDomain: FIREBASE_AUTH_DOMAIN,
    projectId: GOOGLE_CLOUD_PROJECT,
    appId: FIREBASE_WEB_APP_ID,
    googleSignInEnabled: true,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
