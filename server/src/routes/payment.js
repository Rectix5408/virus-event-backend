import express from 'express';
import { createCheckoutSession, verifyCheckoutSession } from '../services/stripe.js';

const router = express.Router();

router.post('/create-checkout-session', async (req, res) => {
  try {
    const session = await createCheckoutSession(req.body);
    res.json(session);
  } catch (error) {
    console.error("Checkout Error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/verify-session', async (req, res) => {
  const { sessionId } = req.body;
  
  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID fehlt' });
  }

  try {
    const result = await verifyCheckoutSession(sessionId);
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json({ error: 'Zahlung noch nicht abgeschlossen', status: result.status });
    }
  } catch (error) {
    console.error("Verification Error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;