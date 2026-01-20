import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

// .env Datei laden
dotenv.config();

console.log("🔍 Teste Datenbank-Verbindung...");
console.log(`   Host: ${process.env.DB_HOST}`);
console.log(`   User: ${process.env.DB_USER}`);
console.log(`   Datenbank: ${process.env.DB_NAME}`);

const testConnection = async () => {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      connectTimeout: 5000 // 5 Sekunden Timeout (wichtig!)
    });
    console.log("✅ VERBINDUNG ERFOLGREICH!");
    await connection.end();
  } catch (error) {
    console.error("\n❌ VERBINDUNG FEHLGESCHLAGEN:");
    console.error(`   Code: ${error.code}`);
    console.error(`   Nachricht: ${error.message}\n`);
    
    if (error.code === 'ETIMEDOUT') {
      console.log("💡 TIPP: Das sieht nach einer Firewall aus. Prüfe in Plesk, ob Port 3306 offen ist und deine IP erlaubt ist.");
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.log("💡 TIPP: Benutzername oder Passwort falsch. Oder der Benutzer darf von deiner IP nicht zugreifen (Remote Access in Plesk prüfen).");
    } else if (error.code === 'ENOTFOUND') {
      console.log("💡 TIPP: Der Hostname ist falsch. Prüfe 'DB_HOST' in der .env Datei.");
    }
  }
};

testConnection();