import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

let pool = null;

export const initializeDatabase = async () => {
  try {
    console.log(`⏳ Connecting to database at ${process.env.DB_HOST}...`);
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'virusevent',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 10000 // 10 Sekunden Timeout, damit es nicht ewig hängt
    });

    // Test connection
    await pool.query('SELECT 1');
    console.log('✓ MySQL database connected successfully');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
};

export const getDatabase = () => pool;

export const createTables = async () => {
  if (!pool) return;

  try {
    // Events Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS events (
        id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        date VARCHAR(255) NOT NULL,
        dateISO DATE NOT NULL,
        time VARCHAR(255) NOT NULL,
        location VARCHAR(255) NOT NULL,
        image TEXT,
        description TEXT,
        ticketUrl VARCHAR(255),
        eventSecret VARCHAR(255),
        detailedLineup JSON,
        ticketTiers JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    // Tickets Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        firstName VARCHAR(100) NOT NULL,
        lastName VARCHAR(100) NOT NULL,
        tierId VARCHAR(50) NOT NULL,
        tierName VARCHAR(100) NOT NULL,
        eventId VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
        eventTitle VARCHAR(255),
        quantity INT NOT NULL DEFAULT 1,
        qrCode LONGTEXT NOT NULL,
        checkIn BOOLEAN DEFAULT FALSE,
        checkInTime DATETIME,
        paymentIntentId VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'confirmed',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_email (email),
        INDEX idx_eventId (eventId),
        INDEX idx_qrCode (qrCode(255)),
        CONSTRAINT fk_tickets_events FOREIGN KEY (eventId) REFERENCES events (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Admins Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL
      )
    `);

    // Users Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        permissions JSON
      )
    `);

    // Sessions Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        token VARCHAR(255) NOT NULL UNIQUE,
        expires_at DATETIME NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Newsletter Subscribers Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        firstName VARCHAR(100),
        is_subscribed BOOLEAN DEFAULT TRUE,
        confirmationToken VARCHAR(100),
        unsubscribeToken VARCHAR(100),
        ipAddress VARCHAR(45),
        subscribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        unsubscribed_at TIMESTAMP NULL
      )
    `);

    // Newsletters Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS newsletters (
        id VARCHAR(36) PRIMARY KEY,
        subject VARCHAR(255) NOT NULL,
        contentHtml LONGTEXT NOT NULL,
        contentText LONGTEXT NOT NULL,
        status ENUM('draft', 'sending', 'completed') DEFAULT 'draft',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        sentAt DATETIME
      )
    `);

    // Newsletter Queue Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS newsletter_queue (
        id INT AUTO_INCREMENT PRIMARY KEY,
        newsletterId VARCHAR(36) NOT NULL,
        subscriberId INT NOT NULL,
        status ENUM('pending', 'processing', 'sent', 'failed') DEFAULT 'pending',
        attempts INT DEFAULT 0,
        lastError TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (newsletterId) REFERENCES newsletters(id) ON DELETE CASCADE,
        FOREIGN KEY (subscriberId) REFERENCES newsletter_subscribers(id) ON DELETE CASCADE,
        INDEX idx_status (status)
      )
    `);

    // Merch Products Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS merch_products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10, 2) NOT NULL,
        category VARCHAR(100) NOT NULL,
        images JSON NOT NULL,
        sizes JSON NOT NULL,
        stock JSON NOT NULL,
        isActive BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Merch Orders Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS merch_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        orderId VARCHAR(255) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL,
        firstName VARCHAR(100) NOT NULL,
        lastName VARCHAR(100) NOT NULL,
        address JSON NOT NULL,
        items JSON NOT NULL,
        totalAmount DECIMAL(10, 2) NOT NULL,
        paymentIntentId VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_email (email),
        INDEX idx_orderId (orderId)
      )
    `);

        // Guestlist Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS guestlist (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        eventId VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(50) NOT NULL,
        plusOne TINYINT(1) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'pending',
        qrCode LONGTEXT,
          checkedIn BOOLEAN DEFAULT FALSE,
        ticketId VARCHAR(255) DEFAULT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_event (eventId),
        CONSTRAINT fk_guestlist_events FOREIGN KEY (eventId) REFERENCES events (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Check if events exist and seed if empty
    const [rows] = await pool.query("SELECT COUNT(*) as count FROM events");
    const count = rows[0].count;
    console.log(`📊 Database check: ${count} events found`);

    if (count == 0) {
      console.log("🌱 Seeding database with initial events...");
      
      const seedEvents = [
        {
          id: "virus-chapter-1",
          title: "VIRUS CHAPTER I (DB)",
          date: "21. Februar 2026",
          dateISO: "2026-02-21",
          time: "23:00 - 08:00",
          location: "FUSION CLUB, Münster",
          image: "https://images.unsplash.com/photo-1574391884720-bbc3740c59d1?w=600&q=80",
          description: "Das erste Kapitel der VIRUS-Serie. Frisch aus der Datenbank.",
          ticketUrl: "#",
          detailedLineup: JSON.stringify([
            { name: "DARKPULSE", time: "23:00 - 00:30", isHeadliner: false },
            { name: "VENOM", time: "00:30 - 02:00", isHeadliner: false },
            { name: "INDUSTRIAL STRENGTH", time: "02:00 - 04:00", isHeadliner: true }
          ]),
          ticketTiers: JSON.stringify([
            { id: "early-bird", name: "EARLY BIRD", price: 15.00, totalQuantity: 100, availableQuantity: 100, isSoldOut: false },
            { id: "phase-1", name: "PHASE I", price: 19.00, totalQuantity: 100, availableQuantity: 50, isSoldOut: false },
            { id: "vip", name: "VIP", price: 35.00, description: "Fast Lane + VIP Area", totalQuantity: 50, availableQuantity: 5, isSoldOut: false }
          ])
        },
        {
          id: "virus-chapter-2",
          title: "VIRUS CHAPTER II (DB)",
          date: "14. März 2026",
          dateISO: "2026-03-14",
          time: "22:00 - 07:00",
          location: "MATRIX CLUB, Bochum",
          image: "https://images.unsplash.com/photo-1571266028243-3716f02d2d2e?w=600&q=80",
          description: "Das Virus breitet sich aus. Chapter II bringt noch härtere Bässe.",
          ticketUrl: "#",
          detailedLineup: JSON.stringify([]),
          ticketTiers: JSON.stringify([
            { id: "regular", name: "REGULAR", price: 20.00, totalQuantity: 250, availableQuantity: 250, isSoldOut: false }
          ])
        }
      ];

      for (const event of seedEvents) {
        await pool.query(`INSERT INTO events (id, title, date, dateISO, time, location, image, description, ticketUrl, detailedLineup, ticketTiers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [event.id, event.title, event.date, event.dateISO, event.time, event.location, event.image, event.description, event.ticketUrl, event.detailedLineup, event.ticketTiers]);
      }
      console.log("✓ Database seeded with 2 events");
    }

    // Seed Admin if not exists
    const [adminRows] = await pool.query("SELECT COUNT(*) as count FROM admins");
    if (adminRows[0].count == 0) {
      console.log("🌱 Seeding database with default admin...");
      await pool.query("INSERT INTO admins (username, password) VALUES (?, ?)", ['admin', 'virus-admin-123']);
    }

    // Seed Merch Products if not exists
    const [merchRows] = await pool.query("SELECT COUNT(*) as count FROM merch_products");
    if (merchRows[0].count == 0) {
      console.log("🌱 Seeding database with test merch products...");
      
      const testProducts = [
        {
          name: "VIRUS T-SHIRT BLACK",
          description: "Premium T-Shirt aus 100% Baumwolle mit VIRUS Logo Front und Back Print. Perfekt für jede Rave!",
          price: 39.99,
          category: "tshirts",
          images: JSON.stringify(["/uploads/tshirt-front.png", "/uploads/tshirt-back.png"]),
          sizes: JSON.stringify(["S", "M", "L", "XL", "XXL"]),
          stock: JSON.stringify({ "S": 10, "M": 15, "L": 20, "XL": 15, "XXL": 10 }),
          isActive: true
        },
        {
          name: "VIRUS HOODIE BLACK",
          description: "Kuschelig warmer Premium Hoodie mit VIRUS Logo Front und Back Print. Ideal für kalte Nächte!",
          price: 69.99,
          category: "hoodies",
          images: JSON.stringify(["/uploads/hoodie-front.png", "/uploads/hoodie-back.png"]),
          sizes: JSON.stringify(["S", "M", "L", "XL", "XXL"]),
          stock: JSON.stringify({ "S": 5, "M": 10, "L": 15, "XL": 10, "XXL": 5 }),
          isActive: true
        }
      ];

      for (const product of testProducts) {
        await pool.query(
          `INSERT INTO merch_products (name, description, price, category, images, sizes, stock, isActive) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [product.name, product.description, product.price, product.category, product.images, product.sizes, product.stock, product.isActive]
        );
      }
      console.log("✓ Database seeded with 2 test merch products");
    }

    console.log('✓ Tables created/verified');
  } catch (error) {
    console.error('Error creating tables:', error);
  }
};