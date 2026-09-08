import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@/hooks/useAuth';
import ServiceWorkerCleanup from '@/components/ServiceWorkerCleanup';

export const metadata: Metadata = {
  title: 'Resi — Gestione Resi',
  description: 'Portale web per la gestione delle richieste di reso ABC',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Resi',
  },
  icons: {
    apple: '/icons/icon-192x192.png',
  },
  applicationName: 'Resi',
  other: {
    'msapplication-TileColor': '#0F172A',
    'msapplication-TileImage': '/icons/icon-144x144.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  userScalable: true,
  themeColor: '#0F172A',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <link rel="apple-touch-startup-image" href="/splash/splash-1242x2688.png" />
        <link
          rel="preload"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          as="style"
          crossOrigin="anonymous"
        />
      </head>
      <body className="bg-gray-950 text-white antialiased min-h-dvh overscroll-none">
        <AuthProvider>
          <ServiceWorkerCleanup />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}