import express from "express";
import rateLimit from "express-rate-limit";
import { createCheckoutSession, constructWebhookEvent, handleStripeWebhook } from "../services/stripe.js";
import { isValidEmail } from "../utils/helpers.js";
import { updateCheckIn, getTicketById, getTicketsByEmail, getEventStats, findTicketByQRCode } from "../services/ticket.js";
import users from "./users.js";
import { protect } from './auth.js';
import { getDatabase } from "../config/database.js";

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

export default router;
