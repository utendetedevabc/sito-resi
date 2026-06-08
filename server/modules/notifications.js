import { Router } from 'express';
import webpush from 'web-push';
import db from '../lib/db.js';
import logger from '../lib/logger.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@localhost';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// GET /api/notifications/vapid-public-key
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// POST /api/notifications/subscribe
router.post('/subscribe', authenticate, (req, res) => {
  const { subscription } = req.body;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: 'Subscription non valida' });
  }

  try {
    db.prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES (?, ?, ?, ?)
       ON CONFLICT DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`
    ).run(
      req.user.id,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth
    );
    res.json({ success: true });
  } catch (err) {
    logger.error(`Push subscribe error: ${err.message}`);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// POST /api/notifications/unsubscribe
router.post('/unsubscribe', authenticate, (req, res) => {
  const { endpoint } = req.body;
  try {
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(req.user.id, endpoint);
    res.json({ success: true });
  } catch (err) {
    logger.error(`Push unsubscribe error: ${err.message}`);
    res.status(500).json({ error: 'Errore interno' });
  }
});

export async function sendPushNotification(userId, payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload)
      );
    } catch (err) {
      logger.warn(`Push notification failed for user ${userId}: ${err.message}`);
      if (err.statusCode === 410 || err.statusCode === 404) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      }
    }
  }
}

export default router;
