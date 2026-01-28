import express from 'express';
import * as newsletterService from '../services/newsletter.js';

const router = express.Router();

router.post('/subscribe', async (req, res) => {
  try {
    const { email, firstName } = req.body;
    if (!email) return res.status(400).json({ error: 'Email erforderlich' });
    
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const result = await newsletterService.subscribe(email, firstName, ip);
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Serverfehler' });
  }
});

router.get('/confirm/:token', async (req, res) => {
  try {
    await newsletterService.confirmSubscription(req.params.token);
    res.redirect(`${process.env.FRONTEND_URL}/newsletter/confirmed`);
  } catch (error) {
    res.redirect(`${process.env.FRONTEND_URL}/newsletter/error?msg=invalid_token`);
  }
});

router.get('/unsubscribe/:token', async (req, res) => {
  try {
    await newsletterService.unsubscribe(req.params.token);
    res.redirect(`${process.env.FRONTEND_URL}/newsletter/unsubscribed`);
  } catch (error) {
    res.redirect(`${process.env.FRONTEND_URL}/newsletter/error?msg=invalid_token`);
  }
});

export default router;
