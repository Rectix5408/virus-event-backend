import express from 'express';
import bcrypt from 'bcrypt';
import { getDatabase } from '../config/database.js';
import { hasPermission } from './auth.js';
const router = express.Router();

// Get all users
router.get('/', hasPermission('users:view'), async (req, res) => {
    const db = getDatabase();
    const [users] = await db.query('SELECT id, username, permissions FROM users');
    res.json(users);
});

// Create user
router.post('/', hasPermission('users:create'), async (req, res) => {
    const { username, password, permissions } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }

    try {
        const db = getDatabase();
        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await db.query(
            'INSERT INTO users (username, password, permissions) VALUES (?, ?, ?)',
            [username, hashedPassword, JSON.stringify(permissions || {})]
        );
        res.status(201).json({ id: result.insertId, username, permissions });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Username already exists' });
        }
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Update user
router.put('/:id', hasPermission('users:update'), async (req, res) => {
    const { id } = req.params;
    const { username, password, permissions } = req.body;

    try {
        const db = getDatabase();
        let query = 'UPDATE users SET ';
        const params = [];
        let hasParams = false;

        if (username) {
            query += 'username = ?, ';
            params.push(username);
            hasParams = true;
        }

        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            query += 'password = ?, ';
            params.push(hashedPassword);
            hasParams = true;
        }

        if (permissions) {
            query += 'permissions = ?, ';
            params.push(JSON.stringify(permissions));
            hasParams = true;
        }

        if (!hasParams) {
            return res.status(400).json({ message: 'No fields to update' });
        }

        query = query.slice(0, -2); // Remove trailing comma and space
        query += ' WHERE id = ?';
        params.push(id);

        await db.query(query, params);
        res.json({ message: 'User updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Delete user
router.delete('/:id', hasPermission('users:delete'), async (req, res) => {
    const { id } = req.params;
    const db = getDatabase();
    await db.query('DELETE FROM users WHERE id = ?', [id]);
    res.json({ message: 'User deleted successfully' });
});

export default router;
