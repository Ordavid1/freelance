import type { Metadata } from 'next';
import { Heebo, Space_Grotesk } from 'next/font/google';
import { SITE_NAME, SITE_URL, SITE_DESCRIPTION, siteGraph } from '@/lib/seo/site';
import { StructuredData } from '@/components/discovery/structured-data';
import './globals.css';
import './discovery.css';
import './legal.css';
import { LegalFooter } from '@/components/legal-document';

const heebo = Heebo({ subsets: ['hebrew', 'latin'], variable: '--font-heebo', display: 'swap' });
const space = Space_Grotesk({ subsets: ['latin'], variable: '--font-space', display: 'swap' });
// Runtime configuration (including search verification) must not be frozen into a Docker build.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME} — פרויקטים לפרילנסרים בישראל`, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: { siteName: SITE_NAME, locale: 'he_IL', type: 'website', images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: SITE_NAME }] },
  twitter: { card: 'summary_large_image', images: ['/opengraph-image'] },
  verification: { google: process.env.GOOGLE_SITE_VERIFICATION || undefined, other: process.env.BING_SITE_VERIFICATION ? { 'msvalidate.01': process.env.BING_SITE_VERIFICATION } : undefined },
  referrer: 'strict-origin-when-cross-origin',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="he" dir="rtl" className={`${heebo.variable} ${space.variable}`}><body><StructuredData data={siteGraph} />{children}<LegalFooter /></body></html>;
}
