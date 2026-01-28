import express from 'express';
import { getDatabase } from '../config/database.js';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import Stripe from 'stripe';
import { protect } from './auth.js';
import redisClient from '../config/redis.js';
import { emitEvent } from '../services/socket.js';
import { rateLimit } from '../middleware/rateLimiter.js';
import { cache, invalidateCache } from '../middleware/cache.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Multer Setup (unverÃ¤ndert)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../../uploads/merch');
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
  limits: { fileSize: 100 * 1024 * 1024 },
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

// Hilfsfunktion zum sicheren Parsen von Bildern
const parseImages = (data) => {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  try {
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    // Falls es kein gÃ¼ltiges JSON ist, aber ein String (z.B. alter Pfad), geben wir es als Array zurÃ¼ck
    return typeof data === 'string' ? [data] : [];
  }
};

// Hilfsfunktion zum sicheren Parsen von JSON-Feldern (verhindert Abstürze bei ungültigem JSON)
const safeJsonParse = (data, fallback) => {
  if (!data) return fallback;
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data);
  } catch (e) {
    console.warn("⚠️ JSON Parse Warning in Merch Route:", e.message);
    return fallback;
  }
};

// CRUD Routes (unverÃ¤ndert, ausgelassen fÃ¼r KÃ¼rze)
router.get('/products', rateLimit({ windowMs: 60 * 1000, max: 60 }), cache('merch:products', 600), async (req, res) => {
  try {
    // ⚡ HTTP CACHE: 30s Browser Cache, 10min Redis Cache (Invalidation via Socket)
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=30');
    console.log('📦 [Merch] Fetching products from DB');

    const pool = getDatabase();
    const [products] = await pool.query('SELECT * FROM merch_products ORDER BY created_at DESC');
    const parsedProducts = products.map(p => ({
      ...p,
      images: parseImages(p.images),
      sizes: safeJsonParse(p.sizes, []),
      stock: safeJsonParse(p.stock, {}),
      price: typeof p.price === 'string' ? parseFloat(p.price) : p.price
    }));

    res.json(parsedProducts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/products/:id', rateLimit({ windowMs: 60 * 1000, max: 60 }), cache((req) => `merch:product:${req.params.id}`, 600), async (req, res) => {
  try {
    const pool = getDatabase();
    const [products] = await pool.query('SELECT * FROM merch_products WHERE id = ?', [req.params.id]);
    if (products.length === 0) return res.status(404).json({ message: 'Produkt nicht gefunden' });
    const p = products[0];
    const parsedProduct = {
      ...p,
      images: parseImages(p.images),
      sizes: safeJsonParse(p.sizes, []),
      stock: safeJsonParse(p.stock, {}),
      price: typeof p.price === 'string' ? parseFloat(p.price) : p.price
    };

    res.json(parsedProduct);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/products', protect, upload.array('images', 10), async (req, res) => {
  try {
    const pool = getDatabase();
    const { name, description, price, category, sizes, stock, isActive, images: bodyImages } = req.body;

    let finalImages = [];
    
    // 1. Dateien die direkt hochgeladen wurden (Fallback)
    if (req.files && req.files.length > 0) {
      const uploadedFiles = req.files.map(f => `/uploads/merch/${f.filename}`);
      finalImages = [...finalImages, ...uploadedFiles];
    }

    // 2. Bild-URLs die vom Upload-System kommen (JSON Body)
    if (bodyImages) {
      if (typeof bodyImages === 'string') {
        try {
          // Versuchen JSON zu parsen (falls Array als String kommt)
          const parsed = JSON.parse(bodyImages);
          if (Array.isArray(parsed)) finalImages = [...finalImages, ...parsed];
          else finalImages.push(bodyImages);
        } catch(e) {
          // Ist wohl eine einzelne URL
          finalImages.push(bodyImages);
        }
      } else if (Array.isArray(bodyImages)) {
        finalImages = [...finalImages, ...bodyImages];
      }
    }

    const sizesJson = typeof sizes === 'string' ? sizes : JSON.stringify(sizes);
    const stockJson = typeof stock === 'string' ? stock : JSON.stringify(stock);
    const imagesJson = JSON.stringify(finalImages);

    const [result] = await pool.query(
      `INSERT INTO merch_products (name, description, price, category, images, sizes, stock, isActive) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, description, price, category, imagesJson, sizesJson, stockJson, isActive === undefined || isActive === 'true' || isActive === true ? 1 : 0]
    );

    // âš¡ CACHE INVALIDATION
    await invalidateCache('merch:products');
    emitEvent('merch_update', { type: 'create' });
    console.log(`✨ [Merch] Created new product: ${name} (ID: ${result.insertId})`);

    res.status(201).json({ id: result.insertId, message: 'Produkt erstellt', images: finalImages });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Produkts' });
  }
});

router.put('/products/:id', protect, upload.array('images', 10), async (req, res) => {
  try {
    const pool = getDatabase();
    const { name, description, price, category, sizes, stock, isActive, images: bodyImages } = req.body;
    const { id } = req.params;

    let finalImages = [];
    
    if (req.files && req.files.length > 0) {
      const uploadedFiles = req.files.map(f => `/uploads/merch/${f.filename}`);
      finalImages = [...finalImages, ...uploadedFiles];
    }

    if (bodyImages) {
      if (typeof bodyImages === 'string') {
        try {
          const parsed = JSON.parse(bodyImages);
          if (Array.isArray(parsed)) finalImages = [...finalImages, ...parsed];
          else finalImages.push(bodyImages);
        } catch(e) {
          finalImages.push(bodyImages);
        }
      } else if (Array.isArray(bodyImages)) {
        finalImages = [...finalImages, ...bodyImages];
      }
    }

    const sizesJson = typeof sizes === 'string' ? sizes : JSON.stringify(sizes);
    const stockJson = typeof stock === 'string' ? stock : JSON.stringify(stock);
    const imagesJson = JSON.stringify(finalImages);

    await pool.query(
      `UPDATE merch_products SET name=?, description=?, price=?, category=?, images=?, sizes=?, stock=?, isActive=? WHERE id=?`,
      [name, description, price, category, imagesJson, sizesJson, stockJson, isActive === 'true' || isActive === true ? 1 : 0, id]
    );

    // âš¡ CACHE INVALIDATION
    await invalidateCache(['merch:products', `merch:product:${id}`]);
    emitEvent('merch_update', { id, type: 'update' }); // Signalisiert Clients, neu zu laden
    console.log(`📝 [Merch] Updated product: ${id}`);

    res.json({ message: 'Produkt aktualisiert', images: finalImages });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Produkts' });
  }
});

router.delete('/products/:id', protect, async (req, res) => {
  try {
    const pool = getDatabase();
    await pool.query('DELETE FROM merch_products WHERE id = ?', [req.params.id]);
    
    // âš¡ CACHE INVALIDATION
    await invalidateCache(['merch:products', `merch:product:${req.params.id}`]);
    emitEvent('merch_update', { id: req.params.id, type: 'delete' });
    console.log(`🗑️ [Merch] Deleted product: ${req.params.id}`);

    res.json({ message: 'Produkt gelÃ¶scht' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/upload', protect, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Kein Bild hochgeladen' });
  res.json({ url: `/uploads/merch/${req.file.filename}` });
});

// SICHERE CHECKOUT SESSION (keine Bestellung erstellen)
// ðŸ›¡ï¸ SECURITY: Strenges Rate Limiting fÃ¼r Checkout (10 Versuche pro 15 Min)
// Verhindert Stripe-API-Kosten und DB-Spam
router.post('/create-checkout-session', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'checkout' }), async (req, res) => {
  try {
    const { productId, productName, size, quantity, price, email, firstName, lastName, address, zipCode, city, mobileNumber, successUrl, cancelUrl } = req.body;
    
    // Validierung
    if (!productId || !size || !quantity || !email || !firstName || !lastName) {
      return res.status(400).json({ error: 'Fehlende erforderliche Felder' });
    }

    // Produkt und VerfÃ¼gbarkeit prÃ¼fen
    const pool = getDatabase();
    const [products] = await pool.query(
      'SELECT * FROM merch_products WHERE id = ?',
      [productId]
    );

    if (products.length === 0) {
      return res.status(404).json({ error: 'Produkt nicht gefunden' });
    }

    if (!products[0].isActive) {
      return res.status(400).json({ error: 'Produkt ist derzeit nicht verfÃ¼gbar (inaktiv)' });
    }

    const product = products[0];
    
    // Sicherer Stock-Parse (verhindert Crash bei null/invalid JSON)
    let stock = {};
    try {
      stock = typeof product.stock === 'string' ? JSON.parse(product.stock) : (product.stock || {});
    } catch (e) {
      stock = {};
    }

    if (!stock || !stock[size] || stock[size] < quantity) {
      return res.status(400).json({ 
        error: `Nicht genÃ¼gend Artikel in GrÃ¶ÃŸe ${size} verfÃ¼gbar. Nur noch ${stock?.[size] || 0} auf Lager.` 
      });
    }

    // Adresse fÃ¼r Metadata vorbereiten (analog zu Tickets)
    let addressData = address;
    if (typeof address === 'string') {
      addressData = {
        street: address,
        zipCode: zipCode,
        city: city
      };
    }

    // Bilder fÃ¼r Stripe vorbereiten (mÃ¼ssen absolute URLs sein)
    let stripeImages = [];
    try {
      const rawImages = typeof product.images === 'string' ? JSON.parse(product.images) : (product.images || []);
      if (Array.isArray(rawImages) && rawImages.length > 0) {
        const baseUrl = 'https://api.virus-event.de'; // Backend URL fÃ¼r Uploads
        stripeImages = rawImages.slice(0, 1).map(img => img.startsWith('http') ? img : `${baseUrl}${img.startsWith('/') ? '' : '/'}${img}`);
      }
    } catch (e) {
      console.warn('Fehler beim Parsen der Bilder fÃ¼r Stripe:', e);
    }

    // URL bereinigen: Verhindert doppelte session_id Parameter
    const finalSuccessUrl = successUrl.includes('session_id={CHECKOUT_SESSION_ID}')
      ? successUrl
      : `${successUrl}${successUrl.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`;

    // Stripe Session erstellen (OHNE Bestellung zu speichern)
    const session = await stripe.checkout.sessions.create({
      billing_address_collection: 'required',
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `${productName} - GrÃ¶ÃŸe ${size}`,
            description: `Menge: ${quantity}`,
            images: stripeImages,
          },
          unit_amount: Math.round(parseFloat(price) * 100), // In Cents
        },
        quantity: parseInt(quantity),
      }],
      mode: 'payment',
      success_url: finalSuccessUrl,
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
        email,
        address: JSON.stringify(addressData),
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