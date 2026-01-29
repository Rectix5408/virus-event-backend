import express from 'express';
import { getDatabase } from "../config/database.js";
import { emitEvent } from "../services/socket.js";
import { invalidateCache } from "../middleware/cache.js";

const router = express.Router();

// GET /api/admin/tickets - Alle Tickets abrufen (nur verkaufte)
router.get('/', async (req, res) => {
  try {
    const db = getDatabase();
    const [tickets] = await db.execute('SELECT * FROM tickets ORDER BY createdAt DESC');
    res.json(tickets);
  } catch (error) {
    console.error("Fehler beim Laden der Tickets:", error);
    res.status(500).json({ error: "Fehler beim Laden der Tickets" });
  }
});

// POST /api/admin/tickets/validate - Ticket ODER Gästeliste scannen
router.post('/validate', async (req, res) => {
  const { qrContent, eventId } = req.body;
  
  if (!qrContent) {
    return res.status(400).json({ valid: false, message: "Kein QR-Code Inhalt" });
  }

  const db = getDatabase();

  try {
    // 1. Versuch: Suche in TICKETS Tabelle
    // Wir suchen nach der Ticket ID im QR Content (der meist ein JSON String ist)
    let ticketId = null;
    let isGuest = false;

    try {
      const parsed = JSON.parse(qrContent);
      ticketId = parsed.ticketId || parsed.id;
      // Optional: Prüfen ob Event ID übereinstimmt, falls im QR Code vorhanden
      if (eventId && parsed.eventId && parsed.eventId !== eventId) {
         return res.status(400).json({ valid: false, message: "Ticket ist für ein anderes Event!" });
      }
    } catch (e) {
      // Fallback: QR Content ist direkt die ID
      ticketId = qrContent;
    }

    // Zuerst in Tickets suchen
    const [tickets] = await db.execute('SELECT * FROM tickets WHERE id = ?', [ticketId]);
    
    if (tickets.length > 0) {
      const ticket = tickets[0];
      
      if (ticket.checkIn) {
        return res.status(400).json({ valid: false, message: `Bereits eingecheckt am ${new Date(ticket.checkInTime).toLocaleTimeString()}`, ticket });
      }

      // Check-In durchführen
      await db.execute('UPDATE tickets SET checkIn = TRUE, checkInTime = NOW() WHERE id = ?', [ticketId]);
      
      // Realtime Update
      emitEvent('ticket_checkin', { ticketId, eventId: ticket.eventId });
      
      return res.json({ valid: true, type: 'ticket', message: "Ticket gültig! Viel Spaß.", ticket: { ...ticket, checkIn: true } });
    }

    // 2. Versuch: Suche in GÄSTELISTE
    // Gästelisten-IDs sind oft INTs, aber im QR Code als String/JSON
    // Wir suchen in der guestlist Tabelle nach id (wenn numerisch) oder ticketId (wenn generiert)
    
    // Versuch über ticketId Spalte in guestlist (falls wir UUIDs nutzen)
    let [guests] = await db.execute('SELECT * FROM guestlist WHERE ticketId = ?', [ticketId]);
    
    // Fallback: Versuch über ID (Primary Key)
    if (guests.length === 0 && !isNaN(ticketId)) {
       [guests] = await db.execute('SELECT * FROM guestlist WHERE id = ?', [ticketId]);
    }

    if (guests.length > 0) {
      const guest = guests[0];

      if (eventId && guest.eventId !== eventId) {
        return res.status(400).json({ valid: false, message: "Gästelisten-Platz ist für ein anderes Event!" });
      }

      if (guest.status === 'checked_in') {
        return res.status(400).json({ valid: false, message: "Gast bereits eingecheckt!", guest });
      }

      // Check-In
      await db.execute("UPDATE guestlist SET status = 'checked_in' WHERE id = ?", [guest.id]);
      
      // Realtime Update
      emitEvent('guestlist_update', { eventId: guest.eventId, type: 'update', guestId: guest.id, status: 'checked_in' });

      return res.json({ valid: true, type: 'guest', message: `Gästeliste: ${guest.name} (${guest.category})`, guest: { ...guest, status: 'checked_in' } });
    }

    return res.status(404).json({ valid: false, message: "Ticket oder Gast nicht gefunden." });

  } catch (error) {
    console.error("Scan Error:", error);
    res.status(500).json({ error: "Serverfehler beim Scannen" });
  }
});

export default router;