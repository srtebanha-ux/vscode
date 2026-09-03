import type { MetadataRoute } from 'next';
import { getCatalog, SITE_URL } from '@/lib/catalog';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE_URL.replace(/\/+$/, '');
  return [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    ...getCatalog().map((item) => ({
      url: `${base}/p/${item.slug}`,
      lastModified: new Date(item.publishedAt),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
