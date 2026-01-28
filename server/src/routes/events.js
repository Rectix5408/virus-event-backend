import express from 'express';
import { getDatabase } from '../config/database.js';
import { protect } from './auth.js';
import { emitEvent } from '../services/socket.js';
import { cache, invalidateCache } from '../middleware/cache.js';
import { rateLimit } from '../middleware/rateLimiter.js';

const router = express.Router();

// Helper for safe JSON parsing
const safeParse = (jsonString, fallback) => {
  try {
    return typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
  } catch (e) {
    return fallback;
  }
};

// GET /api/events - Alle Events abrufen (Public, Cached)
router.get('/', rateLimit({ windowMs: 60 * 1000, max: 100 }), cache('events:all', 600), async (req, res) => {
  try {
    // Browser Cache deaktivieren, damit Live-Updates (Socket.io) sofort wirken.
    // Wir verlassen uns auf den Redis-Cache im Backend für Performance.
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    const db = getDatabase();
    const [events] = await db.query("SELECT * FROM events ORDER BY dateISO ASC");

    const parsedEvents = events.map(event => ({
      ...event,
      detailedLineup: safeParse(event.detailedLineup, []),
      ticketTiers: safeParse(event.ticketTiers, [])
    }));

    res.json(parsedEvents);
  } catch (error) {
    console.error("Error fetching events:", error);
    res.status(500).json({ error: 'Fehler beim Laden der Events' });
  }
});

// GET /api/events/:id - Einzelnes Event (Public, Cached)
router.get('/:id', rateLimit({ windowMs: 60 * 1000, max: 100 }), cache((req) => `events:detail:${req.params.id}`, 600), async (req, res) => {
  try {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    const db = getDatabase();
    const [rows] = await db.query("SELECT * FROM events WHERE id = ?", [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Event nicht gefunden' });
    }

    const event = rows[0];
    event.detailedLineup = safeParse(event.detailedLineup, []);
    event.ticketTiers = safeParse(event.ticketTiers, []);

    res.json(event);
  } catch (error) {
    console.error("Error fetching event:", error);
    res.status(500).json({ error: 'Fehler beim Laden des Events' });
  }
});

// POST /api/events - Event erstellen (Admin)
router.post('/', protect, async (req, res) => {
  try {
    const db = getDatabase();
    const { id, title, date, dateISO, time, location, image, description, ticketUrl, detailedLineup, ticketTiers } = req.body;

    if (!id || !title || !dateISO) {
      return res.status(400).json({ error: 'Fehlende Pflichtfelder (id, title, dateISO)' });
    }

    await db.query(
      `INSERT INTO events (id, title, date, dateISO, time, location, image, description, ticketUrl, detailedLineup, ticketTiers) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, title, date, dateISO, time, location, image, description, ticketUrl, JSON.stringify(detailedLineup || []), JSON.stringify(ticketTiers || [])]
    );

    await invalidateCache('events:all');
    emitEvent('event_update', { type: 'create', id });
    console.log(`✨ [Events] Created new event: ${title} (${id})`);

    res.status(201).json({ message: 'Event erfolgreich erstellt', id });
  } catch (error) {
    console.error("Error creating event:", error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Events' });
  }
});

// PUT /api/events/:id - Event bearbeiten (Admin)
router.put('/:id', protect, async (req, res) => {
  try {
    const db = getDatabase();
    const { title, date, dateISO, time, location, image, description, ticketUrl, detailedLineup, ticketTiers } = req.body;
    const { id } = req.params;

    await db.query(
      `UPDATE events SET title=?, date=?, dateISO=?, time=?, location=?, image=?, description=?, ticketUrl=?, detailedLineup=?, ticketTiers=? WHERE id=?`,
      [title, date, dateISO, time, location, image, description, ticketUrl, JSON.stringify(detailedLineup || []), JSON.stringify(ticketTiers || []), id]
    );

    await invalidateCache(['events:all', `events:detail:${id}`]);
    emitEvent('event_update', { type: 'update', id });
    console.log(`📝 [Events] Updated event: ${id}`);

    res.json({ message: 'Event aktualisiert' });
  } catch (error) {
    console.error("Error updating event:", error);
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Events' });
  }
});

// DELETE /api/events/:id - Event löschen (Admin)
router.delete('/:id', protect, async (req, res) => {
  try {
    const db = getDatabase();
    const { id } = req.params;

    await db.query("DELETE FROM events WHERE id = ?", [id]);

    await invalidateCache(['events:all', `events:detail:${id}`]);
    emitEvent('event_update', { type: 'delete', id });
    console.log(`🗑️ [Events] Deleted event: ${id}`);

    res.json({ message: 'Event gelöscht' });
  } catch (error) {
    console.error("Error deleting event:", error);
    res.status(500).json({ error: 'Fehler beim Löschen des Events' });
  }
});

export default router;