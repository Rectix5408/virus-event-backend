import express from 'express';
import { constructWebhookEvent, handleStripeWebhook } from '../services/stripe.js';

const router = express.Router();

// Endpoint: POST /api/webhooks/stripe
// Hinweis: Der Body ist hier bereits "raw" (Buffer), da dies in index.js konfiguriert wurde.
router.post('/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = constructWebhookEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`❌ Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    await handleStripeWebhook(event);
    res.json({ received: true });
  } catch (err) {
    console.error(`❌ Error handling webhook: ${err.message}`);
    res.status(500).send('Webhook handler failed');
  }
});

export default router;