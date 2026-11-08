import type { MetadataRoute } from 'next';
import { projects } from '@/lib/data';
export default function sitemap(): MetadataRoute.Sitemap { const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://freelancezone.co.il'; return [{ url: base, changeFrequency: 'daily', priority: 1 }, ...projects.map((project) => ({ url: `${base}/projects/${project.slug}`, changeFrequency: 'daily' as const, priority: 0.8 }))]; }
