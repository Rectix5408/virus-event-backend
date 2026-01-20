// server/src/routes/newsletter.js
import express from 'express';
import { subscribeEmail, getAllSubscribers, getSubscribersForAdmin } from '../services/newsletter.js';
import { sendBulkEmail } from '../services/email.js';
import { protect, hasPermission } from './auth.js';
import { isValidEmail } from '../utils/helpers.js';

const router = express.Router();

// PUBLIC-FACING ROUTE
// POST /api/newsletter/subscribe
router.post('/subscribe', async (req, res) => {
  const { email } = req.body;

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Gültige Email Adresse wird benötigt.' });
  }

  try {
    await subscribeEmail(email);
    res.status(200).json({ success: true, message: 'Erfolgreich für den Newsletter angemeldet!' });
  } catch (error) {
    console.error("Newsletter subscription error:", error);
    res.status(500).json({ error: 'Anmeldung fehlgeschlagen, bitte versuche es erneut.' });
  }
});

// PROTECTED ADMIN ROUTES

// GET /api/newsletter/ - Get all subscribers for admin view
router.get('/', protect, hasPermission('users:view'), async (req, res) => {
    try {
        const subscribers = await getSubscribersForAdmin();
        res.json(subscribers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// POST /api/newsletter/send - Send the newsletter
router.post('/send', protect, hasPermission('newsletter:send'), async (req, res) => {
    const { subject, body } = req.body;

    if (!subject || !body) {
        return res.status(400).json({ error: 'Betreff und Inhalt werden benötigt.' });
    }

    try {
        const subscribers = await getAllSubscribers();
        if (subscribers.length === 0) {
            return res.status(400).json({ error: 'Keine Abonnenten gefunden.' });
        }

        console.log(`Starting newsletter dispatch to ${subscribers.length} subscribers...`);
        // This uses the generic 'sendTicketEmail' function structure, but for bulk sending.
        // In a real app, you might have a dedicated newsletter template.
        await sendBulkEmail(subscribers, subject, body);
        console.log('Newsletter dispatch complete.');

        res.status(200).json({ success: true, message: `Newsletter an ${subscribers.length} Abonnenten gesendet.` });

    } catch (error) {
        console.error("Newsletter sending error:", error);
        res.status(500).json({ error: 'Fehler beim Senden des Newsletters.' });
    }
});


export default router;
