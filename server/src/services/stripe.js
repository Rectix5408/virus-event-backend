import Stripe from "stripe";
import { getDatabase } from "../config/database.js";
import { sendTicketEmail } from "./email.js";
import { generateTicketId } from "../utils/helpers.js";
import QRCode from "qrcode";
import { emitEvent } from "./socket.js";
import { invalidateCache } from "../middleware/cache.js";

// Sicherstellen, dass der Server nicht abstürzt, wenn der Key fehlt
const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  console.error("❌ CRITICAL: STRIPE_SECRET_KEY fehlt in den Umgebungsvariablen! Überprüfe die .env Datei.");
}
const stripe = new Stripe(stripeKey || 'sk_test_dummy_key_to_prevent_crash', {
  apiVersion: '2024-06-20',
});

/**
 * Erstellt eine Stripe Checkout Session (OHNE Ticket zu erstellen)
 */
export const createCheckoutSession = async (payload) => {
  const { tierId, quantity: rawQuantity, email, firstName, lastName, address, zipCode, city, mobileNumber, eventId, successUrl, cancelUrl } = payload;
  const db = getDatabase();
  const connection = await db.getConnection();

  try {
    // Menge sicherstellen
    const quantity = parseInt(rawQuantity);
    if (isNaN(quantity) || quantity <= 0) {
      throw new Error(`Ungültige Menge: ${rawQuantity}`);
    }

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

    // Verfügbarkeit prüfen: Nur 'amountTickets' wird als Wahrheitsquelle verwendet.
    const currentStock = selectedTier.amountTickets ?? 0;
    if (quantity > currentStock) {
      throw new Error(`Nicht genügend Tickets verfügbar. Nur noch ${currentStock} verfügbar.`);
    }

    // Temporäre Ticket-ID für Webhook-Zuordnung
    const tempTicketId = generateTicketId();

    // FIX: customer_balance (Banküberweisung) erfordert zwingend ein Customer Object
    let customerId;
    try {
      // 1. Prüfen ob Kunde existiert (vermeidet Duplikate)
      const existingCustomers = await stripe.customers.list({ email: email, limit: 1 });
      
      if (existingCustomers.data.length > 0) {
        customerId = existingCustomers.data[0].id;
      } else {
        // 2. Neuen Kunden erstellen
        const newCustomer = await stripe.customers.create({
          email,
          name: `${firstName} ${lastName}`,
          metadata: { mobileNumber }
        });
        customerId = newCustomer.id;
      }
    } catch (err) {
      console.warn("Konnte Stripe Customer nicht verarbeiten:", err);
      // Fallback: Wir machen weiter, aber customer_balance könnte fehlschlagen
    }

    const metadata = {
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
    };

    // Stripe Session erstellen (OHNE Ticket in DB zu speichern)
    const sessionParams = {
      billing_address_collection: 'required',
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
      metadata: metadata,
      expires_at: Math.floor(Date.now() / 1000) + 1800, // 30 Minuten
      payment_intent_data: {
        metadata: metadata // Metadaten auch an PaymentIntent übergeben für Webhook-Redundanz
      }
    };
    
    // WICHTIG: Entweder customer ODER customer_email setzen, nicht beides
    if (customerId) {
      sessionParams.customer = customerId;
    } else {
      sessionParams.customer_email = email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

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
 * Verifiziert eine Stripe Session ID und gibt Status zurück
 */
export const verifyCheckoutSession = async (sessionId) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    if (!session) {
      throw new Error("Session nicht gefunden");
    }

    return {
      success: session.payment_status === 'paid',
      status: session.payment_status,
      eventId: session.metadata?.eventId,
      ticketId: session.metadata?.ticketId,
      email: session.customer_details?.email || session.metadata?.email,
      paymentIntentId: session.payment_intent,
      metadata: session.metadata
    };
  } catch (error) {
    console.error("Fehler bei Session-Verifizierung:", error);
    throw error;
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
        await handlePaymentIntentSucceeded(event.data.object);
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
 * Behandelt erfolgreiche Payment Intents (Backup für Checkout)
 */
const handlePaymentIntentSucceeded = async (paymentIntent) => {
  const { metadata } = paymentIntent;
  const db = getDatabase();
  const connection = await db.getConnection();

  try {
    // FIX: Doppelte Verarbeitung verhindern!
    // Da wir Stripe Checkout nutzen, wird 'checkout.session.completed' gefeuert.
    // 'payment_intent.succeeded' feuert AUCH, was zu Race-Conditions führt (doppelte Tickets/Emails).
    if (metadata && (metadata.type === "ticket" || metadata.type === "merch")) {
      console.log(`ℹ️ Skipping payment_intent.succeeded for ${metadata.type} (handled via checkout.session.completed)`);
      return;
    }

    await connection.beginTransaction();

    // Typ prüfen (Ticket vs Merch)
    if (metadata.type === "ticket") {
      await createTicketAfterPayment(metadata, paymentIntent.id, paymentIntent.amount / 100, connection);
    } else if (metadata.type === "merch") {
      await createMerchOrderAfterPayment(metadata, paymentIntent.id, paymentIntent.amount / 100, metadata.email, connection);
    }

    await connection.commit();
    console.log(`✓ Payment Intent ${paymentIntent.id} erfolgreich verarbeitet`);
  } catch (error) {
    await connection.rollback();
    console.error("Fehler beim Verarbeiten des Payment Intents:", error);
    throw error;
  } finally {
    connection.release();
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

    // Fallback für kostenlose Tickets/Bestellungen (kein PaymentIntent bei 0€)
    const paymentReference = session.payment_intent || session.id;

    // Typ prüfen (Ticket vs Merch)
    if (metadata.type === "ticket") {
      await createTicketAfterPayment(session.metadata, paymentReference, session.amount_total / 100, connection);
    } else if (metadata.type === "merch") {
      const email = session.metadata.email || session.customer_details?.email || session.customer_email;
      await createMerchOrderAfterPayment(session.metadata, paymentReference, session.amount_total / 100, email, connection);
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
export const createTicketAfterPayment = async (metadata, paymentId, amountTotal, connection) => {
  const { ticketId, eventId, tierId, quantity, firstName, lastName, email, address, zipCode, city, mobileNumber } = metadata;
  const qty = parseInt(quantity);

  // Prüfen ob Ticket bereits existiert (Duplikat-Schutz)
  const [existing] = await connection.execute(
    "SELECT id FROM tickets WHERE paymentIntentId = ?",
    [paymentId]
  );

  if (existing.length > 0) {
    console.log(`✓ Ticket bereits erstellt für Payment ID: ${paymentId}`);
    return;
  }

  // ZUSÄTZLICHER CHECK: Prüfen ob Ticket-ID (Primary Key) bereits existiert
  // Dies fängt Fälle ab, wo paymentIntentId Check aufgrund von Race-Conditions noch leer war
  const [existingById] = await connection.execute("SELECT id FROM tickets WHERE id = ?", [ticketId]);
  if (existingById.length > 0) {
    console.log(`✓ Ticket ${ticketId} existiert bereits (ID Check).`);
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

  // Finale Verfügbarkeitsprüfung (Stock prüfen)
  const currentStock = Number(selectedTier.amountTickets ?? 0);
  console.log(`[Ticket] Processing purchase: Event ${eventId}, Tier ${tierId}, Qty ${qty}, Stock before: ${currentStock}`);

  if (qty > currentStock) {
    console.error(`🚨 CRITICAL: Overselling detected for Event ${eventId}, Tier ${tierId}. Payment ${paymentId} was successful but stock is empty.`);
    throw new Error(`Tickets nicht mehr verfügbar. Nur noch ${currentStock} verfügbar.`);
  }

  // SCHLEIFE: Für jedes gekaufte Ticket einen eigenen Eintrag erstellen
  console.log(`[Ticket] Generating ${qty} individual tickets...`);
  
  const generatedTickets = []; // Array zum Sammeln aller Tickets

  for (let i = 0; i < qty; i++) {
    // Für das erste Ticket nutzen wir die ID aus den Metadaten (damit wir sie zuordnen können),
    // für alle weiteren generieren wir eine neue ID.
    const currentTicketId = (i === 0) ? ticketId : generateTicketId();
    
    // QR-Code generieren (Jedes Ticket hat seine eigene ID im QR-Code)
    const qrContent = {
      ticketId: currentTicketId,
      eventId: eventId,
      email: email,
      index: i + 1, // Info: Ticket 1 von 5
      total: qty
    };
    const qrCodeData = JSON.stringify(qrContent);

    const qrCodeImage = await QRCode.toDataURL(qrCodeData, {
      errorCorrectionLevel: "H",
      type: "image/png",
      quality: 0.95,
      margin: 1,
      width: 400,
    });

    // Ticket in Datenbank speichern (Quantity ist hier immer 1 pro Zeile)
    try {
      await connection.execute(
        `INSERT INTO tickets (id, email, firstName, lastName, address, zipCode, city, mobileNumber, tierId, tierName, eventId, eventTitle, quantity, qrCode, paymentIntentId, status, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', NOW())`,
        [
          currentTicketId,
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
          event.title,
          1, // WICHTIG: Hier steht jetzt 1, da es ein einzelnes Ticket ist
          qrCodeImage,
          paymentId
        ]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        console.log(`✓ Ticket ${currentTicketId} existiert bereits (Skipping).`);
        continue; 
      }
      throw err;
    }

    // Ticket zur Liste hinzufügen (für die Sammel-Email)
    generatedTickets.push({
      id: currentTicketId,
      qrCode: qrCodeImage,
      tierName: selectedTier.name
    });
  }

  // Ticket abziehen (Stock reduzieren)
  const newStock = Math.max(0, currentStock - qty);
  selectedTier.amountTickets = newStock;
  console.log(`[Ticket] Stock updated: ${currentStock} -> ${newStock} (Deducted: ${qty})`);

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

  // ⚡ REALTIME UPDATE & CACHE INVALIDATION
  try {
    // 1. Cache für Events invalidieren (damit der nächste Fetch frisch ist)
    await invalidateCache(['events:all', `events:detail:${eventId}`]);

    // 2. Push an alle Clients: "Hey, für dieses Event hat sich der Stock geändert!"
    emitEvent('ticket_update', { eventId, tierId, remaining: selectedTier.amountTickets });
    // Auch event_update senden für allgemeine Listener
    emitEvent('event_update', { id: eventId, type: 'update' });
    console.log(`📝 [Events] Stock updated for event: ${eventId}`);
  } catch (e) { console.error("Realtime update failed", e); }

  // SAMMEL-EMAIL VERSENDEN
  // Wir senden jetzt EINE Email mit ALLEN Tickets als Anhang
  const emailData = {
    email,
    firstName,
    lastName,
    address,
    zipCode,
    city,
    mobileNumber,
    tierName: selectedTier.name,
    quantity: qty,
    tickets: generatedTickets, // Das Array mit allen QR-Codes
    eventId
  };

  try {
    await sendTicketEmail(emailData, {
      name: event.title,
      date: event.date,
      time: event.time,
      location: event.location
    });
    console.log(`✓ Bulk email sent for ${qty} tickets.`);
  } catch (emailError) {
    console.error(`⚠ Bulk email failed:`, emailError.message);
  }

  console.log(`✓ All ${qty} tickets processed successfully.`);
};

/**
 * Erstellt Merch-Bestellung NACH erfolgreicher Zahlung
 */
export const createMerchOrderAfterPayment = async (metadata, paymentId, amountTotal, customerEmail, connection) => {
  const { productId, productName, size, quantity, firstName, lastName, address } = metadata;

  // Prüfen ob Bestellung bereits existiert
  const [existing] = await connection.execute(
    "SELECT orderId FROM merch_orders WHERE paymentIntentId = ?",
    [paymentId]
  );

  if (existing.length > 0) {
    console.log(`✓ Merch-Bestellung bereits erstellt für Payment ID: ${paymentId}`);
    return;
  }

  const orderId = 'ORD-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  
  // Adresse parsen und aufteilen (wie beim Ticket-System)
  let parsedAddress = {};
  try {
    parsedAddress = JSON.parse(address || '{}');
  } catch (e) {
    console.error("Fehler beim Parsen der Adresse:", e);
    parsedAddress = {};
  }

  const street = parsedAddress.street || parsedAddress.line1 || "";
  const houseNumber = parsedAddress.houseNumber || "";
  const fullAddress = houseNumber ? `${street} ${houseNumber}` : street;
  const zip = parsedAddress.postalCode || parsedAddress.postal_code || parsedAddress.zipCode || "";
  const city = parsedAddress.city || "";
  const country = parsedAddress.country || "Deutschland";

  // Produkt-Preis aus DB laden für korrekte Daten (vermeidet Shipping-Berechnungsfehler)
  const [productRows] = await connection.execute(
    'SELECT price, stock FROM merch_products WHERE id = ? FOR UPDATE',
    [productId]
  );

  const unitPrice = productRows.length > 0 ? productRows[0].price : (amountTotal / parseInt(quantity));

  const items = [{
    productId,
    productName,
    size,
    quantity: parseInt(quantity),
    price: unitPrice
  }];

  // Bestellung speichern
  await connection.execute(
    `INSERT INTO merch_orders (orderId, email, firstName, lastName, address, zipCode, city, country, items, totalAmount, paymentIntentId, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', NOW())`,
    [
      orderId,
      customerEmail || "",
      firstName || "",
      lastName || "",
      fullAddress || "",
      zip || "",
      city || "",
      country || "",
      JSON.stringify(items),
      amountTotal,
      paymentId
    ]
  );

  // Stock reduzieren
  if (productRows.length > 0) {
    let stock = {};
    try {
      stock = JSON.parse(productRows[0].stock);
    } catch (e) {
      stock = {};
    }
    stock[size] = Math.max(0, (stock[size] || 0) - parseInt(quantity));
    
    await connection.execute(
      'UPDATE merch_products SET stock = ? WHERE id = ?',
      [JSON.stringify(stock), productId]
    );

    // ⚡ REALTIME UPDATE MERCH
    try {
      // Cache invalidieren
      await invalidateCache(['merch:products', `merch:product:${productId}`]);
      
      // Push Update
      emitEvent('merch_update', { id: productId, type: 'update' });
      console.log(`📝 [Merch] Stock updated for product: ${productId} (Size: ${size})`);
    } catch (e) { console.error("Merch realtime update failed", e); }
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

    // Sicherheitscheck: Wurde der Body bereits von express.json() geparst?
    if (body && !Buffer.isBuffer(body) && typeof body !== 'string') {
      throw new Error(
        "Webhook-Fehler: Request Body ist bereits ein Objekt (geparst). " +
        "Die Webhook-Route muss express.raw() verwenden und VOR globalen Body-Parser-Middlewares registriert sein."
      );
    }

    const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    console.log(`✓ Webhook Event verifiziert: ${event.type}`);
    return event;
  } catch (error) {
    console.error("❌ Webhook-Signatur-Verifizierung fehlgeschlagen:", error.message);

    if (error.message.includes("No signatures found matching")) {
      console.error("💡 HINWEIS: Dies liegt meistens an einem falschen STRIPE_WEBHOOK_SECRET.");
      console.error("   - Lokal (Stripe CLI): Nutze das Secret, das 'stripe listen' anzeigt (startet mit 'whsec_').");
      console.error("   - Produktion: Nutze das Secret aus dem Stripe Dashboard (Entwickler > Webhooks).");
      console.error(`   - Aktuell genutztes Secret (Start): ${webhookSecret ? webhookSecret.substring(0, 10) + '...' : 'NICHT GESETZT'}`);
    }

    throw error;
  }
};