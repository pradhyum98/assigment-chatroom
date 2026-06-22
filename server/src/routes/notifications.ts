import express from 'express';
import { PushSubscription } from '../models/PushSubscription';
import { authenticate } from '../middleware/auth';
import { logger } from '../middleware/logger';
import webpush from 'web-push';
import { z } from 'zod';

const router = express.Router();

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    VAPID_SUBJECT,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

const subscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string(),
      auth: z.string()
    })
  })
});

router.post('/subscribe', authenticate, async (req, res): Promise<any> => {
  try {
    const { success, data, error } = subscribeSchema.safeParse(req.body);
    if (!success) {
      return res.status(400).json({ status: 'error', message: 'Invalid subscription object' });
    }

    const { endpoint, keys } = data.subscription;
    const userId = (req as any).user._id;

    // Save or update subscription
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      {
        userId,
        endpoint,
        keys,
        createdAt: new Date()
      },
      { upsert: true, new: true }
    );

    res.status(201).json({ status: 'success', message: 'Subscription added.' });
  } catch (err) {
    logger.error('Failed to subscribe to push notifications:', err);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

export const sendNotificationToUser = async (userId: string, payload: { title: string; body: string; url?: string }) => {
  try {
    const subscriptions = await PushSubscription.find({ userId });
    
    if (subscriptions.length === 0) return;

    const payloadString = JSON.stringify(payload);

    const notifications = subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys
          },
          payloadString
        );
      } catch (err: any) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          logger.info(`Subscription expired or not found. Deleting ${sub.endpoint}`);
          await PushSubscription.deleteOne({ _id: sub._id });
        } else {
          logger.error('Failed to send push notification:', err);
        }
      }
    });

    await Promise.all(notifications);
  } catch (err) {
    logger.error('Error in sendNotificationToUser:', err);
  }
};

export default router;
