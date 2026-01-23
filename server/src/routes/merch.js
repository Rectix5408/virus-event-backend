import express from 'express';
import { getDatabase } from '../config/database.js';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Multer Setup (unverändert)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'merch-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Nur Bilder sind erlaubt (jpeg, jpg, png, webp)'));
    }
  }
});

// CRUD Routes (unverändert, ausgelassen für Kürze)
router.get('/products', async (req, res) => { /* ... existing code ... */ });
router.get('/products/:id', async (req, res) => { /* ... existing code ... */ });
router.post('/products', upload.array('images', 10), async (req, res) => { /* ... existing code ... */ });
router.put('/products/:id', upload.array('images', 10), async (req, res) => { /* ... existing code ... */ });
router.delete('/products/:id', async (req, res) => { /* ... existing code ... */ });
router.post('/upload', upload.single('image'), async (req, res) => { /* ... existing code ... */ });

// SICHERE CHECKOUT SESSION (keine Bestellung erstellen)
router.post('/create-checkout-session', async (req, res) => {
  try {
    const { productId, productName, size, quantity, price, email, firstName, lastName, address, successUrl, cancelUrl } = req.body;
    
    // Validierung
    if (!productId || !size || !quantity || !email || !firstName || !lastName) {
      return res.status(400).json({ error: 'Fehlende erforderliche Felder' });
    }

    // Produkt und Verfügbarkeit prüfen
    const pool = getDatabase();
    const [products] = await pool.query(
      'SELECT * FROM merch_products WHERE id = ? AND isActive = true',
      [productId]
    );

    if (products.length === 0) {
      return res.status(404).json({ error: 'Produkt nicht gefunden' });
    }

    const product = products[0];
    const stock = JSON.parse(product.stock);

    if (!stock[size] || stock[size] < quantity) {
      return res.status(400).json({ 
        error: `Nicht genügend Artikel in Größe ${size} verfügbar. Nur noch ${stock[size] || 0} auf Lager.` 
      });
    }

    // Stripe Session erstellen (OHNE Bestellung zu speichern)
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `${productName} - Größe ${size}`,
            description: `Menge: ${quantity}`,
            images: product.images ? JSON.parse(product.images).slice(0, 1) : [],
          },
          unit_amount: Math.round(parseFloat(price) * 100), // In Cents
        },
        quantity: parseInt(quantity),
      }],
      mode: 'payment',
      success_url: `${successUrl}${successUrl.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      customer_email: email,
      metadata: {
        type: 'merch',
        productId: productId.toString(),
        productName,
        size,
        quantity: quantity.toString(),
        firstName,
        lastName,
        address: JSON.stringify(address),
        price: price.toString()
      },
      expires_at: Math.floor(Date.now() / 1000) + 1800, // 30 Minuten
      payment_intent_data: {
        metadata: {
          type: 'merch',
          productId: productId.toString(),
        }
      }
    });

    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('Fehler beim Erstellen der Checkout-Session:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen der Checkout-Session' });
  }
});

// WEBHOOK - Bestellung wird HIER erstellt nach erfolgreicher Zahlung
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Webhook verifizieren
    event = stripe.webhooks.constructEvent(
      req.body, 
      sig, 
      process.env.STRIPE_WEBHOOK_SECRET_MERCH
    );
  } catch (err) {
    console.error('❌ Webhook-Signatur-Verifizierung fehlgeschlagen:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Event verarbeiten
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      
      // Nur Merch-Bestellungen verarbeiten
      if (session.metadata.type !== 'merch') {
        return res.json({ received: true });
      }

      const pool = getDatabase();
      const connection = await pool.getConnection();

      try {
        await connection.beginTransaction();

        // Duplikat-Prüfung
        const [existing] = await connection.query(
          'SELECT orderId FROM merch_orders WHERE paymentIntentId = ?',
          [session.payment_intent]
        );

        if (existing.length > 0) {
          console.log(`✓ Merch-Bestellung bereits erstellt: ${existing[0].orderId}`);
          await connection.commit();
          return res.json({ received: true });
        }

        // Bestellung erstellen
        const orderId = 'ORD-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        const items = [{
          productId: session.metadata.productId,
          productName: session.metadata.productName,
          size: session.metadata.size,
          quantity: parseInt(session.metadata.quantity),
          price: parseFloat(session.metadata.price)
        }];

        await connection.query(
          `INSERT INTO merch_orders (orderId, email, firstName, lastName, address, items, totalAmount, paymentIntentId, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', NOW())`,
          [
            orderId,
            session.customer_email,
            session.metadata.firstName,
            session.metadata.lastName,
            session.metadata.address,
            JSON.stringify(items),
            session.amount_total / 100,
            session.payment_intent
          ]
        );

        // Stock reduzieren
        const [product] = await connection.query(
          'SELECT stock FROM merch_products WHERE id = ?',
          [session.metadata.productId]
        );

        if (product.length > 0) {
          const stock = JSON.parse(product[0].stock);
          stock[session.metadata.size] = Math.max(
            0, 
            (stock[session.metadata.size] || 0) - parseInt(session.metadata.quantity)
          );
          
          await connection.query(
            'UPDATE merch_products SET stock = ? WHERE id = ?',
            [JSON.stringify(stock), session.metadata.productId]
          );
        }

        await connection.commit();
        console.log(`✓ Merch-Bestellung ${orderId} erfolgreich erstellt`);

        // Optional: Email versenden
        // await sendMerchOrderEmail(session.customer_email, orderId, items);

      } catch (error) {
        await connection.rollback();
        console.error('Fehler beim Erstellen der Merch-Bestellung:', error);
        throw error;
      } finally {
        connection.release();
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Fehler beim Verarbeiten des Webhooks:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Orders abrufen
router.get('/orders', async (req, res) => {
  try {
    const pool = getDatabase();
    const [orders] = await pool.query(
      'SELECT * FROM merch_orders ORDER BY created_at DESC'
    );
    
    const ordersWithParsedJSON = orders.map(order => ({
      ...order,
      address: JSON.parse(order.address),
      items: JSON.parse(order.items)
    }));
    
    res.json(ordersWithParsedJSON);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Bestellungen' });
  }
});

export default router;