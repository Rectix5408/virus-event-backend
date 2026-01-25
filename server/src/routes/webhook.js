import express from 'express';
import { handleStripeWebhook, constructWebhookEvent } from '../services/stripe.js';

const router = express.Router();

// WICHTIG: Diese Route nutzt express.raw(), um den exakten Buffer für die Signaturprüfung zu erhalten.
// Sie muss in der Hauptdatei (index.js/app.js) VOR globalen Body-Parser-Middlewares registriert werden.
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('❌ CRITICAL: STRIPE_WEBHOOK_SECRET fehlt in .env');
    return res.status(500).send('Server Configuration Error');
  }

  let event;

  try {
    // req.body ist hier ein Buffer (dank express.raw)
    event = constructWebhookEvent(req.body, signature, webhookSecret);
  } catch (err) {
    // Fehler wurde bereits im Service geloggt, wir senden 400 an Stripe
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    await handleStripeWebhook(event);
    res.json({ received: true });
  } catch (err) {
    console.error(`❌ Fehler bei der Webhook-Verarbeitung: ${err.message}`);
    res.status(500).send('Webhook Handler Error');
  }
});

export default router;