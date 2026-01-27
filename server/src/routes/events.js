import express from 'express';
import { getDatabase } from '../config/database.js';
import { protect } from './auth.js';
import { getEventStats } from '../services/ticket.js';
import { cache, invalidateCache } from '../middleware/cache.js';
import { getIO } from '../services/socket.js';
import { rateLimitMiddleware } from '../middleware/rateLimiter.js';

const router = express.Router();

// GET: Metadaten für Smart-Caching (Check auf neue Einträge)
router.get('/meta', async (req, res) => {
  try {
    const pool = getDatabase();
    // Gibt Anzahl und letztes Datum zurück
    const [rows] = await pool.query('SELECT COUNT(*) as count, MAX(created_at) as lastModified FROM events');
    res.json({
      count: rows[0].count,
      lastModified: rows[0].lastModified
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET: Alle Events laden
router.get('/', rateLimitMiddleware, cache('events:all', 60), async (req, res) => {
  try {
    const pool = getDatabase();
    const [rows] = await pool.query('SELECT * FROM events ORDER BY dateISO ASC');
    
    // Parse ticketTiers and add dynamic sold-out status
    const events = rows.map(event => {
      let ticketTiers = [];
      if (event.ticketTiers && typeof event.ticketTiers === 'string') {
        try {
          ticketTiers = JSON.parse(event.ticketTiers).map(tier => ({
            ...tier,
            // Fallback-Logik für Migration: amountTickets > availableQuantity > totalQuantity
            amountTickets: tier.amountTickets ?? tier.availableQuantity ?? tier.totalQuantity ?? 0,
            isSoldOut: (tier.amountTickets ?? tier.availableQuantity ?? 0) <= 0,
          }));
        } catch (e) {
          console.error(`Failed to parse ticketTiers for event ${event.id}`, e);
        }
      }

      let detailedLineup = [];
      if (event.detailedLineup && typeof event.detailedLineup === 'string') {
        try {
          detailedLineup = JSON.parse(event.detailedLineup);
        } catch(e) {
          console.error(`Failed to parse detailedLineup for event ${event.id}`, e);
        }
      }
      
      return {
        ...event,
        ticketTiers,
        detailedLineup,
      };
    });
    
    res.json(events);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST: Neues Event erstellen (mit Passwortschutz)
router.post('/', protect, async (req, res) => {
  const event = req.body;

  try {
    const pool = getDatabase();
    const query = `
      INSERT INTO events 
      (id, title, date, dateISO, time, location, image, description, ticketUrl, detailedLineup, ticketTiers)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const values = [
      event.id,
      event.title,
      event.date,
      event.dateISO,
      event.time,
      event.location,
      event.image,
      event.description,
      event.ticketUrl,
      JSON.stringify(event.detailedLineup),
      JSON.stringify(event.ticketTiers)
    ];

    await pool.query(query, values);
    
    // Cache Invalidierung & Realtime Update
    await invalidateCache('events:all');
    getIO().emit('events_update', { type: 'create' });

    res.json({ success: true, message: 'Event created' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// PUT: Event aktualisieren (intelligent)
router.put('/:id', protect, async (req, res) => {
  const updatedEvent = req.body;
  const { id } = req.params;
  const pool = getDatabase();

  try {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. Get current event state from DB
    const [currentRows] = await connection.query('SELECT * FROM events WHERE id = ? FOR UPDATE', [id]);
    if (currentRows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: 'Event not found' });
    }
    const currentEvent = currentRows[0];
    const currentTiers = JSON.parse(currentEvent.ticketTiers || '[]');

    // 2. Process incoming ticket tiers and update quantities intelligently
    const newTiers = updatedEvent.ticketTiers.map(updatedTier => {
      const currentTier = currentTiers.find(t => t.id === updatedTier.id);

      if (currentTier) {
        // This tier already exists, calculate the difference
        const totalDiff = (updatedTier.totalQuantity || 0) - (currentTier.totalQuantity || 0);
        const newAvailable = (currentTier.availableQuantity || 0) + totalDiff;
        
        return {
          ...updatedTier,
          // Ensure available quantity is not negative and not more than total
          availableQuantity: Math.max(0, Math.min(newAvailable, updatedTier.totalQuantity || 0))
        };
      } else {
        // This is a brand new tier, trust the client's values
        return {
          ...updatedTier,
          availableQuantity: updatedTier.totalQuantity || 0, // Should be same as total
        };
      }
    });

    // 3. Prepare and execute the update query
    const query = `
      UPDATE events 
      SET title=?, date=?, dateISO=?, time=?, location=?, image=?, description=?, ticketUrl=?, detailedLineup=?, ticketTiers=?
      WHERE id=?
    `;
    const values = [
      updatedEvent.title, updatedEvent.date, updatedEvent.dateISO, updatedEvent.time, 
      updatedEvent.location, updatedEvent.image, updatedEvent.description, updatedEvent.ticketUrl,
      JSON.stringify(updatedEvent.detailedLineup),
      JSON.stringify(newTiers),
      id
    ];

    await connection.query(query, values);
    await connection.commit();
    connection.release();

    // Cache Invalidierung & Realtime Update
    await invalidateCache(['events:all', `event:${id}`]);
    getIO().emit('events_update', { type: 'update', id });

    res.json({ success: true, message: 'Event updated successfully' });

  } catch (error) {
    console.error("Error updating event:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE: Event löschen
router.delete('/:id', protect, async (req, res) => {
  try {
    const pool = getDatabase();
    await pool.query('DELETE FROM events WHERE id = ?', [req.params.id]);
    
    // Cache Invalidierung & Realtime Update
    await invalidateCache(['events:all', `event:${req.params.id}`]);
    getIO().emit('events_update', { type: 'delete', id: req.params.id });

    res.json({ success: true, message: 'Event deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/:eventId/stats", protect, async (req, res) => {
  try {
    const { eventId } = req.params;

    const stats = await getEventStats(eventId);

    res.status(200).json({
      success: true,
      eventId,
      stats: {
        totalTickets: stats.totalTickets || 0,
        checkedIn: stats.checkedIn || 0,
        notCheckedIn: (stats.totalTickets || 0) - (stats.checkedIn || 0),
        uniqueVisitors: stats.uniqueVisitors || 0,
        checkInPercentage: stats.totalTickets
          ? Math.round((stats.checkedIn / stats.totalTickets) * 100)
          : 0,
      },
    });
  } catch (error) {
    console.error("Event stats error:", error);
    res.status(500).json({ message: error.message || "Failed to fetch event stats" });
  }
});

export default router;