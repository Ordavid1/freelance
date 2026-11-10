import type { Metadata, Viewport } from 'next';
import { Heebo, Space_Grotesk } from 'next/font/google';
import { SITE_NAME, SITE_URL, SITE_DESCRIPTION } from '@/lib/seo/site';
import { siteGraph } from '@/lib/seo/schema';
import { StructuredData } from '@/components/discovery/structured-data';
import './globals.css';
import './discovery.css';
import './legal.css';
import './responsive-typography.css';
import './site-footer.css';
import { SiteFooter } from '@/components/site-footer';
import { SupportChatProvider } from '@/components/support-chat';
import { supportContactEmail } from '@/lib/support/config';
import Script from 'next/script';

const heebo = Heebo({ subsets: ['hebrew', 'latin'], variable: '--font-heebo', display: 'swap' });
const space = Space_Grotesk({ subsets: ['latin'], variable: '--font-space', display: 'swap' });
// Runtime configuration (including search verification) must not be frozen into a Docker build.
export const dynamic = 'force-dynamic';
// Browser UI colour: the page background defined in globals.css (--mineral).
export const viewport: Viewport = { themeColor: '#f4f6f2' };
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
  return <html lang="he" dir="rtl" className={`${heebo.variable} ${space.variable}`}><body><Script src="https://www.googletagmanager.com/gtm.js?id=GTM-54NQ7CCV" strategy="afterInteractive" /><Script id="google-tag-init" strategy="afterInteractive">{`window.dataLayer = window.dataLayer || []; function gtag(){window.dataLayer.push(arguments);} gtag('js', new Date());`}</Script><StructuredData data={siteGraph()} /><SupportChatProvider contactEmail={supportContactEmail()}>{children}<SiteFooter /></SupportChatProvider></body></html>;
}
