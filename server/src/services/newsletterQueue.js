import { getDatabase } from "../config/database.js";
import { sendEmail } from "./email.js";

// KONFIGURATION
// 2 Mails pro Minute = 120 Mails/h (Puffer von 30 Mails für System-Mails)
const BATCH_SIZE = 2; 
const INTERVAL_MS = 60 * 1000; 

let isRunning = false;

export const startNewsletterWorker = () => {
  console.log(`📨 [NewsletterWorker] Gestartet. Limit: ~${(60000/INTERVAL_MS) * BATCH_SIZE} Mails/h`);
  
  setInterval(async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      await processBatch();
    } catch (error) {
      console.error("❌ [NewsletterWorker] Fehler:", error);
    } finally {
      isRunning = false;
    }
  }, INTERVAL_MS);
};

const processBatch = async () => {
  const db = getDatabase();
  if (!db) return;

  try {
    // 1. Hole pending Jobs
    const [jobs] = await db.query(`
      SELECT 
        q.id as queueId, 
        q.attempts,
        s.email, 
        s.firstName, 
        s.unsubscribeToken,
        n.subject, 
        n.contentHtml, 
        n.contentText,
        n.id as newsletterId
      FROM newsletter_queue q
      JOIN newsletter_subscribers s ON q.subscriberId = s.id
      JOIN newsletters n ON q.newsletterId = n.id
      WHERE q.status = 'pending'
      ORDER BY q.createdAt ASC
      LIMIT ?
    `, [BATCH_SIZE]);

    if (jobs.length === 0) {
        await checkCompletedNewsletters(db);
        return;
    }

    console.log(`📨 [NewsletterWorker] Verarbeite ${jobs.length} Mails...`);

    // 2. Jobs auf 'processing' setzen
    const jobIds = jobs.map(j => j.queueId);
    if (jobIds.length > 0) {
        await db.query(`UPDATE newsletter_queue SET status = 'processing' WHERE id IN (?)`, [jobIds]);
    }

    // 3. Mails versenden
    for (const job of jobs) {
      try {
        // Personalisierung
        const unsubscribeLink = `${process.env.FRONTEND_URL}/newsletter/unsubscribe?token=${job.unsubscribeToken || 'unknown'}`;
        
        let personalizedHtml = job.contentHtml
          .replace(/{{name}}/g, job.firstName || 'Fan')
          .replace(/{{unsubscribe_link}}/g, unsubscribeLink);
        
        // Footer anhängen falls nicht vorhanden
        if (!personalizedHtml.includes(unsubscribeLink)) {
            personalizedHtml += `<br><br><hr><p style="font-size: 12px; color: #666;">Du erhältst diese Mail, weil du dich für den VIRUS Newsletter angemeldet hast. <a href="${unsubscribeLink}">Abmelden</a></p>`;
        }

        const personalizedText = job.contentText
          .replace(/{{name}}/g, job.firstName || 'Fan')
          .replace(/{{unsubscribe_link}}/g, unsubscribeLink);

        await sendEmail({
          to: job.email,
          subject: job.subject,
          html: personalizedHtml,
          text: personalizedText,
          headers: {
            'List-Unsubscribe': `<${unsubscribeLink}>`
          }
        });

        // Erfolg
        await db.query(
          "UPDATE newsletter_queue SET status = 'sent', updatedAt = NOW() WHERE id = ?", 
          [job.queueId]
        );
        console.log(`✅ Mail an ${job.email} gesendet.`);

      } catch (err) {
        console.error(`❌ Fehler bei Mail an ${job.email}:`, err.message);
        const newStatus = job.attempts >= 3 ? 'failed' : 'pending';
        await db.query(
          "UPDATE newsletter_queue SET status = ?, attempts = attempts + 1, lastError = ?, updatedAt = NOW() WHERE id = ?",
          [newStatus, err.message.substring(0, 255), job.queueId]
        );
      }
    }

  } catch (err) {
      console.error("❌ [NewsletterWorker] Batch Error:", err);
  }
};

const checkCompletedNewsletters = async (db) => {
    await db.query(`UPDATE newsletters n SET status = 'completed', sentAt = NOW() WHERE status = 'sending' AND NOT EXISTS (SELECT 1 FROM newsletter_queue q WHERE q.newsletterId = n.id AND q.status IN ('pending', 'processing'))`);
};