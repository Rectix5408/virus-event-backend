import Stripe from "stripe";
import { getDatabase } from "../config/database.js";
import { sendTicketEmail } from "./email.js";
import { saveTicket, findTicketByPaymentIntentId, countTicketsByTier, updateTicketStatus, getTicketById } from "./ticket.js";
import { generateTicketId, generateTicketQRData } from "../utils/helpers.js";
import QRCode from "qrcode";
import { getEventById } from "./event.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Creates a Stripe Checkout Session
 */
export const createCheckoutSession = async (payload) => {
  const { tierId, quantity, email, firstName, lastName, eventId, successUrl, cancelUrl } = payload;
  const db = getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [eventRows] = await connection.execute("SELECT * FROM events WHERE id = ? FOR UPDATE", [eventId]);
    const event = eventRows[0];

    if (!event) {
      throw new Error(`Event not found for ID: ${eventId}`);
    }

    event.ticketTiers = JSON.parse(event.ticketTiers);
    const selectedTier = event.ticketTiers.find(tier => tier.id === tierId);

    if (!selectedTier) {
      throw new Error(`Invalid tier ID or tier not found for event: ${tierId}`);
    }

    const soldTickets = await countTicketsByTier(eventId, tierId, ['confirmed', 'pending'], connection);
    const availableQuantity = selectedTier.totalQuantity - soldTickets;

    if (quantity > availableQuantity) {
      throw new Error(`Not enough tickets available for tier ${tierId}. Only ${availableQuantity} left.`);
    }

    const unitPrice = selectedTier.price * 100;
    if (!unitPrice) {
      throw new Error(`Price not found for tier ID: ${tierId}`);
    }

    const ticketId = generateTicketId();
    const ticketData = {
      id: ticketId,
      email,
      firstName,
      lastName,
      tierId,
      tierName: selectedTier.name,
      eventId,
      quantity,
      qrCode: "", // Will be generated after payment
      paymentIntentId: "", // Fix: set to empty string instead of null
      status: "pending",
    };

    await saveTicket(ticketData, connection);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "eur",
          product_data: {
            name: `VIRUS EVENT Ticket - ${selectedTier.name}`,
            description: `${quantity} Ticket(s) für ${event.title}`,
          },
          unit_amount: unitPrice,
        },
        quantity,
      }],
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: email,
      metadata: {
        ticketId,
        eventId,
        tierId,
        quantity: quantity.toString()
      },
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    
    await connection.commit();

    return {
      sessionId: session.id,
      url: session.url,
    };
  } catch (error) {
    await connection.rollback();
    console.error("Checkout session creation error:", error);
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Processes Stripe Webhook Event
 */
export const handleStripeWebhook = async (event) => {
  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handlePaymentSucceeded(event.data.object);
        break;
      case "checkout.session.expired":
        await handleSessionExpired(event.data.object);
        break;
      case "payment_intent.payment_failed":
        console.log("Payment failed:", event.data.object.id);
        break;
      case "charge.refunded":
        console.log("Charge refunded:", event.data.object.id);
        break;
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return { received: true };
  } catch (error) {
    console.error("Webhook processing error:", error);
    throw error;
  }
};

/**
 * Handles successful payment
 */
const handlePaymentSucceeded = async (session) => {
  const { ticketId } = session.metadata;

  try {
    const ticket = await getTicketById(ticketId);
    if (!ticket) {
      throw new Error(`Ticket not found with ID: ${ticketId}`);
    }

    if (ticket.status === 'confirmed') {
      console.log(`Ticket ${ticketId} is already confirmed.`);
      return;
    }

    const qrCodeData = generateTicketQRData(ticket.id, ticket.email, ticket.eventId);
    const qrCodeImage = await QRCode.toDataURL(qrCodeData, {
      errorCorrectionLevel: "H",
      type: "image/png",
      quality: 0.95,
      margin: 1,
      width: 300,
    });

    const db = getDatabase();
    const connection = await db.getConnection();
    await connection.execute(
      "UPDATE tickets SET status = ?, qrCode = ?, paymentIntentId = ? WHERE id = ?", 
      ['confirmed', qrCodeImage, session.payment_intent, ticketId]
    );
    connection.release();
    
    const event = await getEventById(ticket.eventId);
    let eventDetails;
    if (!event) {
        console.warn(`Event not found for ID ${ticket.eventId}. Sending email with generic details.`);
        eventDetails = { name: "UNKNOWN EVENT", date: "N/A", time: "N/A", location: "N/A" };
    } else {
        eventDetails = { name: event.title, date: event.date, time: event.time, location: event.location };
    }

    const confirmedTicket = await getTicketById(ticketId);
    await sendTicketEmail(confirmedTicket, eventDetails);

    console.log(`✓ Ticket ${ticketId} confirmed and email sent.`);

  } catch (error) {
    console.error(`Error handling payment success for ticket ${ticketId}:`, error);
    throw error;
  }
};

const handleSessionExpired = async (session) => {
    const { ticketId } = session.metadata;
    try {
        const ticket = await getTicketById(ticketId);
        if (ticket && ticket.status === 'pending') {
            await updateTicketStatus(ticketId, 'expired');
            console.log(`Ticket ${ticketId} marked as expired.`);
        }
    } catch (error) {
        console.error(`Error handling expired session for ticket ${ticketId}:`, error);
    }
}

/**
 * Constructs Stripe Webhook Event from request
 */
export const constructWebhookEvent = (body, signature, webhookSecret) => {
  try {
    console.log("Stripe Webhook: Attempting to construct event with secret:", webhookSecret ? "Loaded" : "Missing");
    const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    return event;
  } catch (error) {
    console.error("Webhook signature verification failed:", error);
    throw error;
  }
};