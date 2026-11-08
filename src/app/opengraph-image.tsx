import { ImageResponse } from 'next/og';
export const alt = 'Freelance Place';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export default function OpenGraphImage() {
  return new ImageResponse(<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 48, background: '#F6F5EF', color: '#151719' }}><svg width="220" height="220" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#CEEF00"/><g transform="translate(20 20) scale(0.88)" fill="#151719"><path d="M22 0H80V20H22V72H0V22ZM66 30H100V100H22V80H62L80 50H66Z"/><path d="M36 38H56V58H36Z"/></g></svg><div style={{ display: 'flex', fontSize: 70, fontWeight: 700, letterSpacing: -3 }}>Freelance Place</div></div>, size);
}
