export function registerServiceWorker() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  // In dev, unregister any existing service workers to avoid stale caches
  if (process.env.NODE_ENV === 'development') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister());
      });
    });
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.log('SW registered: ', registration.scope);
      })
      .catch((error) => {
        console.log('SW registration failed: ', error);
      });
  });
}

export async function requestNotificationPermission() {
  if (typeof window === 'undefined') return 'unsupported' as const;
  if (!('Notification' in window)) return 'unsupported' as const;

  const permission = await Notification.requestPermission();
  return permission as 'default' | 'granted' | 'denied' | 'unsupported';
}

export function isStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );
}
