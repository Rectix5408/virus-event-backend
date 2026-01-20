// server/setup-admin.js
import bcrypt from 'bcrypt';
import { getDatabase, initializeDatabase } from './src/config/database.js';

// --- Configuration ---
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123!';
const SALT_ROUNDS = 10;
// --- End Configuration ---

const setupAdmin = async () => {
  let pool;
  try {
    console.log('Initializing database connection...');
    const connected = await initializeDatabase();

    if (!connected) {
      console.error('❌ Could not connect to the database. Please check your .env file and ensure your database server is running.');
      process.exit(1);
    }

    pool = getDatabase();
    // This check is now redundant because initializeDatabase handles it, but it's good for safety.
    if (!pool) {
      console.error('❌ Database pool is not available even after initialization.');
      process.exit(1);
    }
    
    const connection = await pool.getConnection();
    console.log('Database connection retrieved.');

    console.log(`Checking for existing user: ${ADMIN_USERNAME}...`);
    const [users] = await connection.query('SELECT * FROM users WHERE username = ?', [ADMIN_USERNAME]);

    console.log('Hashing new password...');
    const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);
    console.log('Password hashed.');

    if (users.length > 0) {
      // User exists, update password
      console.log('User found. Updating password...');
      await connection.query('UPDATE users SET password = ? WHERE username = ?', [hashedPassword, ADMIN_USERNAME]);
      console.log('✅ Password for user "admin" has been successfully updated.');
    } else {
      // User does not exist, create new user
      console.log('User not found. Creating new admin user...');
      const permissions = JSON.stringify({ admin: true });
      await connection.query(
        'INSERT INTO users (username, password, permissions) VALUES (?, ?, ?)',
        [ADMIN_USERNAME, hashedPassword, permissions]
      );
      console.log('✅ New user "admin" with admin privileges has been successfully created.');
    }

    connection.release();
  } catch (error) {
    console.error('❌ An error occurred during the admin setup:', error);
    process.exit(1); // Exit with an error code
  } finally {
    if (pool) {
      await pool.end();
      console.log('Database connection closed.');
    }
  }
};

setupAdmin();
