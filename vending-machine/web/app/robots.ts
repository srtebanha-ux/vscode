import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/catalog';

export default function robots(): MetadataRoute.Robots {
  const base = SITE_URL.replace(/\/+$/, '');
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/'] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
