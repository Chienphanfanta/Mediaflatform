import type { Metadata, Viewport } from 'next';
import './globals.css';
import { PWAInstallBanner } from '@/components/pwa/install-banner';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: 'Media Ops Platform',
  description: 'Quản lý nhân sự và đa kênh truyền thông',
  applicationName: 'MediaOps',
  appleWebApp: {
    capable: true,
    title: 'MediaOps',
    statusBarStyle: 'default',
  },
  manifest: '/manifest.json',
  formatDetection: { telephone: false },
};

// theme_color tách ra Viewport (Next 14: metadata.themeColor deprecated).
export const viewport: Viewport = {
  themeColor: '#534AB7',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Providers>
          {children}
          <PWAInstallBanner />
        </Providers>
      </body>
    </html>
  );
}
