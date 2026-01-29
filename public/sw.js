// Cooling Service Worker v2
// Push notifications + in-app messaging

const CACHE_NAME = 'cooling-v3';

// Install event - force activate new version immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate event - clean old caches and take control
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

// Push event - show notification AND notify active clients
self.addEventListener('push', (event) => {
  let data = { title: 'Chomp', body: '' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      // Use default
    }
  }

  const title = data.title || 'Chomp';
  const options = {
    body: data.body || '',
    icon: '/heart-cookie.png',
    badge: '/heart-cookie.png',
    tag: 'cooling-chomp',
    renotify: true,
    requireInteraction: false,
    silent: false,
    vibrate: [100, 50, 100],
    data: { url: '/' },
  };

  event.waitUntil(
    Promise.all([
      // Show system notification
      self.registration.showNotification(title, options),
      // Notify any open clients to play in-app sound
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'chomp-received' });
        });
      }),
    ])
  );
});

// Notification click - open or focus app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});

// Fetch event - network first (no offline caching)
self.addEventListener('fetch', (event) => {
  // Let all requests go to network
});
