import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import apiRoutes from "./src/routes/api.js";
import eventsRouter from "./src/routes/events.js";
import authRouter from "./src/routes/auth.js";
import newsletterRouter from './src/routes/newsletter.js';
import { verifyEmailService } from "./src/services/email.js";
import { initializeDatabase, createTables, getDatabase } from "./src/config/database.js";

dotenv.config();

// Setup für Pfade in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Upload Ordner erstellen, falls nicht vorhanden
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const app = express();
const PORT = process.env.PORT || 3001;
const allowedOrigins = [
  "https://www.virus-event.de",
  "https://virus-event.de",
];

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true,
}));

// Body parser middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Bilder öffentlich verfügbar machen
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Health check endpoint
app.get("/health", async (req, res) => {
  let dbStatus = "disconnected";
  try {
    const pool = getDatabase();
    if (pool) {
      await pool.query("SELECT 1");
      dbStatus = "connected";
    }
  } catch (error) {
    dbStatus = "error: " + error.message;
  }
  res.json({ status: "ok", database: dbStatus, timestamp: new Date().toISOString() });
});

// API routes
app.use("/api", apiRoutes);
app.use("/api/events", eventsRouter);
app.use("/api/auth", authRouter);
app.use('/api/newsletter', newsletterRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({
    message: "Internal server error",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// Start server
const startServer = async () => {
  try {
    // Initialize database
    console.log("🔄 Initializing database...");
    const dbConnected = await initializeDatabase();

    if (!dbConnected) {
      console.warn("⚠ Database connection failed. Running in offline mode.");
      console.warn("  Tickets will NOT be saved to database.");
    } else {
      // Create tables
      console.log("🔄 Creating tables...");
      await createTables();
    }

    // Verify email service (optional - don't block on error)
    const emailReady = await verifyEmailService().catch(() => false);
    if (!emailReady) {
      console.warn("⚠ Email service not ready. Email functionality will be disabled.");
    }

    app.listen(PORT, () => {
      console.log(`\n🚀 VIRUS EVENT Server running on http://localhost:${PORT}`);
      console.log(`✓ CORS enabled for ${FRONTEND_URL}`);
      console.log(`✓ Stripe endpoint: POST /api/create-checkout-session`);
      console.log(`✓ Webhook endpoint: POST /api/webhooks/stripe`);
      console.log(`✓ Check-in endpoint: POST /api/checkin`);
      console.log(`✓ Tickets endpoint: GET /api/tickets/:email`);
      console.log(`✓ Event stats: GET /api/events/:eventId/stats`);
      console.log(`✓ Health check: GET /health\n`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
