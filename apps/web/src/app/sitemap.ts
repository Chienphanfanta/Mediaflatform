// Dynamic sitemap.xml — chỉ list public pages.
// Next.js convention: app/sitemap.ts → /sitemap.xml.
// Auth-gated routes KHÔNG include (xem robots.txt cũng disallow).
import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'https://mediaops.app';
  return [
    {
      url: `${base}/login`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 1.0,
    },
    {
      url: `${base}/offline`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.1,
    },
  ];
}
