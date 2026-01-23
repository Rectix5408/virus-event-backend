import express from 'express';
import Stripe from 'stripe';
import { handleCheckoutCompleted } from '../services/stripe.js';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Endpoint: POST /payment/verify-session
router.post('/verify-session', async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    // Session von Stripe abrufen
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.payment_status === 'paid') {
      // FALLBACK: Bestellung speichern, falls Webhook zu langsam war oder fehlt.
      // Die Funktion prüft intern auf Duplikate, also ist das sicher.
      try {
        console.log('Manuelles Speichern via verify-session für:', session.id);
        await handleCheckoutCompleted(session);
      } catch (err) {
        console.error('Fehler beim manuellen Speichern:', err);
        // Wir machen weiter, damit der User trotzdem seine Bestätigung sieht
      }

      const metadata = session.metadata || {};

      res.json({ 
        success: true, 
        verified: true,
        session,
        eventId: metadata.eventId,
        email: session.customer_details?.email || metadata.email,
        firstName: metadata.firstName,
        lastName: metadata.lastName,
        tierName: metadata.tierName || metadata.tierId,
        quantity: parseInt(metadata.quantity || '1', 10),
        ticketId: metadata.ticketId || session.id.slice(-8).toUpperCase()
      });
    } else {
      res.status(400).json({ success: false, error: 'Payment not completed', status: session.payment_status });
    }
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ error: 'Internal server error during verification' });
  }
});

export default router;