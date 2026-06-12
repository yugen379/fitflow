importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCGgiaLaaAjfkNJxertfao55jnrIpoED9w",
  authDomain: "gen-lang-client-0893216108.firebaseapp.com",
  projectId: "gen-lang-client-0893216108",
  storageBucket: "gen-lang-client-0893216108.firebasestorage.app",
  messagingSenderId: "715686253437",
  appId: "1:715686253437:web:75501e3b0aedb2ead87214",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || 'FitFlow';
  const options = {
    body: payload?.notification?.body || '',
    icon: '/icons/icon-192.webp',
    badge: '/favicon.svg',
    tag: payload?.data?.type || 'fitflow',
    data: payload?.data || {},
    vibrate: [120, 60, 120],
  };
  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
