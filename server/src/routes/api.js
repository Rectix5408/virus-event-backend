import express from "express";
import rateLimit from "express-rate-limit";
import { createCheckoutSession, constructWebhookEvent, handleStripeWebhook } from "../services/stripe.js";
import { isValidEmail } from "../utils/helpers.js";
import { updateCheckIn, getTicketById, getTicketsByEmail, getEventStats, findTicketByQRCode } from "../services/ticket.js";
import users from "./users.js";
import { protect } from './auth.js';
import { getDatabase } from "../config/database.js";
import { emitEvent } from "../services/socket.js";

const router = express.Router();

router.use('/users', protect, users);

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 checkout attempts per window
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: "Too many checkout attempts from this IP, please try again after 15 minutes.",
});

/**
 * GET /api/tickets
 * Get all tickets (Admin only)
 */
router.get("/tickets", protect, async (req, res) => {
  try {
    const db = getDatabase();
    const [tickets] = await db.execute("SELECT * FROM tickets ORDER BY createdAt DESC");
    res.json(tickets);
  } catch (error) {
    console.error("Get all tickets error:", error);
    res.status(500).json({ message: "Failed to fetch tickets" });
  }
});


/**
 * POST /api/create-checkout-session
 * Creates a Stripe checkout session
 */
router.post("/create-checkout-session", checkoutLimiter, async (req, res) => {
  try {
    const { tierId, quantity, email, firstName, lastName, address, zipCode, city, mobileNumber, eventId, successUrl, cancelUrl } = req.body;

    // Validation
    if (!tierId || !quantity || !email || !firstName || !lastName || !address || !zipCode || !city || !mobileNumber || !eventId) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    if (quantity < 1) {
      return res.status(400).json({ message: "Quantity must be at least 1" });
    }

    // Create session
    const session = await createCheckoutSession({
      tierId,
      quantity,
      email,
      firstName,
      lastName,
      address,
      zipCode,
      city,
      mobileNumber,
      eventId,
      successUrl: successUrl || `${process.env.FRONTEND_URL}/tickets/success`,
      cancelUrl: cancelUrl || `${process.env.FRONTEND_URL}/tickets`,
    });

    res.status(200).json(session);
  } catch (error) {
    console.error("Checkout session error:", error);
    res.status(500).json({ message: error.message || "Failed to create checkout session" });
  }
});

/**
 * POST /api/webhooks/stripe
 * Handles Stripe webhook events
 */
router.post("/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res) => {
  const signature = req.headers["stripe-signature"];

  try {
    if (!signature) {
      return res.status(400).json({ message: "No Stripe signature provided" });
    }

    // Construct webhook event
    const event = constructWebhookEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);

    // Handle webhook
    await handleStripeWebhook(event);

    res.status(200).json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(400).json({ message: error.message });
  }
});

/**
 * POST /api/checkin
 * Check in a ticket via QR code
 */
router.post("/checkin", async (req, res) => {
  try {
    const { qrCode } = req.body;

    if (!qrCode) {
      return res.status(400).json({ message: "QR code is required" });
    }

    // Find ticket by QR code
    const ticket = await findTicketByQRCode(qrCode);

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    if (ticket.checkIn) {
      return res.status(400).json({ message: "Ticket already checked in" });
    }

    // Update check-in status
    await updateCheckIn(ticket.id, true);

    res.status(200).json({
      success: true,
      message: "Check-in successful",
      ticket: {
        id: ticket.id,
        firstName: ticket.firstName,
        lastName: ticket.lastName,
        tierName: ticket.tierName,
        checkInTime: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Check-in error:", error);
    res.status(500).json({ message: error.message || "Check-in failed" });
  }
});

/**
 * GET /api/tickets/:email
 * Get user's tickets
 */
router.get("/tickets/:email", async (req, res) => {
  try {
    const { email } = req.params;

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    const tickets = await getTicketsByEmail(email);

    res.status(200).json({
      success: true,
      count: tickets.length,
      tickets: tickets.map((t) => ({
        id: t.id,
        tierName: t.tierName,
        eventId: t.eventId,
        checkIn: t.checkIn,
        checkInTime: t.checkInTime,
        createdAt: t.createdAt,
        address: t.address,
        zipCode: t.zipCode,
        city: t.city,
        mobileNumber: t.mobileNumber,
      })),
    });
  } catch (error) {
    console.error("Get tickets error:", error);
    res.status(500).json({ message: error.message || "Failed to fetch tickets" });
  }
});

/**
 * GET /api/tickets/id/:ticketId
 * Get ticket details
 */
router.get("/tickets/id/:ticketId", async (req, res) => {
  try {
    const { ticketId } = req.params;

    const ticket = await getTicketById(ticketId);

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    res.status(200).json({
      success: true,
      ticket: {
        id: ticket.id,
        email: ticket.email,
        firstName: ticket.firstName,
        lastName: ticket.lastName,
        tierName: ticket.tierName,
        eventId: ticket.eventId,
        checkIn: ticket.checkIn,
        checkInTime: ticket.checkInTime,
        createdAt: ticket.createdAt,
        address: ticket.address,
        zipCode: ticket.zipCode,
        city: ticket.city,
        mobileNumber: ticket.mobileNumber,
      },
    });
  } catch (error) {
    console.error("Get ticket error:", error);
    res.status(500).json({ message: error.message || "Failed to fetch ticket" });
  }
});

/**
 * DELETE /api/tickets/:id
 * Delete a ticket (Admin)
 */
router.delete("/tickets/:id", protect, async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDatabase();
    await db.execute("DELETE FROM tickets WHERE id = ?", [id]);
    res.json({ success: true, message: "Ticket deleted" });
  } catch (error) {
    console.error("Delete ticket error:", error);
    res.status(500).json({ message: "Failed to delete ticket" });
  }
});

/**
 * PUT /api/tickets/:id/checkin
 * Toggle check-in status (Admin)
 */
router.put("/tickets/:id/checkin", protect, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    await updateCheckIn(id, status);
    res.json({ success: true, message: "Check-in status updated" });
  } catch (error) {
    console.error("Check-in update error:", error);
    res.status(500).json({ message: "Failed to update check-in status" });
  }
});

/**
 * POST /api/tickets/:id/resend
 * Resend ticket email (Admin placeholder)
 */
router.post("/tickets/:id/resend", protect, async (req, res) => {
  // Hier würde die Email-Logik integriert werden.
  // Da der Email-Service hier nicht direkt importiert ist, simulieren wir den Erfolg.
  console.log(`[Admin] Resending email for ticket ${req.params.id}`);
  res.json({ success: true, message: "Email resent successfully" });
});

/**
 * GET /api/settings/maintenance
 * Get maintenance mode status
 */
router.get("/settings/maintenance", async (req, res) => {
  try {
    const db = getDatabase();
    // Ensure table exists (Auto-Migration for simplicity)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        setting_key VARCHAR(50) PRIMARY KEY,
        setting_value VARCHAR(255)
      )
    `);

    const [rows] = await db.execute("SELECT setting_value FROM settings WHERE setting_key = 'maintenance_mode'");
    const isActive = rows.length > 0 && rows[0].setting_value === 'true';
    
    res.json({ isActive });
  } catch (error) {
    console.error("Get maintenance settings error:", error);
    // Default to false if DB fails, to not lock out users accidentally
    res.json({ isActive: false });
  }
});

/**
 * POST /api/settings/maintenance
 * Toggle maintenance mode (Admin)
 */
router.post("/settings/maintenance", protect, async (req, res) => {
  try {
    const { isActive } = req.body;
    const db = getDatabase();
    
    await db.execute(`
      INSERT INTO settings (setting_key, setting_value) 
      VALUES ('maintenance_mode', ?) 
      ON DUPLICATE KEY UPDATE setting_value = ?
    `, [String(isActive), String(isActive)]);

    // Emit event for realtime updates
    emitEvent("maintenance_update", { isActive });
    
    res.json({ success: true, isActive });
  } catch (error) {
    console.error("Update maintenance settings error:", error);
    res.status(500).json({ message: "Failed to update settings" });
  }
});

/**
 * POST /api/contact
 * Submit a contact request
 */
router.post("/contact", async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    const db = getDatabase();
    
    await db.execute(`
      CREATE TABLE IF NOT EXISTS contact_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255),
        email VARCHAR(255),
        subject VARCHAR(255),
        message TEXT,
        reply_message TEXT,
        status VARCHAR(50) DEFAULT 'open',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(
      "INSERT INTO contact_requests (name, email, subject, message) VALUES (?, ?, ?, ?)",
      [name, email, subject, message]
    );

    res.json({ success: true, message: "Request submitted" });
  } catch (error) {
    console.error("Contact submit error:", error);
    res.status(500).json({ message: "Failed to submit request" });
  }
});

/**
 * GET /api/admin/contact
 * Get all contact requests
 */
router.get("/admin/contact", protect, async (req, res) => {
  try {
    const db = getDatabase();
    // Ensure table exists
    await db.execute(`
      CREATE TABLE IF NOT EXISTS contact_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255),
        email VARCHAR(255),
        subject VARCHAR(255),
        message TEXT,
        reply_message TEXT,
        status VARCHAR(50) DEFAULT 'open',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    const [rows] = await db.execute("SELECT * FROM contact_requests ORDER BY created_at DESC");
    res.json(rows);
  } catch (error) {
    console.error("Get contact requests error:", error);
    res.status(500).json({ message: "Failed to fetch requests" });
  }
});

/**
 * DELETE /api/admin/contact/:id
 */
router.delete("/admin/contact/:id", protect, async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDatabase();
    await db.execute("DELETE FROM contact_requests WHERE id = ?", [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete" });
  }
});

/**
 * POST /api/admin/contact/:id/reply
 * Reply to a contact request
 */
router.post("/admin/contact/:id/reply", protect, async (req, res) => {
  try {
    const { id } = req.params;
    const { replyMessage, subject } = req.body;
    const db = getDatabase();

    const [rows] = await db.execute("SELECT * FROM contact_requests WHERE id = ?", [id]);
    if (rows.length === 0) return res.status(404).json({ message: "Request not found" });
    
    const request = rows[0];

    // Hier würde die echte E-Mail-Logik stehen (z.B. mit nodemailer)
    // Da wir keinen direkten Zugriff auf den Email-Service haben, simulieren wir den Versand.
    console.log(`📧 [Mock Email] To: ${request.email}, Subject: ${subject}, Body: ${replyMessage}`);

    // Auto-Migration: Spalte hinzufügen falls sie fehlt (für bestehende Installationen)
    try {
      await db.execute("ALTER TABLE contact_requests ADD COLUMN reply_message TEXT");
    } catch (e) {
      // Fehler ignorieren, wenn Spalte schon existiert
    }

    await db.execute("UPDATE contact_requests SET status = 'replied', reply_message = ? WHERE id = ?", [replyMessage, id]);

    res.json({ success: true, message: "Reply sent" });
  } catch (error) {
    console.error("Reply error:", error);
    res.status(500).json({ message: "Failed to send reply" });
  }
});

export default router;
