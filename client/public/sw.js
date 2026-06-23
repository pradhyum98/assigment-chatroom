self.addEventListener('push', function (event) {
  if (event.data) {
    try {
      const payload = event.data.json();
      const options = {
        body: payload.body,
        icon: '/vite.svg',
        data: {
          url: payload.url || '/'
        }
      };
      event.waitUntil(
        self.registration.showNotification(payload.title, options)
      );
    } catch (e) {
      console.error('Push event payload parsing failed:', e);
      event.waitUntil(
        self.registration.showNotification('New Notification', {
          body: event.data.text(),
          icon: '/vite.svg'
        })
      );
    }
  }
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  if (event.notification.data && event.notification.data.url) {
    event.waitUntil(
      clients.openWindow(event.notification.data.url)
    );
  } else {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});
