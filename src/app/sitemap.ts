import type { MetadataRoute } from 'next';
import { projects } from '@/lib/data';
export default function sitemap(): MetadataRoute.Sitemap { const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://freelance-place.com'; return [{ url: base, changeFrequency: 'daily', priority: 1 }, ...['privacy', 'terms'].map(path => ({ url: `${base}/${path}`, changeFrequency: 'yearly' as const, priority: 0.3 })), ...projects.map((project) => ({ url: `${base}/projects/${project.slug}`, changeFrequency: 'daily' as const, priority: 0.8 }))]; }
