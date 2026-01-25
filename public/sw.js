// Chomp Buzz Service Worker
// Minimal service worker for push notifications

const CACHE_NAME = 'chomp-buzz-v1';

// Install event - cache minimal assets
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Push event - handle incoming notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: 'Chomp Buzz', body: event.data.text() };
  }

  const title = data.title || 'Chomp Buzz';
  const options = {
    body: data.body || 'buzz',
    icon: '/heart-cookie.png',
    badge: '/heart-cookie.png',
    tag: 'chomp-buzz',
    renotify: true,
    requireInteraction: false,
    silent: false,
    vibrate: [100, 50, 100],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click - open app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if found
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open new window
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

// Fetch event - network first (minimal caching for this app)
self.addEventListener('fetch', (event) => {
  // Let all requests go to network
  // This app is intentionally minimal and doesn't need offline support
});
