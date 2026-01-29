import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server root (../../.env)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

async function initGuestlist() {
  console.log('🔌 Connecting to database...', dbConfig.host);
  const connection = await mysql.createConnection(dbConfig);

  try {
    console.log('🛠 Creating guestlist table...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS guestlist (
        id CHAR(36) NOT NULL PRIMARY KEY,
        eventId VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(50) NOT NULL,
        plusOne BOOLEAN DEFAULT FALSE,
        status VARCHAR(20) DEFAULT 'pending',
        ticketId VARCHAR(255) DEFAULT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_event (eventId),
        FOREIGN KEY (eventId) REFERENCES events(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✅ Table guestlist created successfully!');
  } catch (err) {
    console.error('❌ Error creating table:', err);
  } finally {
    await connection.end();
  }
}

initGuestlist();