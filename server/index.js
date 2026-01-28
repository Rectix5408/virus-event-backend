import "dotenv/config"; // <--- MUSS GANZ OBEN STEHEN
import express from "express";
import http from "http";
import cors from "cors";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import apiRoutes from "./src/routes/api.js";
import eventsRouter from "./src/routes/events.js";
import authRouter from "./src/routes/auth.js";
import newsletterRouter from './src/routes/newsletter.js';
import merchRouter from './src/routes/merch.js';
import uploadRouter from './src/routes/upload.js';
import paymentRoutes from './src/routes/payment.js';
import webhookRouter from './src/routes/webhook.js';
import adminRoutes from './src/routes/admin.js';
import adminNewsletterRoutes from './src/routes/adminNewsletter.js';
import adminTicketsRoutes from './src/routes/adminTickets.js';
import { startNewsletterWorker } from "./src/services/newsletterQueue.js";
import { verifyEmailService } from "./src/services/email.js";
import { initializeDatabase, createTables, getDatabase } from "./src/config/database.js";
import { initSocket } from "./src/services/socket.js";
import { rateLimit } from "./src/middleware/rateLimiter.js";


// Pfad Setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// Proxy-Einstellungen für Rate-Limiting und korrekte IP-Erkennung (wichtig für Nginx/Plesk)
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3001;

// Erlaubte Origins
const allowedOrigins = [
  "https://www.virus-event.de",
  "https://virus-event.de",
  "http://localhost:5173",
  "http://localhost:8080",
];

// CORS Konfiguration
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.warn(`⚠️ CORS Blocked Origin: ${origin}`);
    return callback(new Error(`CORS: Origin ${origin} not allowed`), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
};

// CORS Middleware
app.use(cors(corsOptions));
// Pre-Flight Requests für alle Routen erlauben
app.options('*', cors(corsOptions));

// Webhook routes BEFORE body parser (need raw body)
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use('/api/webhooks/paypal', express.raw({ type: 'application/json' }));

// Body Parser
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Middleware: Datum-Format für MySQL fixen (ISO String -> YYYY-MM-DD)
app.use((req, res, next) => {
  if (req.body) {
    // 1. Vorhandenes dateISO bereinigen
    if (req.body.dateISO && typeof req.body.dateISO === 'string') {
      if (req.body.dateISO.includes('T')) {
        req.body.dateISO = req.body.dateISO.split('T')[0];
      }
    }
    // 2. Fallback: dateISO aus deutschem Datum generieren (z.B. "01. MAI 2026")
    else if (!req.body.dateISO && req.body.date && typeof req.body.date === 'string') {
      const months = {
        'JANUAR': '01', 'FEBRUAR': '02', 'MÄRZ': '03', 'APRIL': '04', 'MAI': '05', 'JUNI': '06',
        'JULI': '07', 'AUGUST': '08', 'SEPTEMBER': '09', 'OKTOBER': '10', 'NOVEMBER': '11', 'DEZEMBER': '12',
        'JAN': '01', 'FEB': '02', 'MRZ': '03', 'APR': '04', 'JUN': '06', 'JUL': '07', 'AUG': '08', 'SEP': '09', 'OKT': '10', 'NOV': '11', 'DEZ': '12'
      };
      const parts = req.body.date.trim().toUpperCase().split(' ');
      if (parts.length >= 3) {
        const day = parts[0].replace('.', '').padStart(2, '0');
        const month = months[parts[1]] || '01';
        const year = parts[2];
        req.body.dateISO = `${year}-${month}-${day}`;
      }
    }
  }
  next();
});

// Uploads öffentlich
app.use("/uploads", express.static(path.join(__dirname, "uploads"), {
  maxAge: '1d', // Bilder für 1 Tag im Browser cachen
  etag: true,   // Verhindert erneutes Laden, wenn sich nichts geändert hat
  immutable: false
}));

// Health Check
const healthCheck = async (req, res) => {
  let dbStatus = "disconnected";
  try {
    const pool = getDatabase();
    if (pool) {
      // Timeout für DB Check um hängende Requests zu vermeiden (max 1 Sekunde)
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 1000));
      await Promise.race([pool.query("SELECT 1"), timeout]);
      dbStatus = "connected";
    }
  } catch (err) {
    dbStatus = "error: " + err.message;
  }
  res.json({ status: "ok", database: dbStatus, timestamp: new Date().toISOString() });
};

app.get("/health", healthCheck);
app.get("/api/health", healthCheck);

// Root Route für einfachen Erreichbarkeitstest
app.get("/api", (req, res) => {
  res.send("VIRUS EVENT API is running 🚀");
});

// 🛡️ SECURITY: Globales Rate Limiting
// Erlaubt 300 Requests pro 1 Minute pro IP (genug für normale Nutzung, blockt Angriffe)
app.use("/api", rateLimit({ windowMs: 60 * 1000, max: 300, keyPrefix: 'global' }));

// Cache-Control Optimierung
app.use("/api", (req, res, next) => {
  // Für GET Requests erlauben wir kurzes Caching (10s), um F5-Spam auf DB zu reduzieren
  if (req.method === 'GET') {
    res.set('Cache-Control', 'public, max-age=10, must-revalidate');
  } else {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
  next();
});

// API Routes
app.use("/api", apiRoutes);
app.use("/api/events", eventsRouter);
app.use("/api/auth", authRouter);
app.use('/api/newsletter', newsletterRouter);
app.use('/api/merch', merchRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/payment', paymentRoutes);
app.use('/api/webhooks/stripe', webhookRouter);
app.use('/api/admin', adminRoutes); 
app.use('/api/admin/newsletter', adminNewsletterRoutes);
app.use('/api/admin/tickets', adminTicketsRoutes);

// --- Frontend Build Integration ---
const frontendDist = path.join(__dirname, "../../virus-event-frontend/dist");

if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(frontendDist, "index.html"));
  });
  console.log(`📂 Serving frontend from: ${frontendDist}`);
}

// Error Handling
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({
    message: "Internal server error",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// Global Error Handlers for Debugging
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
  console.error(err.name, err.message, err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION! 💥 Shutting down...');
  console.error(err);
  process.exit(1);
});

// Helper für Datenbank-Migrationen (Spalten hinzufügen falls sie fehlen)
const runMigrations = async () => {
  try {
    const db = getDatabase();
    if (!db) return;
    const connection = await db.getConnection();
    try {
      console.log("🔄 Checking database schema for missing columns...");
      
      // Prüfen ob 'address' Spalte in 'tickets' existiert
      const [ticketColumns] = await connection.execute("SHOW COLUMNS FROM tickets LIKE 'address'");
      
      if (ticketColumns.length === 0) {
        console.log("⚠️ Missing columns detected in 'tickets'. Running migration...");
        await connection.execute(`
          ALTER TABLE tickets
          ADD COLUMN address VARCHAR(255) AFTER lastName,
          ADD COLUMN zipCode VARCHAR(20) AFTER address,
          ADD COLUMN city VARCHAR(100) AFTER zipCode,
          ADD COLUMN mobileNumber VARCHAR(50) AFTER city
        `);
        console.log("✅ Schema migration successful: Added address fields to tickets table.");
      }

      // Prüfen ob 'eventTitle' Spalte in 'tickets' existiert (für bessere Sortierung im Admin Dashboard)
      const [ticketTitleCol] = await connection.execute("SHOW COLUMNS FROM tickets LIKE 'eventTitle'");
      
      if (ticketTitleCol.length === 0) {
        console.log("⚠️ Missing column 'eventTitle' in 'tickets'. Running migration...");
        await connection.execute(`
          ALTER TABLE tickets
          ADD COLUMN eventTitle VARCHAR(255) AFTER eventId
        `);
        
        // Bestehende Tickets aktualisieren (Daten aus Events-Tabelle holen)
        console.log("🔄 Populating eventTitle for existing tickets...");
        await connection.execute(`
          UPDATE tickets t
          INNER JOIN events e ON t.eventId = e.id
          SET t.eventTitle = e.title
        `);
        
        console.log("✅ Schema migration successful: Added eventTitle to tickets table.");
      }

      // Prüfen ob 'zipCode' Spalte in 'merch_orders' existiert
      const [merchColumns] = await connection.execute("SHOW COLUMNS FROM merch_orders LIKE 'zipCode'");
      
      if (merchColumns.length === 0) {
        console.log("⚠️ Missing columns detected in 'merch_orders'. Running migration...");
        await connection.execute(`
          ALTER TABLE merch_orders
          ADD COLUMN zipCode VARCHAR(20) AFTER address,
          ADD COLUMN city VARCHAR(100) AFTER zipCode,
          ADD COLUMN country VARCHAR(100) AFTER city
        `);
        console.log("✅ Schema migration successful: Added address fields to merch_orders table.");
      }

      // Prüfen ob 'firstName' Spalte in 'newsletter_subscribers' existiert
      const [subColumns] = await connection.execute("SHOW COLUMNS FROM newsletter_subscribers LIKE 'firstName'");
      
      if (subColumns.length === 0) {
        console.log("⚠️ Missing columns detected in 'newsletter_subscribers'. Running migration...");
        await connection.execute(`
          ALTER TABLE newsletter_subscribers
          ADD COLUMN firstName VARCHAR(100) AFTER email,
          ADD COLUMN confirmationToken VARCHAR(100) AFTER is_subscribed,
          ADD COLUMN unsubscribeToken VARCHAR(100) AFTER confirmationToken,
          ADD COLUMN ipAddress VARCHAR(45) AFTER unsubscribeToken
        `);
        console.log("✅ Schema migration successful: Added fields to newsletter_subscribers table.");
      }

      console.log("✅ Database schema check complete.");
    } catch (err) {
      console.error("❌ Migration failed:", err.message);
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error("❌ Migration check failed:", err.message);
  }
};

// Server Start
const startServer = async () => {
  try {
    console.log("🔄 Initializing database...");
    
    // Timeout für DB-Verbindung hinzufügen (max 5 Sekunden warten), damit der Server nicht ewig hängt
    const dbPromise = initializeDatabase();
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(false), 5000));
    const dbConnected = await Promise.race([dbPromise, timeoutPromise]).catch(err => { console.error(err); return false; });

    if (!dbConnected) {
      console.warn("⚠ Database connection failed or timed out. Offline mode enabled.");
    } else {
      console.log("🔄 Creating tables...");
      // Fehler beim Tabellenerstellen abfangen, damit Server trotzdem startet
      await createTables().catch(err => console.error("⚠ Failed to create tables:", err.message));
      
      // Migrationen ausführen
      await runMigrations();
    }

    const emailReady = await verifyEmailService().catch(() => false);
    if (!emailReady) console.warn("⚠ Email service not ready. Emails disabled.");

    const server = http.createServer(app);
    initSocket(server, allowedOrigins);

    server.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`✓ CORS enabled for: ${allowedOrigins.join(", ")}`);
      
      // Start Newsletter Worker
      startNewsletterWorker();
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();