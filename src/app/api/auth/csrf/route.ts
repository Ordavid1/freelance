import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  const token = randomBytes(32).toString('base64url');
  const response = NextResponse.json({ csrfToken: token }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set('fz_csrf', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60,
  });
  return response;
}
