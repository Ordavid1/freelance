import type { MetadataRoute } from 'next';
export default function robots(): MetadataRoute.Robots { return { rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/messages', '/membership', '/profile/'] }, sitemap: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://freelancezone.co.il'}/sitemap.xml` }; }
