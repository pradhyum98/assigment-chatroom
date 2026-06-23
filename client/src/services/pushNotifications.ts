import api from './api';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export const subscribeToPushNotifications = async () => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push notifications are not supported by the browser.');
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('Push notification permission denied.');
      return;
    }

    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    const publicVapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
    if (!publicVapidKey) {
      console.error('VITE_VAPID_PUBLIC_KEY is not defined in the environment.');
      return;
    }

    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicVapidKey)
      });
    }

    // Send the subscription to the backend
    await api.post('/notifications/subscribe', {
      subscription
    });

    console.log('Successfully subscribed to push notifications.');
  } catch (err) {
    console.error('Failed to subscribe to push notifications:', err);
  }
};
