import withPWA from 'next-pwa';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  compress: true,
  // Accessi dev cross-origin: Next.js 16 blocca di default HMR + bundle client
  // quando l'Origin non è localhost. I tester dal telefono/LAN accedono a
  // http://192.168.90.147:3002 → senza questo allowlist il bundle client è
  // bloccato, il server rendera "Caricamento…" ma React NON idrata → pagina
  // bloccata sul fallback. allowedDevOrigins sblocca HMR + risorse dev.
  allowedDevOrigins: ['192.168.90.147', 'localhost', '127.0.0.1'],
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [390, 640, 768, 1024, 1280],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
  experimental: {
    optimizePackageImports: ['@heroicons/react'],
  },
};

const pwaConfig = withPWA({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  runtimeCaching: [
    {
      urlPattern: /^https?.*\/api\/(?!auth|venditore\/richieste\/).*$/,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'api-cache',
        expiration: { maxEntries: 50, maxAgeSeconds: 300 },
      },
    },
    {
      urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|avif)$/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'image-cache',
        expiration: { maxEntries: 100, maxAgeSeconds: 86400 },
      },
    },
    {
      urlPattern: /\.(?:js|css|woff2)$/,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'static-resources',
      },
    },
  ],
});

export default pwaConfig(nextConfig);
