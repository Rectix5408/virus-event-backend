import express from 'express';
import bcrypt from 'bcrypt';
import { getDatabase } from '../config/database.js';

const router = express.Router();

// Helper für einfache IDs
const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

// --- USER MANAGEMENT ---

// GET /api/admin/users - Alle Benutzer abrufen
router.get('/users', async (req, res) => {
  const db = getDatabase();
  let connection;
  try {
    connection = await db.getConnection();
    const [rows] = await connection.execute('SELECT id, email, username, role, permissions, created_at FROM users ORDER BY created_at DESC');
    
    const users = rows.map(user => ({
      ...user,
      // Permissions sind als JSON-String in der DB gespeichert
      permissions: user.permissions ? JSON.parse(user.permissions) : [],
      createdAt: user.created_at
    }));
    
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Fehler beim Laden der Benutzer' });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/admin/users - Neuen Benutzer erstellen
router.post('/users', async (req, res) => {
  const { email, password, username, role, permissions } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email und Passwort sind erforderlich' });
  }

  const db = getDatabase();
  let connection;
  try {
    connection = await db.getConnection();

    // Prüfen ob Email bereits existiert
    const [existing] = await connection.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Email bereits registriert' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const id = generateId();
    const permissionsJson = JSON.stringify(permissions || []);
    const userRole = role || 'user';
    const userName = username || email.split('@')[0];

    await connection.execute(
      'INSERT INTO users (id, email, password, username, role, permissions, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [id, email, hashedPassword, userName, userRole, permissionsJson]
    );

    res.status(201).json({ message: 'Benutzer erstellt', id });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ message: 'Fehler beim Erstellen des Benutzers' });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/admin/users/:id - Benutzer aktualisieren
router.put('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { email, password, username, role, permissions } = req.body;

  const db = getDatabase();
  let connection;
  try {
    connection = await db.getConnection();

    let query = 'UPDATE users SET email = ?, username = ?, role = ?, permissions = ?';
    const params = [email, username, role, JSON.stringify(permissions || [])];

    // Passwort nur updaten, wenn es gesetzt wurde
    if (password && password.trim() !== '') {
      const hashedPassword = await bcrypt.hash(password, 10);
      query += ', password = ?';
      params.push(hashedPassword);
    }

    query += ' WHERE id = ?';
    params.push(id);

    await connection.execute(query, params);

    res.json({ message: 'Benutzer aktualisiert' });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ message: 'Fehler beim Aktualisieren' });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/admin/users/:id - Benutzer löschen
router.delete('/users/:id', async (req, res) => {
  const { id } = req.params;
  const db = getDatabase();
  let connection;
  try {
    connection = await db.getConnection();
    await connection.execute('DELETE FROM users WHERE id = ?', [id]);
    res.json({ message: 'Benutzer gelöscht' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'Fehler beim Löschen' });
  } finally {
    if (connection) connection.release();
  }
});

// --- TICKET SCANNER ---

// POST /api/admin/tickets/scan - Ticket scannen und entwerten
router.post('/tickets/scan', async (req, res) => {
  const { ticketId } = req.body;
  
  if (!ticketId) {
      return res.status(400).json({ message: 'Ticket ID fehlt' });
  }

  const db = getDatabase();
  let connection;
  try {
    connection = await db.getConnection();
    
    // Ticket suchen (inkl. Event-Infos)
    const [rows] = await connection.execute(
        'SELECT t.*, e.title as eventTitle, e.date as eventDate FROM tickets t LEFT JOIN events e ON t.eventId = e.id WHERE t.id = ?', 
        [ticketId]
    );

    if (rows.length === 0) {
        return res.status(404).json({ message: 'Ticket nicht gefunden' });
    }

    const ticket = rows[0];

    // Prüfen ob bereits gescannt
    if (ticket.scannedAt) {
        return res.status(409).json({ 
            message: 'Ticket bereits entwertet', 
            ticket: {
                ...ticket,
                scannedAt: ticket.scannedAt
            }
        });
    }

    // Ticket entwerten (scannedAt setzen)
    await connection.execute('UPDATE tickets SET scannedAt = NOW() WHERE id = ?', [ticketId]);
    
    // Aktualisiertes Ticket zurückgeben
    const [updatedRows] = await connection.execute('SELECT * FROM tickets WHERE id = ?', [ticketId]);
    
    res.json({ 
        success: true, 
        message: 'Zutritt gewährt',
        ticket: updatedRows[0]
    });

  } catch (error) {
    console.error('Scan error:', error);
    res.status(500).json({ message: 'Serverfehler beim Scannen' });
  } finally {
    if (connection) connection.release();
  }
});

export default router;