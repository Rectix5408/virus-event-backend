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

// Pfad Setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Upload Ordner erstellen
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const app = express();
const PORT = process.env.PORT || 3001;

// Erlaubte Origins
const allowedOrigins = [
  "https://www.virus-event.de",
  "https://virus-event.de",
];

// CORS Middleware
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS: Origin ${origin} not allowed`), false);
  },
  credentials: true,
}));

// Body Parser
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Uploads öffentlich
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Health Check
app.get("/health", async (req, res) => {
  let dbStatus = "disconnected";
  try {
    const pool = getDatabase();
    if (pool) await pool.query("SELECT 1") && (dbStatus = "connected");
  } catch (err) {
    dbStatus = "error: " + err.message;
  }
  res.json({ status: "ok", database: dbStatus, timestamp: new Date().toISOString() });
});

// API Routes
app.use("/api", apiRoutes);
app.use("/api/events", eventsRouter);
app.use("/api/auth", authRouter);
app.use('/api/newsletter', newsletterRouter);

// Error Handling
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({
    message: "Internal server error",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// Server Start
const startServer = async () => {
  try {
    console.log("🔄 Initializing database...");
    const dbConnected = await initializeDatabase();
    if (!dbConnected) {
      console.warn("⚠ Database connection failed. Offline mode enabled.");
    } else {
      console.log("🔄 Creating tables...");
      await createTables();
    }

    const emailReady = await verifyEmailService().catch(() => false);
    if (!emailReady) console.warn("⚠ Email service not ready. Emails disabled.");

    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`✓ CORS enabled for: ${allowedOrigins.join(", ")}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
