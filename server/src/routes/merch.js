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
  limits: { fileSize: 5 * 1024 * 1024 },
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

router.get('/products', async (req, res) => {
  try {
    const pool = getDatabase();
    const [products] = await pool.query(
      'SELECT * FROM merch_products WHERE isActive = true ORDER BY created_at DESC'
    );
    
    const productsWithParsedJSON = products.map(product => ({
      ...product,
      images: JSON.parse(product.images),
      sizes: JSON.parse(product.sizes),
      stock: JSON.parse(product.stock)
    }));
    
    res.json(productsWithParsedJSON);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Produkte' });
  }
});

router.get('/products/:id', async (req, res) => {
  try {
    const pool = getDatabase();
    const [products] = await pool.query(
      'SELECT * FROM merch_products WHERE id = ? AND isActive = true',
      [req.params.id]
    );
    
    if (products.length === 0) {
      return res.status(404).json({ error: 'Produkt nicht gefunden' });
    }
    
    const product = {
      ...products[0],
      images: JSON.parse(products[0].images),
      sizes: JSON.parse(products[0].sizes),
      stock: JSON.parse(products[0].stock)
    };
    
    res.json(product);
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ error: 'Fehler beim Laden des Produkts' });
  }
});

router.post('/products', upload.array('images', 10), async (req, res) => {
  try {
    const { name, description, price, category, sizes, stock } = req.body;
    
    if (!name || !price || !category) {
      return res.status(400).json({ error: 'Name, Preis und Kategorie sind erforderlich' });
    }
    
    const images = req.files.map(file => `/uploads/${file.filename}`);
    
    const pool = getDatabase();
    const [result] = await pool.query(
      `INSERT INTO merch_products (name, description, price, category, images, sizes, stock, isActive) 
       VALUES (?, ?, ?, ?, ?, ?, ?, true)`,
      [
        name,
        description || '',
        parseFloat(price),
        category,
        JSON.stringify(images),
        sizes || JSON.stringify([]),
        stock || JSON.stringify({})
      ]
    );
    
    const [newProduct] = await pool.query('SELECT * FROM merch_products WHERE id = ?', [result.insertId]);
    
    const product = {
      ...newProduct[0],
      images: JSON.parse(newProduct[0].images),
      sizes: JSON.parse(newProduct[0].sizes),
      stock: JSON.parse(newProduct[0].stock)
    };
    
    res.status(201).json(product);
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Produkts' });
  }
});

router.put('/products/:id', upload.array('images', 10), async (req, res) => {
  try {
    const { name, description, price, category, sizes, stock, existingImages } = req.body;
    
    let images = existingImages ? JSON.parse(existingImages) : [];
    
    if (req.files && req.files.length > 0) {
      const newImages = req.files.map(file => `/uploads/${file.filename}`);
      images = [...images, ...newImages];
    }
    
    const pool = getDatabase();
    await pool.query(
      `UPDATE merch_products 
       SET name = ?, description = ?, price = ?, category = ?, images = ?, sizes = ?, stock = ? 
       WHERE id = ?`,
      [
        name,
        description || '',
        parseFloat(price),
        category,
        JSON.stringify(images),
        sizes || JSON.stringify([]),
        stock || JSON.stringify({}),
        req.params.id
      ]
    );
    
    const [updatedProduct] = await pool.query('SELECT * FROM merch_products WHERE id = ?', [req.params.id]);
    
    const product = {
      ...updatedProduct[0],
      images: JSON.parse(updatedProduct[0].images),
      sizes: JSON.parse(updatedProduct[0].sizes),
      stock: JSON.parse(updatedProduct[0].stock)
    };
    
    res.json(product);
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Produkts' });
  }
});

router.delete('/products/:id', async (req, res) => {
  try {
    const pool = getDatabase();
    await pool.query('UPDATE merch_products SET isActive = false WHERE id = ?', [req.params.id]);
    res.json({ message: 'Produkt gelöscht' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ error: 'Fehler beim Löschen des Produkts' });
  }
});

router.post('/upload', upload.array('images', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Keine Bilder hochgeladen' });
    }
    
    const imagePaths = req.files.map(file => `/uploads/${file.filename}`);
    res.json({ images: imagePaths });
  } catch (error) {
    console.error('Error uploading images:', error);
    res.status(500).json({ error: 'Fehler beim Hochladen der Bilder' });
  }
});

router.post('/orders', async (req, res) => {
  try {
    const { email, firstName, lastName, address, items, totalAmount, paymentIntentId } = req.body;
    
    const orderId = 'ORD-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    
    const pool = getDatabase();
    await pool.query(
      `INSERT INTO merch_orders (orderId, email, firstName, lastName, address, items, totalAmount, paymentIntentId, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
      [
        orderId,
        email,
        firstName,
        lastName,
        JSON.stringify(address),
        JSON.stringify(items),
        totalAmount,
        paymentIntentId
      ]
    );
    
    for (const item of items) {
      const [product] = await pool.query('SELECT stock FROM merch_products WHERE id = ?', [item.productId]);
      if (product.length > 0) {
        const stock = JSON.parse(product[0].stock);
        stock[item.size] = Math.max(0, (stock[item.size] || 0) - item.quantity);
        await pool.query('UPDATE merch_products SET stock = ? WHERE id = ?', [JSON.stringify(stock), item.productId]);
      }
    }
    
    res.status(201).json({ orderId, message: 'Bestellung erfolgreich' });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen der Bestellung' });
  }
});

router.post('/create-checkout-session', async (req, res) => {
  try {
    const { productId, productName, size, quantity, price, email, firstName, lastName, address, successUrl, cancelUrl } = req.body;
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'paypal'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: `${productName} - Größe ${size}`,
              description: `Menge: ${quantity}`,
            },
            unit_amount: Math.round(price * 100),
          },
          quantity: quantity,
        },
      ],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: email,
      metadata: {
        productId,
        productName,
        size,
        quantity: quantity.toString(),
        firstName,
        lastName,
        address: JSON.stringify(address),
        price: price.toString()
      }
    });

    res.json({ sessionId: session.id });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen der Checkout-Session' });
  }
});

router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    
    try {
      const pool = getDatabase();
      const orderId = 'ORD-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
      
      const items = [{
        productId: session.metadata.productId,
        productName: session.metadata.productName,
        size: session.metadata.size,
        quantity: parseInt(session.metadata.quantity),
        price: parseFloat(session.metadata.price)
      }];
      
      await pool.query(
        `INSERT INTO merch_orders (orderId, email, firstName, lastName, address, items, totalAmount, paymentIntentId, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
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
      
      const [product] = await pool.query('SELECT stock FROM merch_products WHERE id = ?', [session.metadata.productId]);
      if (product.length > 0) {
        const stock = JSON.parse(product[0].stock);
        stock[session.metadata.size] = Math.max(0, (stock[session.metadata.size] || 0) - parseInt(session.metadata.quantity));
        await pool.query('UPDATE merch_products SET stock = ? WHERE id = ?', [JSON.stringify(stock), session.metadata.productId]);
      }
      
      console.log('✓ Merch order created:', orderId);
    } catch (error) {
      console.error('Error creating merch order:', error);
    }
  }

  res.json({ received: true });
});

router.get('/orders', async (req, res) => {
  try {
    const pool = getDatabase();
    const [orders] = await pool.query('SELECT * FROM merch_orders ORDER BY created_at DESC');
    
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
