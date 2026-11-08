import { noIndex } from '@/lib/seo/site';
import Link from 'next/link';
import { SignInForm } from '@/components/sign-in-form';

export const metadata = { robots: noIndex, title: 'התחברות' };

export default function SignInPage() {
  return <main className="signin-page" dir="rtl"><Link href="/" className="signin-brand">Freelance Place</Link><div className="signin-copy"><span className="eyebrow">ברוכים הבאים למרחב העבודה</span><h1>ממשיכים מכאן.</h1><p>מתחברים לפרויקטים, להצעות ולשיחות שלכם.</p></div><SignInForm/></main>;
}
