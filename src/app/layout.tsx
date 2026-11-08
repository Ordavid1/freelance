import type { Metadata } from 'next';
import { Heebo, Space_Grotesk } from 'next/font/google';
import './globals.css';

const heebo = Heebo({ subsets: ['hebrew', 'latin'], variable: '--font-heebo', display: 'swap' });
const space = Space_Grotesk({ subsets: ['latin'], variable: '--font-space', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://freelancezone.co.il'),
  title: { default: 'Freelance Zone — מקום טוב לעבודה טובה', template: '%s | Freelance Zone' },
  description: 'מגלים פרויקטים שמתאימים לכם, מציעים הצעה ברורה, ומתקדמים יחד. מרקטפלייס ישראלי לפרילנסרים ולעסקים.',
  openGraph: { title: 'Freelance Zone', description: 'מקום טוב לעבודה טובה', locale: 'he_IL', type: 'website' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="he" dir="rtl" className={`${heebo.variable} ${space.variable}`}><body>{children}</body></html>;
}
