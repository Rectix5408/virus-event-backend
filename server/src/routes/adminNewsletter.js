import express from 'express';
import { getDatabase } from '../config/database.js';
import crypto from 'crypto';

const router = express.Router();

// Middleware (vereinfacht)
const isAdmin = (req, res, next) => next(); 

router.get('/', isAdmin, async (req, res) => {
    try {
        const db = getDatabase();
        const [rows] = await db.query(`
            SELECT 
                n.*,
                (SELECT COUNT(*) FROM newsletter_queue q WHERE q.newsletterId = n.id) as total_recipients,
                (SELECT COUNT(*) FROM newsletter_queue q WHERE q.newsletterId = n.id AND q.status = 'sent') as sent_count,
                (SELECT COUNT(*) FROM newsletter_queue q WHERE q.newsletterId = n.id AND q.status = 'failed') as failed_count
            FROM newsletters n 
            ORDER BY n.createdAt DESC
        `);
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

router.post('/send', isAdmin, async (req, res) => {
    const { subject, contentHtml, contentText } = req.body;
    
    if (!subject || !contentHtml) {
        return res.status(400).json({ error: 'Subject and content are required' });
    }

    const db = getDatabase();
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();
        const newsletterId = crypto.randomUUID();

        await connection.execute(
            "INSERT INTO newsletters (id, subject, contentHtml, contentText, status) VALUES (?, ?, ?, ?, 'sending')",
            [newsletterId, subject, contentHtml, contentText || contentHtml.replace(/<[^>]*>?/gm, '')]
        );

        await connection.execute(`
            INSERT INTO newsletter_queue (newsletterId, subscriberId, status)
            SELECT ?, id, 'pending'
            FROM newsletter_subscribers
            WHERE is_subscribed = 1
        `, [newsletterId]);

        await connection.commit();
        res.json({ success: true, newsletterId });
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

router.get('/:id/stats', isAdmin, async (req, res) => {
    try {
        const db = getDatabase();
        const [rows] = await db.query(`
            SELECT status, COUNT(*) as count FROM newsletter_queue WHERE newsletterId = ? GROUP BY status
        `, [req.params.id]);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
});

export default router;