import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { getDatabase } from '../config/database.js';

const router = express.Router();

// Middleware to check for a valid session
export const protect = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Not authorized, no token' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const db = getDatabase();



        // Standard session handling for dynamic users
        const [sessions] = await db.query('SELECT * FROM sessions WHERE token = ? AND expires_at > NOW()', [token]);
        if (sessions.length === 0) {
            return res.status(401).json({ error: 'Not authorized, token has expired' });
        }

        const session = sessions[0];
        const [users] = await db.query('SELECT id, username, permissions FROM users WHERE id = ?', [session.user_id]);
        if (users.length === 0) {
            return res.status(401).json({ error: 'Not authorized, user not found' });
        }

        req.user = { ...users[0], permissions: JSON.parse(users[0].permissions || '{}') };
        next();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Middleware to check for specific permissions
export const hasPermission = (permission) => {
    return (req, res, next) => {
        // The protect middleware should have already run and attached the user.
        // The admin user always has all permissions.
        if (!req.user || (!req.user.permissions?.admin && !req.user.permissions?.[permission])) {
            return res.status(403).json({ error: 'Forbidden: You do not have the required permission.' });
        }
        next();
    };
};


router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const pool = getDatabase();

        // Check admins table for 'admin' user - REMOVED, 'admin' will be a regular user with permissions
        
        const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);

        if (users.length > 0) {
            const user = users[0];
            // NOTE: In a real app, passwords should be hashed! -> Now they are!
            const passwordMatch = await bcrypt.compare(password, user.password);

            if (passwordMatch) {
                const token = crypto.randomBytes(64).toString('hex');
                const expires_at = new Date();
                // Set token to expire in 30 days for "Stay Logged In"
                expires_at.setDate(expires_at.getDate() + 30); 

                await pool.query('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)', [user.id, token, expires_at]);
                
                res.json({ success: true, token, user: {username: user.username, permissions: JSON.parse(user.permissions || '{}')} });
            } else {
                res.status(401).json({ error: 'Ungültige Zugangsdaten' });
            }
        } else {
            res.status(401).json({ error: 'Ungültige Zugangsdaten' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/logout', protect, async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    // Only try to delete from DB if it's not the static admin token - This check is no longer needed
    if (token) {
        try {
            const pool = getDatabase();
            await pool.query('DELETE FROM sessions WHERE token = ?', [token]);
        } catch (error) {
            // Log error but don't prevent logout
            console.error("Error deleting session from DB:", error);
        }
    }
    
    // Always confirm logout, even if token was already invalid
    res.json({ success: true, message: 'Logged out successfully' });
});

export default router;