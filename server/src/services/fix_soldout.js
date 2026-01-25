import "dotenv/config";
import { getDatabase, initializeDatabase } from "../config/database.js";
import redisClient from "../config/redis.js";

const fixDatabase = async () => {
  console.log("🔧 Starte Datenbank-Bereinigung für 'Sold Out' Problem...");
  
  // Datenbank initialisieren, da dies ein Standalone-Script ist
  await initializeDatabase();
  
  const db = getDatabase();
  
  try {
    const connection = await db.getConnection();
    
    // 1. Events laden
    const [events] = await connection.execute("SELECT id, ticketTiers FROM events");
    
    for (const event of events) {
      let tiers = event.ticketTiers;
      // Falls String, parsen (MySQL JSON Column gibt manchmal String zurück)
      if (typeof tiers === 'string') tiers = JSON.parse(tiers);
      
      let updated = false;
      
      // Tiers bereinigen: Alte Felder löschen
      tiers = tiers.map(tier => {
        if (tier.availableQuantity !== undefined || tier.totalQuantity !== undefined) {
          delete tier.availableQuantity;
          delete tier.totalQuantity;
          updated = true;
        }
        return tier;
      });
      
      if (updated) {
        await connection.execute(
          "UPDATE events SET ticketTiers = ? WHERE id = ?",
          [JSON.stringify(tiers), event.id]
        );
        console.log(`✓ Event ${event.id}: Alte Felder (availableQuantity) entfernt.`);
      } else {
        console.log(`- Event ${event.id}: Bereits sauber.`);
      }
    }
    
    connection.release();
    
    // 2. Redis Cache leeren (WICHTIG, damit Frontend neue Daten lädt)
    if (redisClient && redisClient.isOpen) {
      await redisClient.del('events:all');
      // Auch spezifische Event-Keys löschen
      for (const event of events) {
        await redisClient.del(`event:${event.id}`);
      }
      console.log("✓ Redis Cache gelöscht.");
    } else {
        console.log("ℹ Redis nicht verbunden oder nicht aktiv (Cache evtl. manuell leeren).");
    }
    
    console.log("✅ Fertig! Die Tickets sollten jetzt wieder verfügbar sein.");
    process.exit(0);
    
  } catch (err) {
    console.error("❌ Fehler:", err);
    process.exit(1);
  }
};

fixDatabase();