import express from 'express';
import { getDatabase } from '../config/database.js';
import redisClient from '../config/redis.js';

const router = express.Router();

// Helper für Caching
const getCachedData = async (key) => {
  try {
    if (!redisClient.isOpen) return null;
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.error("Redis Get Error:", e);
    return null;
  }
};

const setCachedData = async (key, data, ttl = 300) => { // 5 Minuten TTL
  try {
    if (!redisClient.isOpen) return;
    await redisClient.setEx(key, ttl, JSON.stringify(data));
  } catch (e) {
    console.error("Redis Set Error:", e);
  }
};

// GET /api/admin/tickets
router.get('/tickets', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const search = req.query.search || '';
  const offset = (page - 1) * limit;

  // Cache Key basierend auf Parametern
  const cacheKey = `admin:tickets:${page}:${limit}:${search}`;

  // 1. Cache Check
  const cached = await getCachedData(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  const db = getDatabase();
  const connection = await db.getConnection();

  try {
    // 2. DB Query
    let query = "SELECT * FROM tickets";
    let countQuery = "SELECT COUNT(*) as total FROM tickets";
    const params = [];

    if (search) {
      const searchTerm = `%${search}%`;
      const whereClause = " WHERE firstName LIKE ? OR lastName LIKE ? OR email LIKE ? OR id LIKE ?";
      query += whereClause;
      countQuery += whereClause;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    query += " ORDER BY createdAt DESC LIMIT ? OFFSET ?";
    
    const [rows] = await connection.execute(query, [...params, limit, offset]);
    const [countResult] = await connection.execute(countQuery, params);
    
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    const response = {
      data: rows,
      meta: {
        totalItems,
        currentPage: page,
        itemsPerPage: limit,
        totalPages
      }
    };

    // 3. Cache Set
    await setCachedData(cacheKey, response);

    res.json(response);
  } catch (error) {
    console.error("Error fetching tickets:", error);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    connection.release();
  }
});

// GET /api/admin/orders
router.get('/orders', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const search = req.query.search || '';
  const offset = (page - 1) * limit;

  const cacheKey = `admin:orders:${page}:${limit}:${search}`;

  const cached = await getCachedData(cacheKey);
  if (cached) return res.json(cached);

  const db = getDatabase();
  const connection = await db.getConnection();

  try {
    let query = "SELECT * FROM merch_orders";
    let countQuery = "SELECT COUNT(*) as total FROM merch_orders";
    const params = [];

    if (search) {
      const searchTerm = `%${search}%`;
      const whereClause = " WHERE firstName LIKE ? OR lastName LIKE ? OR email LIKE ? OR orderId LIKE ?";
      query += whereClause;
      countQuery += whereClause;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    
    const [rows] = await connection.execute(query, [...params, limit, offset]);
    const [countResult] = await connection.execute(countQuery, params);

    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    // Items parsen falls nötig (in MySQL oft als JSON String gespeichert)
    const formattedRows = rows.map(row => ({
      ...row,
      items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items
    }));

    const response = {
      data: formattedRows,
      meta: {
        totalItems,
        currentPage: page,
        itemsPerPage: limit,
        totalPages
      }
    };

    await setCachedData(cacheKey, response);
    res.json(response);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    connection.release();
  }
});

export default router;
