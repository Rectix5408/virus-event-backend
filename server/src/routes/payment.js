import express from 'express';
import { createPayPalOrder, capturePayPalOrder } from '../services/paypal.js';
import { getDatabase } from '../config/database.js';
import { generateTicketId } from '../utils/helpers.js';

const router = express.Router();

// PayPal Order erstellen
router.post('/paypal/create-order', async (req, res) => {
  try {
    const { tierId, quantity, eventId, type, productId, size } = req.body;
    
    // Preis serverseitig berechnen (Sicherheit!)
    const db = getDatabase();
    let price = 0;

    if (type === 'ticket') {
      const [rows] = await db.query("SELECT ticketTiers FROM events WHERE id = ?", [eventId]);
      if (!rows.length) throw new Error("Event nicht gefunden");
      
      let tiers = rows[0].ticketTiers;
      if (typeof tiers === 'string') tiers = JSON.parse(tiers);

      const tier = tiers.find(t => t.id === tierId);
      if (!tier) throw new Error("Ticketart nicht gefunden");
      price = tier.price * quantity;
    } else if (type === 'merch') {
      const [rows] = await db.query("SELECT price FROM merch_products WHERE id = ?", [productId]);
      if (!rows.length) throw new Error("Produkt nicht gefunden");
      price = rows[0].price * quantity;
    }

    const order = await createPayPalOrder(price);
    res.json(order);
  } catch (error) {
    console.error("PayPal Create Order Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// PayPal Order capturen (abschließen)
router.post('/paypal/capture-order', async (req, res) => {
  try {
    const { orderID, metadata } = req.body;
    
    // Ticket-ID generieren, falls noch nicht vorhanden
    if (metadata.type === 'ticket' && !metadata.ticketId) {
      metadata.ticketId = generateTicketId();
    }

    const result = await capturePayPalOrder(orderID, metadata);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json({ error: "Zahlung konnte nicht abgeschlossen werden", details: result.details });
    }
  } catch (error) {
    console.error("PayPal Capture Error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;