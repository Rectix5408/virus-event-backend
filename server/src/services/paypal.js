import fetch from 'node-fetch';
import { getDatabase } from '../config/database.js';
import { createTicketAfterPayment, createMerchOrderAfterPayment } from './stripe.js';

const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_API_URL } = process.env;

const base = PAYPAL_API_URL || 'https://api-m.sandbox.paypal.com';

/**
 * Generiert einen Access Token für die PayPal API
 */
const generateAccessToken = async () => {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error("MISSING_PAYPAL_CREDENTIALS");
  }
  const auth = Buffer.from(PAYPAL_CLIENT_ID + ":" + PAYPAL_CLIENT_SECRET).toString("base64");
  const response = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    body: "grant_type=client_credentials",
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });
  const data = await response.json();
  return data.access_token;
};

/**
 * Erstellt eine PayPal Order
 */
export const createPayPalOrder = async (amount, currency = 'EUR') => {
  const accessToken = await generateAccessToken();
  const url = `${base}/v2/checkout/orders`;
  
  const payload = {
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: {
          currency_code: currency,
          value: amount.toFixed(2),
        },
      },
    ],
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  return response.json();
};

/**
 * Fängt eine PayPal Order ein (Capture) und erstellt das Ticket/Order
 */
export const capturePayPalOrder = async (orderID, metadata) => {
  const accessToken = await generateAccessToken();
  const url = `${base}/v2/checkout/orders/${orderID}/capture`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();

  if (data.status === 'COMPLETED') {
    // Zahlung erfolgreich, Ticket/Order erstellen
    const db = getDatabase();
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();
      
      const amountTotal = parseFloat(data.purchase_units[0].payments.captures[0].amount.value);
      const payerEmail = data.payer.email_address;

      if (metadata.type === "ticket") {
        await createTicketAfterPayment(metadata, orderID, amountTotal, connection);
      } else if (metadata.type === "merch") {
        await createMerchOrderAfterPayment(metadata, orderID, amountTotal, payerEmail, connection);
      }

      await connection.commit();
      return { success: true, orderID };
    } catch (error) {
      await connection.rollback();
      console.error("Fehler bei PayPal Capture DB Update:", error);
      throw error;
    } finally {
      connection.release();
    }
  }
  
  return { success: false, details: data };
};