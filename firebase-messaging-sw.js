/**
 * Firebase Cloud Messaging service worker.
 * Handles push notifications while no Luma tab is focused.
 *
 * Must live at the site root so its scope covers the whole app.
 */

importScripts('https://www.gstatic.com/firebasejs/12.17.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.17.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCkSJwy2lBbgQJD9W6mdDPuV15nttJhIwk',
  authDomain: 'luma-web-d3550.firebaseapp.com',
  databaseURL: 'https://luma-web-d3550-default-rtdb.firebaseio.com',
  projectId: 'luma-web-d3550',
  storageBucket: 'luma-web-d3550.firebasestorage.app',
  messagingSenderId: '1005101836242',
  appId: '1:1005101836242:web:42f3e19d5b4534a2c1ca0b'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  self.registration.showNotification(title || 'إشعار جديد', {
    body: body || '',
    icon: '/assets/logo/luma-mark-yellow.png',
    badge: '/assets/logo/favicon.png',
    dir: 'rtl',
    lang: 'ar',
    data: { link: payload.fcmOptions?.link || '/dashboard.html' }
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.link || '/dashboard.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes('/dashboard.html') && 'focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
