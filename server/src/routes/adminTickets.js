import express from 'express';
import { getDatabase } from '../config/database.js';
import { emitEvent } from '../services/socket.js';

const router = express.Router();

// Middleware (vereinfacht, hier sollte deine Auth-Middleware stehen)
const isAdmin = (req, res, next) => next();

// GET: Alle Tickets abrufen (mit Filter & Suche)
router.get('/', isAdmin, async (req, res) => {
    try {
        const { eventId, search } = req.query;

        console.log(`[AdminTickets] Fetching tickets. EventId: '${eventId}', Search: '${search}'`);
        
        const db = getDatabase();
        
        let query = `
            SELECT t.*, e.title as eventName, e.dateISO as eventDate
            FROM tickets t 
            LEFT JOIN events e ON t.eventId = e.id
            WHERE 1=1
        `;
        const params = [];

        // Robusterer Check für eventId
        if (eventId && eventId !== 'all' && eventId !== 'undefined' && eventId.trim() !== '') {
            query += ' AND t.eventId = ?';
            params.push(eventId.trim());
        }

        if (search) {
            query += ' AND (t.email LIKE ? OR t.firstName LIKE ? OR t.lastName LIKE ? OR t.id LIKE ?)';
            const searchParam = `%${search}%`;
            params.push(searchParam, searchParam, searchParam, searchParam);
        }

        // Sortierung: Zuerst nach Event-Datum (Zukunft -> Vergangenheit), dann nach Ticket-Kaufdatum
        query += ' ORDER BY e.dateISO DESC, t.createdAt DESC';

        const [rows] = await db.query(query, params);
        
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// PUT: Ticket bearbeiten
router.put('/:id', isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { firstName, lastName, email, status, checkIn } = req.body;
        const db = getDatabase();

        await db.query(
            'UPDATE tickets SET firstName = ?, lastName = ?, email = ?, status = ?, checkIn = ? WHERE id = ?',
            [firstName, lastName, email, status, checkIn ? 1 : 0, id]
        );

        // Event senden damit alle Clients aktualisieren
        emitEvent('ticket_update', { action: 'update', ticketId: id });

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// DELETE: Ticket löschen
router.delete('/:id', isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDatabase();
        await db.query('DELETE FROM tickets WHERE id = ?', [id]);
        
        emitEvent('ticket_update', { action: 'delete', ticketId: id });

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// POST: Check-in Status umschalten
router.post('/:id/checkin', isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { checkIn } = req.body; // true/false
        const db = getDatabase();
        
        // Wenn eingecheckt wird, Zeit setzen, sonst NULL
        const checkInTime = checkIn ? new Date() : null;

        await db.query(
            'UPDATE tickets SET checkIn = ?, checkInTime = ? WHERE id = ?',
            [checkIn ? 1 : 0, checkInTime, id]
        );

        emitEvent('ticket_update', { action: 'checkin', ticketId: id, status: checkIn });
        
        res.json({ success: true, checkInTime });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

export default router;