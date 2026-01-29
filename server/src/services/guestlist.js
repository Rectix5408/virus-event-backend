import { getDatabase } from "../config/database.js";
import { sendTicketEmail } from "./email.js";
import { generateTicketId } from "../utils/helpers.js";
import QRCode from "qrcode";
import { emitEvent } from "./socket.js";
import { invalidateCache } from "../middleware/cache.js";

/**
 * Fügt einen Gast zur Gästeliste für ein bestimmtes Event hinzu.
 */
export const addGuest = async ({ eventId, name, email, category, plusOne }) => {
  const db = getDatabase();
  const connection = await db.getConnection();
  try {
    // Annahme: Eine Tabelle 'guestlist' existiert
    const [result] = await connection.execute(
      `INSERT INTO guestlist (eventId, name, email, category, plusOne, status, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, 'pending', NOW(), NOW())`,
      [eventId, name, email || null, category, plusOne || false]
    );

    const guestId = result.insertId;

    // QR Code generieren
    const qrContent = { type: 'guest', id: guestId, eventId, name };
    const qrCodeData = JSON.stringify(qrContent);
    const qrCodeImage = await QRCode.toDataURL(qrCodeData, {
      errorCorrectionLevel: "H", type: "image/png", quality: 0.95, margin: 1, width: 400,
    });

    await connection.execute("UPDATE guestlist SET qrCode = ? WHERE id = ?", [qrCodeImage, guestId]);

    // Rückgabe des neu erstellten Gastes zur sofortigen Anzeige im Frontend
    const [guestRows] = await connection.execute("SELECT * FROM guestlist WHERE id = ?", [guestId]);
    
    // Wenn E-Mail vorhanden, Ticket direkt generieren und senden
    if (email) {
      await generateGuestTicket({ guestId, email });
    }

    // LIVE UPDATE & CACHE
    try {
      await invalidateCache([`guestlist:${eventId}`]);
      emitEvent('guestlist_update', { eventId, type: 'add', guest: guestRows[0] });
    } catch (e) { console.error("Realtime update failed", e); }

    return guestRows[0];
  } finally {
    connection.release();
  }
};

/**
 * Holt alle Gäste für ein bestimmtes Event.
 */
export const getGuestsForEvent = async (eventId) => {
  const db = getDatabase();
  const [rows] = await db.execute(
    `SELECT g.id, g.name, g.email, g.category, g.plusOne, g.status, g.ticketId, g.qrCode 
     FROM guestlist g
     LEFT JOIN tickets t ON g.ticketId = t.id
     WHERE g.eventId = ?
     ORDER BY g.createdAt DESC`,
    [eventId]
  );
  return rows;
};

/**
 * Löscht einen Gast von der Liste.
 */
export const deleteGuest = async (guestId) => {
    const db = getDatabase();
    
    // Event ID holen für Cache Invalidation und Socket Room
    const [rows] = await db.execute("SELECT eventId FROM guestlist WHERE id = ?", [guestId]);
    if (rows.length === 0) return { success: false };
    const eventId = rows[0].eventId;

    await db.execute("DELETE FROM guestlist WHERE id = ?", [guestId]);

    // LIVE UPDATE & CACHE
    try {
        await invalidateCache([`guestlist:${eventId}`]);
        emitEvent('guestlist_update', { eventId, type: 'delete', guestId });
    } catch (e) { console.error("Realtime update failed", e); }

    return { success: true };
};

/**
 * Checkt einen Gast ein.
 */
export const checkInGuest = async (guestId) => {
    const db = getDatabase();

    // Event ID holen für Cache Invalidation
    const [rows] = await db.execute("SELECT eventId FROM guestlist WHERE id = ?", [guestId]);
    if (rows.length === 0) return { success: false };
    const eventId = rows[0].eventId;

    await db.execute("UPDATE guestlist SET status = 'checked_in' WHERE id = ?", [guestId]);

    // LIVE UPDATE & CACHE
    try {
        await invalidateCache([`guestlist:${eventId}`]);
        emitEvent('guestlist_update', { eventId, type: 'update', guestId, status: 'checked_in' });
    } catch (e) { console.error("Realtime update failed", e); }

    return { success: true };
};

/**
 * Checkt einen Gast aus (Status zurücksetzen).
 */
export const checkOutGuest = async (guestId) => {
    const db = getDatabase();

    // Event ID holen für Cache Invalidation
    const [rows] = await db.execute("SELECT eventId FROM guestlist WHERE id = ?", [guestId]);
    if (rows.length === 0) return { success: false };
    const eventId = rows[0].eventId;

    await db.execute("UPDATE guestlist SET status = 'pending' WHERE id = ?", [guestId]);

    // LIVE UPDATE & CACHE
    try {
        await invalidateCache([`guestlist:${eventId}`]);
        emitEvent('guestlist_update', { eventId, type: 'update', guestId, status: 'pending' });
    } catch (e) { console.error("Realtime update failed", e); }

    return { success: true };
};

/**
 * Aktualisiert die Daten eines Gastes.
 */
export const updateGuest = async (guestId, { name, email, category, plusOne }) => {
  const db = getDatabase();
  const connection = await db.getConnection();
  try {
    const [result] = await connection.execute(
      `UPDATE guestlist SET name = ?, email = ?, category = ?, plusOne = ? WHERE id = ?`,
      [name, email || null, category, plusOne, guestId]
    );

    const [guestRows] = await connection.execute("SELECT eventId FROM guestlist WHERE id = ?", [guestId]);
    if (guestRows.length > 0) {
      const eventId = guestRows[0].eventId;
      await invalidateCache([`guestlist:${eventId}`]);
      emitEvent('guestlist_update', { eventId, type: 'update', guestId });
    }
    return { success: result.affectedRows > 0 };
  } finally {
    connection.release();
  }
};

/**
 * Generiert ein gültiges Ticket für einen Gästelisten-Eintrag.
 * Diese Funktion ist eine Adaption von `createTicketAfterPayment` für kostenlose Gästetickets.
 */
export const generateGuestTicket = async ({ guestId, email }) => {
  const db = getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Gästelisten-Eintrag holen und sperren
    const [guestRows] = await connection.execute(
      "SELECT * FROM guestlist WHERE id = ? FOR UPDATE",
      [guestId]
    );
    const guest = guestRows[0];

    if (!guest) throw new Error("Gästelisten-Eintrag nicht gefunden.");

    // Fall 1: Ticket existiert bereits -> Erneut senden
    if (guest.ticketId) {
      const [ticketRows] = await connection.execute("SELECT * FROM tickets WHERE id = ?", [guest.ticketId]);
      if (!ticketRows.length) throw new Error(`Zugehöriges Ticket ${guest.ticketId} nicht gefunden.`);
      const ticket = ticketRows[0];
      
      const [eventRows] = await connection.execute("SELECT * FROM events WHERE id = ?", [guest.eventId]);
      const event = eventRows[0];
      if (!event) throw new Error(`Event nicht gefunden: ${guest.eventId}`);

      const targetEmail = email || guest.email || ticket.email;
      if (!targetEmail) throw new Error("Keine E-Mail-Adresse zum Senden vorhanden.");

      const eventDetails = { name: event.title, date: event.date, time: event.time, location: event.location };
      await sendTicketEmail({ ...ticket, email: targetEmail }, eventDetails);
      
      await connection.commit(); // Transaktion abschließen
      console.log(`✓ E-Mail für Ticket ${ticket.id} erneut an ${targetEmail} gesendet.`);
      return { success: true, ticketId: ticket.id, resent: true };
    }
    // Fall 2: Neues Ticket erstellen

    // 2. Event-Details holen
    const [eventRows] = await connection.execute(
      "SELECT * FROM events WHERE id = ?",
      [guest.eventId]
    );
    const event = eventRows[0];
    if (!event) throw new Error(`Event nicht gefunden: ${guest.eventId}`);

    // 3. Ticket erstellen
    const ticketId = generateTicketId();
    const quantity = guest.plusOne ? 2 : 1;
    const tierName = `Gästeliste (${guest.category})`;

    const qrContent = { ticketId, eventId: guest.eventId, name: guest.name };
    const qrCodeData = JSON.stringify(qrContent);
    const qrCodeImage = await QRCode.toDataURL(qrCodeData, {
      errorCorrectionLevel: "H", type: "image/png", quality: 0.95, margin: 1, width: 400,
    });

    await connection.execute(
      `INSERT INTO tickets (id, email, firstName, lastName, tierId, tierName, eventId, eventTitle, quantity, qrCode, paymentIntentId, status, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', NOW())`,
      [
        ticketId,
        email || null, // E-Mail ist optional
        guest.name,
        `(${guest.category})`,
        'guestlist', // Spezielle Tier-ID
        tierName,
        guest.eventId,
        event.title,
        quantity,
        qrCodeImage,
        `guest_${guest.id}` // Eindeutige "Payment" ID
      ]
    );

    // 4. Gästelisten-Eintrag mit der neuen Ticket-ID aktualisieren
    await connection.execute(
      "UPDATE guestlist SET ticketId = ? WHERE id = ?",
      [ticketId, guest.id]
    );

    await connection.commit();

    // 5. Ticket per E-Mail senden (falls eine E-Mail angegeben wurde)
    if (email) {
      const eventDetails = { name: event.title, date: event.date, time: event.time, location: event.location };
      const ticketData = {
        id: ticketId, email, firstName: guest.name, lastName: `(${guest.category})`,
        tierName, quantity, qrCode: qrCodeImage, eventId: guest.eventId
      };
      try {
        await sendTicketEmail(ticketData, eventDetails);
      } catch (emailError) {
        console.error(`⚠ Ticket ${ticketId} erstellt, aber Email-Versand fehlgeschlagen:`, emailError.message);
      }
    }

    // LIVE UPDATE & CACHE
    try {
        await invalidateCache([`guestlist:${guest.eventId}`, 'events:all', `events:detail:${guest.eventId}`]);
        emitEvent('guestlist_update', { eventId: guest.eventId, type: 'update', guestId: guest.id, ticketId });
    } catch (e) { console.error("Realtime update failed", e); }

    return { success: true, ticketId, qrCode: qrCodeImage };

  } catch (error) {
    await connection.rollback();
    console.error("Fehler beim Generieren des Gästelisten-Tickets:", error);
    throw error;
  } finally {
    connection.release();
  }
};