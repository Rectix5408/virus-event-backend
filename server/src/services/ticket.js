import { getDatabase } from "../config/database.js";
import { generateTicketId } from "../utils/helpers.js";

/**
 * Save ticket to database
 * Can be used with a transaction by passing a dbConnection
 */
export const saveTicket = async (ticketData, dbConnection = null) => {
  const db = getDatabase();
  // Use the provided connection or get a new one
  const connection = dbConnection || (await db.getConnection());

  try {
    const query = `
      INSERT INTO tickets (
        id, email, firstName, lastName, tierId, tierName, eventId,
        quantity, qrCode, paymentIntentId, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      ticketData.id, ticketData.email, ticketData.firstName, ticketData.lastName,
      ticketData.tierId, ticketData.tierName, ticketData.eventId, ticketData.quantity,
      ticketData.qrCode, ticketData.paymentIntentId, ticketData.status || "confirmed",
    ];

    const [result] = await connection.execute(query, values);
    
    // Only release the connection if it was created within this function
    if (!dbConnection) {
      connection.release();
    }

    console.log(`✓ Ticket saved: ${ticketData.id}`);
    return result;
  } catch (error) {
    console.error("Error saving ticket:", error);
    // If we're using a transaction, the calling function should handle rollback
    // If not, we release the connection on error.
    if (!dbConnection && connection) {
      connection.release();
    }
    throw error;
  }
};

/**
 * Get ticket by ID
 */
export const getTicketById = async (ticketId) => {
  try {
    const db = getDatabase();
    const connection = await db.getConnection();

    const [tickets] = await connection.execute(
      "SELECT * FROM tickets WHERE id = ?",
      [ticketId]
    );

    connection.release();
    return tickets[0] || null;
  } catch (error) {
    console.error("Error fetching ticket:", error);
    throw error;
  }
};

/**
 * Get tickets by email
 */
export const getTicketsByEmail = async (email) => {
  try {
    const db = getDatabase();
    const connection = await db.getConnection();

    const [tickets] = await connection.execute(
      "SELECT * FROM tickets WHERE email = ? ORDER BY createdAt DESC",
      [email]
    );

    connection.release();
    return tickets;
  } catch (error) {
    console.error("Error fetching tickets by email:", error);
    throw error;
  }
};

/**
 * Get all tickets for an event
 */
export const getEventTickets = async (eventId) => {
  try {
    const db = getDatabase();
    const connection = await db.getConnection();

    const [tickets] = await connection.execute(
      "SELECT * FROM tickets WHERE eventId = ? ORDER BY createdAt DESC",
      [eventId]
    );

    connection.release();
    return tickets;
  } catch (error) {
    console.error("Error fetching event tickets:", error);
    throw error;
  }
};

/**
 * Count tickets for a specific tier and status
 */
export const countTicketsByTier = async (eventId, tierId, status = ['confirmed', 'pending'], dbConnection = null) => {
  const db = getDatabase();
  const connection = dbConnection || (await db.getConnection());

  try {
    const placeholders = status.map(() => '?').join(',');
    const query = `
      SELECT SUM(quantity) as count 
      FROM tickets 
      WHERE eventId = ? AND tierId = ? AND status IN (${placeholders})
    `;

    const params = [eventId, tierId, ...status];

    const [rows] = await connection.execute(query, params);

    if (!dbConnection) {
      connection.release();
    }

    return rows[0].count || 0;
  } catch (error) {
    if (!dbConnection && connection) {
      connection.release();
    }
    console.error("Error counting tickets by tier:", error);
    throw error;
  }
};

/**
 * Update ticket status
 */
export const updateTicketStatus = async (ticketId, status, dbConnection = null) => {
  const db = getDatabase();
  const connection = dbConnection || (await db.getConnection());

  try {
    const query = "UPDATE tickets SET status = ? WHERE id = ?";
    const [result] = await connection.execute(query, [status, ticketId]);

    if (!dbConnection) {
      connection.release();
    }

    console.log(`✓ Ticket status updated for ${ticketId} to ${status}`);
    return result;
  } catch (error) {
    if (!dbConnection && connection) {
      connection.release();
    }
    console.error("Error updating ticket status:", error);
    throw error;
  }
};

/**
 * Update ticket check-in status
 */
export const updateCheckIn = async (ticketId, checked = true) => {
  try {
    const db = getDatabase();
    const connection = await db.getConnection();

    const checkInTime = checked ? new Date() : null;

    const query = `
      UPDATE tickets 
      SET checkIn = ?, checkInTime = ?
      WHERE id = ?
    `;

    const [result] = await connection.execute(query, [checked, checkInTime, ticketId]);
    connection.release();

    console.log(`✓ Check-in updated for ticket: ${ticketId}`);
    return result;
  } catch (error) {
    console.error("Error updating check-in:", error);
    throw error;
  }
};

/**
 * Get event statistics
 */
export const getEventStats = async (eventId) => {
  try {
    const db = getDatabase();
    const connection = await db.getConnection();

    const [stats] = await connection.execute(
      `SELECT 
        COUNT(*) as totalTickets,
        SUM(CASE WHEN checkIn = true THEN 1 ELSE 0 END) as checkedIn,
        COUNT(DISTINCT email) as uniqueVisitors
       FROM tickets 
       WHERE eventId = ?`,
      [eventId]
    );

    connection.release();
    return stats[0];
  } catch (error) {
    console.error("Error fetching event stats:", error);
    throw error;
  }
};

/**
 * Find ticket by QR code
 */
export const findTicketByQRCode = async (qrCode) => {
  try {
    const db = getDatabase();
    const connection = await db.getConnection();

    const [tickets] = await connection.execute(
      "SELECT * FROM tickets WHERE qrCode = ?",
      [qrCode]
    );

    connection.release();
    return tickets[0] || null;
  } catch (error) {
    console.error("Error finding ticket by QR code:", error);
    throw error;
  }
};

/**
 * Find ticket by Payment Intent ID
 */
export const findTicketByPaymentIntentId = async (paymentIntentId) => {
  try {
    const db = getDatabase();
    const connection = await db.getConnection();

    const [tickets] = await connection.execute(
      "SELECT * FROM tickets WHERE paymentIntentId = ?",
      [paymentIntentId]
    );

    connection.release();
    return tickets[0] || null;
  } catch (error) {
    console.error("Error finding ticket by payment intent id:", error);
    throw error;
  }
};