import Stripe from "stripe";
import { getDatabase } from "../config/database.js";
import { sendTicketEmail } from "./email.js";
import { generateTicketId } from "../utils/helpers.js";
import QRCode from "qrcode";

// Sicherstellen, dass der Server nicht abstürzt, wenn der Key fehlt
const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  console.error("❌ CRITICAL: STRIPE_SECRET_KEY fehlt in den Umgebungsvariablen! Überprüfe die .env Datei.");
}
const stripe = new Stripe(stripeKey || 'sk_test_dummy_key_to_prevent_crash');

/**
 * Erstellt eine Stripe Checkout Session (OHNE Ticket zu erstellen)
 */
export const createCheckoutSession = async (payload) => {
  const { tierId, quantity, email, firstName, lastName, address, zipCode, city, mobileNumber, eventId, successUrl, cancelUrl } = payload;
  const db = getDatabase();
  const connection = await db.getConnection();

  try {
    // Event validieren (Kein Locking nötig hier, da wir nur lesen)
    const [eventRows] = await connection.execute(
      "SELECT * FROM events WHERE id = ?", 
      [eventId]
    );
    const event = eventRows[0];

    if (!event) {
      throw new Error(`Event nicht gefunden: ${eventId}`);
    }

    event.ticketTiers = JSON.parse(event.ticketTiers);
    const selectedTier = event.ticketTiers.find(tier => tier.id === tierId);

    if (!selectedTier) {
      throw new Error(`Ungültige Ticketart: ${tierId}`);
    }

    // Verfügbarkeit prüfen (amountTickets ist der einzige Bestandswert)
    // Fallback auf alte Felder für Migration
    const currentStock = selectedTier.amountTickets !== undefined 
      ? selectedTier.amountTickets 
      : (selectedTier.availableQuantity !== undefined ? selectedTier.availableQuantity : selectedTier.totalQuantity);

    if (quantity > currentStock) {
      throw new Error(`Nicht genügend Tickets verfügbar. Nur noch ${currentStock} verfügbar.`);
    }

    // Temporäre Ticket-ID für Webhook-Zuordnung
    const tempTicketId = generateTicketId();

    // Stripe Session erstellen (OHNE Ticket in DB zu speichern)
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "eur",
          product_data: {
            name: `${event.title} - ${selectedTier.name}`,
            description: `${quantity}x Ticket für ${event.title}`,
            images: event.imageUrl ? [event.imageUrl] : [],
          },
          unit_amount: Math.round(selectedTier.price * 100), // In Cents
        },
        quantity,
      }],
      mode: "payment",
      success_url: `${successUrl}${successUrl.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      customer_email: email,
      metadata: {
        type: "ticket",
        ticketId: tempTicketId,
        eventId: eventId,
        tierId: tierId,
        quantity: quantity.toString(),
        firstName: firstName,
        lastName: lastName,
        email: email,
        address: address,
        zipCode: zipCode,
        city: city,
        mobileNumber: mobileNumber,
      },
      expires_at: Math.floor(Date.now() / 1000) + 1800, // 30 Minuten
      payment_intent_data: {
        metadata: {
          type: "ticket",
          ticketId: tempTicketId,
          eventId: eventId,
        }
      }
    });
    
    return {
      sessionId: session.id,
      url: session.url,
    };
  } catch (error) {
    console.error("Checkout-Fehler:", error);
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Webhook Handler - Hier wird das Ticket ERST nach erfolgreicher Zahlung erstellt
 */
export const handleStripeWebhook = async (event) => {
  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object);
        break;
      case "payment_intent.succeeded":
        console.log("✓ Payment Intent erfolgreich:", event.data.object.id);
        break;
      case "payment_intent.payment_failed":
        await handlePaymentFailed(event.data.object);
        break;
      case "charge.refunded":
        await handleRefund(event.data.object);
        break;
      default:
        console.log(`Unbehandelter Event-Typ: ${event.type}`);
    }

    return { received: true };
  } catch (error) {
    console.error("Webhook-Fehler:", error);
    throw error;
  }
};

/**
 * Behandelt erfolgreiche Checkout-Sessions
 */
const handleCheckoutCompleted = async (session) => {
  const { metadata } = session;
  const db = getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // Typ prüfen (Ticket vs Merch)
    if (metadata.type === "ticket") {
      await createTicketAfterPayment(session, connection);
    } else if (metadata.type === "merch") {
      await createMerchOrderAfterPayment(session, connection);
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    console.error("Fehler beim Verarbeiten der erfolgreichen Zahlung:", error);
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Erstellt Ticket NACH erfolgreicher Zahlung
 */
const createTicketAfterPayment = async (session, connection) => {
  const { ticketId, eventId, tierId, quantity, firstName, lastName, email, address, zipCode, city, mobileNumber } = session.metadata;

  // Prüfen ob Ticket bereits existiert (Duplikat-Schutz)
  const [existing] = await connection.execute(
    "SELECT id FROM tickets WHERE paymentIntentId = ?",
    [session.payment_intent]
  );

  if (existing.length > 0) {
    console.log(`✓ Ticket bereits erstellt für Payment Intent: ${session.payment_intent}`);
    return;
  }

  // Event-Details laden und sperren für Update
  const [eventRows] = await connection.execute(
    "SELECT * FROM events WHERE id = ? FOR UPDATE",
    [eventId]
  );
  const event = eventRows[0];
  if (!event) {
    throw new Error(`Event nicht gefunden: ${eventId}`);
  }

  // Tiers parsen
  let ticketTiers = event.ticketTiers;
  if (typeof ticketTiers === 'string') {
    ticketTiers = JSON.parse(ticketTiers);
  }

  const selectedTier = ticketTiers.find(t => t.id === tierId);
  if (!selectedTier) {
    throw new Error(`Ticketart nicht gefunden: ${tierId}`);
  }

  // Migration: Fallback auf amountTickets
  if (selectedTier.amountTickets === undefined) {
    selectedTier.amountTickets = selectedTier.availableQuantity !== undefined 
      ? selectedTier.availableQuantity 
      : selectedTier.totalQuantity;
  }

  // Finale Verfügbarkeitsprüfung (Stock prüfen)
  if (parseInt(quantity) > selectedTier.amountTickets) {
    throw new Error(`Tickets nicht mehr verfügbar. Nur noch ${selectedTier.amountTickets} verfügbar.`);
  }

  // QR-Code generieren
  // Inhalt des QR-Codes für den Einlass-Scanner (JSON Format)
  const qrContent = {
    ticketId: ticketId,
    eventId: eventId,
    email: email
  };
  const qrCodeData = JSON.stringify(qrContent);

  const qrCodeImage = await QRCode.toDataURL(qrCodeData, {
    errorCorrectionLevel: "H",
    type: "image/png",
    quality: 0.95,
    margin: 1,
    width: 400,
  });

  // Ticket in Datenbank speichern
  await connection.execute(
    `INSERT INTO tickets (id, email, firstName, lastName, address, zipCode, city, mobileNumber, tierId, tierName, eventId, quantity, qrCode, paymentIntentId, status, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', NOW())`,
    [
      ticketId,
      email,
      firstName,
      lastName,
      address,
      zipCode,
      city,
      mobileNumber,
      tierId,
      selectedTier.name,
      eventId,
      parseInt(quantity),
      qrCodeImage,
      session.payment_intent
    ]
  );

  // Ticket abziehen (Stock reduzieren)
  selectedTier.amountTickets = Math.max(0, selectedTier.amountTickets - parseInt(quantity));

  // Alte Felder entfernen, um Datenbank sauber zu halten
  delete selectedTier.availableQuantity;
  delete selectedTier.totalQuantity;

  // Sold Out Flag setzen wenn 0
  if (selectedTier.amountTickets === 0) {
    selectedTier.isSoldOut = true;
  }

  // Event aktualisieren
  await connection.execute(
    "UPDATE events SET ticketTiers = ? WHERE id = ?",
    [JSON.stringify(ticketTiers), eventId]
  );

  // Email mit Ticket versenden
  const eventDetails = {
    name: event.title,
    date: event.date,
    time: event.time,
    location: event.location
  };

  const ticketData = {
    id: ticketId,
    email,
    firstName,
    lastName,
    address,
    zipCode,
    city,
    mobileNumber,
    tierName: selectedTier.name,
    quantity: parseInt(quantity),
    qrCode: qrCodeImage,
    eventId
  };

  try {
    await sendTicketEmail(ticketData, eventDetails);
    console.log(`✓ Ticket ${ticketId} erfolgreich erstellt und Email versendet`);
  } catch (emailError) {
    console.error(`⚠ Ticket ${ticketId} erstellt, aber Email-Versand fehlgeschlagen:`, emailError.message);
    // Fehler nicht weiterwerfen, damit Ticket in DB gespeichert bleibt
  }
};

/**
 * Erstellt Merch-Bestellung NACH erfolgreicher Zahlung
 */
const createMerchOrderAfterPayment = async (session, connection) => {
  const { productId, productName, size, quantity, firstName, lastName, address } = session.metadata;

  // Prüfen ob Bestellung bereits existiert
  const [existing] = await connection.execute(
    "SELECT orderId FROM merch_orders WHERE paymentIntentId = ?",
    [session.payment_intent]
  );

  if (existing.length > 0) {
    console.log(`✓ Merch-Bestellung bereits erstellt für Payment Intent: ${session.payment_intent}`);
    return;
  }

  const orderId = 'ORD-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  const parsedAddress = JSON.parse(address);

  const items = [{
    productId,
    productName,
    size,
    quantity: parseInt(quantity),
    price: session.amount_total / 100 / parseInt(quantity)
  }];

  // Bestellung speichern
  await connection.execute(
    `INSERT INTO merch_orders (orderId, email, firstName, lastName, address, items, totalAmount, paymentIntentId, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', NOW())`,
    [
      orderId,
      session.customer_email,
      firstName,
      lastName,
      address,
      JSON.stringify(items),
      session.amount_total / 100,
      session.payment_intent
    ]
  );

  // Stock reduzieren
  const [product] = await connection.execute(
    'SELECT stock FROM merch_products WHERE id = ?',
    [productId]
  );

  if (product.length > 0) {
    const stock = JSON.parse(product[0].stock);
    stock[size] = Math.max(0, (stock[size] || 0) - parseInt(quantity));
    
    await connection.execute(
      'UPDATE merch_products SET stock = ? WHERE id = ?',
      [JSON.stringify(stock), productId]
    );
  }

  console.log(`✓ Merch-Bestellung ${orderId} erfolgreich erstellt`);
};

/**
 * Behandelt fehlgeschlagene Zahlungen
 */
const handlePaymentFailed = async (paymentIntent) => {
  console.error("❌ Zahlung fehlgeschlagen:", paymentIntent.id);
  // Hier könntest du optionally den User benachrichtigen
};

/**
 * Behandelt Rückerstattungen
 */
const handleRefund = async (charge) => {
  const db = getDatabase();
  const connection = await db.getConnection();

  try {
    // Ticket auf "refunded" setzen
    await connection.execute(
      "UPDATE tickets SET status = 'refunded' WHERE paymentIntentId = ?",
      [charge.payment_intent]
    );

    // Merch-Bestellung auf "refunded" setzen
    await connection.execute(
      "UPDATE merch_orders SET status = 'refunded' WHERE paymentIntentId = ?",
      [charge.payment_intent]
    );

    console.log(`✓ Rückerstattung verarbeitet für Payment Intent: ${charge.payment_intent}`);
  } catch (error) {
    console.error("Fehler beim Verarbeiten der Rückerstattung:", error);
  } finally {
    connection.release();
  }
};

/**
 * Webhook Event konstruieren und verifizieren
 */
export const constructWebhookEvent = (body, signature, webhookSecret) => {
  try {
    if (!webhookSecret) {
      throw new Error("Webhook Secret fehlt in Umgebungsvariablen");
    }

    const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    console.log(`✓ Webhook Event verifiziert: ${event.type}`);
    return event;
  } catch (error) {
    console.error("❌ Webhook-Signatur-Verifizierung fehlgeschlagen:", error.message);
    throw error;
  }
};