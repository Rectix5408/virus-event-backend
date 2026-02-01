import nodemailer from 'nodemailer';

// Konfiguration der Email-Accounts
const ACCOUNTS = {
  default: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  },
  newsletter: {
    user: process.env.EMAIL_NEWSLETTER_USER,
    pass: process.env.EMAIL_NEWSLETTER_PASSWORD
  },
  orders: {
    user: process.env.EMAIL_ORDERS_USER,
    pass: process.env.EMAIL_ORDERS_PASSWORD
  }
};

const createTransporter = (accountName = 'default') => {
  const account = ACCOUNTS[accountName] || ACCOUNTS.default;
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: false,
    auth: {
      user: account.user,
      pass: account.pass,
    },
    tls: {
      ciphers: 'SSLv3',
      rejectUnauthorized: false
    }
  });
};

export const sendEmail = async ({ to, subject, html, text, headers, from, attachments, replyTo, accountName = 'default' }) => {
  const transport = createTransporter(accountName);
  const account = ACCOUNTS[accountName] || ACCOUNTS.default;
  
  // Fallback Absender definieren (falls .env EMAIL_FROM leer ist, nutze EMAIL_USER)
  const defaultFrom = `"${process.env.EMAIL_FROM_NAME || 'VIRUS Event'}" <${account.user}>`;

  try {
    const info = await transport.sendMail({
      from: from || defaultFrom,
      replyTo: replyTo,
      to,
      subject,
      html,
      text,
      headers, // Für List-Unsubscribe
      attachments
    });
    console.log(`📧 Email sent to ${to} (ID: ${info.messageId}) via ${accountName}`);
    return info;
  } catch (error) {
    console.error(`❌ FAILED to send email to ${to} via ${accountName}:`, error.message);
    throw error;
  }
};

/**
 * Sendet das Ticket per E-Mail
 * @param {Object} ticketData - Ticket Daten (kann 'tickets' Array enthalten für Sammelbestellung)
 * @param {Object} event - Event Objekt (muss title, date, location enthalten)
 */
export const sendTicketEmail = async (ticketData, event) => {
  const to = ticketData.email;
  // Fallback für Event-Titel, falls unterschiedlich benannt
  const eventName = event.title || event.name || "Event";
  const subject = `Deine Tickets für ${eventName}`;
  
  // WICHTIG: Wir nutzen den authentifizierten User als Absender (für Zustellbarkeit),
  // aber setzen Reply-To auf die Bestell-Adresse.
  const senderEmail = ACCOUNTS.orders.user;
  const from = `"VIRUS Bestellungen" <${senderEmail}>`;
  const replyTo = "bestellung@virus-event.de";

  // Prüfen ob Sammelbestellung (Array) oder Einzelticket
  const tickets = ticketData.tickets || [ticketData];
  const isBulk = tickets.length > 1;

  // Anhänge generieren (QR-Codes)
  const attachments = tickets.map((t, index) => {
    if (!t.qrCode) return null;
    // Data-URL Prefix entfernen für Nodemailer
    const base64Content = t.qrCode.split("base64,")[1];
    return {
      filename: `ticket-${t.id}.png`,
      content: base64Content,
      encoding: 'base64',
      cid: `qrcode_${index}` // Content-ID für Inline-Anzeige
    };
  }).filter(Boolean);

  // HTML für die Ticket-Liste generieren
  const ticketsHtml = tickets.map((t, index) => `
    <div style="background-color: #111111; padding: 15px; margin: 20px 0; border-left: 4px solid #ff0000;">
      <p style="margin: 5px 0; color: #ff0000; font-size: 14px;"><strong>TICKET ${index + 1}</strong></p>
      <p style="margin: 5px 0;"><strong>Ticket-ID:</strong> ${t.id}</p>
      <p style="margin: 5px 0;"><strong>Kategorie:</strong> ${t.tierName || ticketData.tierName}</p>
      <div style="text-align: center; margin: 15px 0;">
        <img src="cid:qrcode_${index}" alt="QR Code" style="width: 150px; height: 150px; background-color: #ffffff; padding: 5px;" />
      </div>
    </div>
  `).join('');
  
  const html = `
    <div style="background-color: #000000; color: #ffffff; font-family: Arial, sans-serif; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; border: 1px solid #333333; padding: 20px;">
        <h1 style="color: #ff0000; text-align: center;">VIRUS EVENT</h1>
        <h2 style="text-align: center;">Deine Tickets sind da!</h2>
        
        <p>Hallo ${ticketData.firstName},</p>
        <p>Du hast erfolgreich ${tickets.length} Ticket(s) für <strong>${eventName}</strong> erworben.</p>
        
        <div style="margin: 20px 0; border-bottom: 1px solid #333; padding-bottom: 20px;">
          <p style="margin: 5px 0;"><strong>Event:</strong> ${eventName}</p>
          <p style="margin: 5px 0;"><strong>Datum:</strong> ${event.date}</p>
          <p style="margin: 5px 0;"><strong>Ort:</strong> ${event.location}</p>
        </div>

        ${ticketsHtml}

        <p style="text-align: center; margin-top: 20px;">Bitte zeige diese QR-Codes am Einlass vor.</p>

        <p style="font-size: 12px; color: #666666; margin-top: 30px;">
          Dies ist eine automatische E-Mail. Bitte antworte nicht darauf.<br>
          VIRUS Event
        </p>
      </div>
    </div>
  `;

  const text = `Hallo ${ticketData.firstName},\n\nHier sind deine ${tickets.length} Tickets für ${eventName}.\nDatum: ${event.date}\nOrt: ${event.location}\n\nBitte nutze die HTML-Ansicht oder die Anhänge, um deine QR-Codes zu sehen.`;

  return sendEmail({ to, subject, html, text, from, attachments, replyTo, accountName: 'orders' });
};

/**
 * Sendet Bestellbestätigung für Merch
 */
export const sendOrderConfirmationEmail = async (order) => {
  const to = order.email;
  const subject = `Bestellbestätigung #${order.orderId}`;
  
  const senderEmail = ACCOUNTS.orders.user;
  const from = `"VIRUS Bestellungen" <${senderEmail}>`;
  const replyTo = "bestellung@virus-event.de";
  
  const html = `
    <div style="background-color: #000000; color: #ffffff; font-family: Arial, sans-serif; padding: 20px;">
      <h1 style="color: #ff0000;">VIRUS MERCH</h1>
      <h2>Bestellung bestätigt!</h2>
      <p>Hallo ${order.firstName},</p>
      <p>Vielen Dank für deine Bestellung #${order.orderId}.</p>
      <p>Gesamtsumme: <strong>${(order.totalAmount / 100).toFixed(2)} €</strong></p>
      <p>Wir bearbeiten deine Bestellung so schnell wie möglich.</p>
    </div>
  `;
  
  const text = `Bestellung #${order.orderId} bestätigt. Summe: ${(order.totalAmount / 100).toFixed(2)} €`;

  return sendEmail({ to, subject, html, text, from, replyTo, accountName: 'orders' });
};

/**
 * Sendet Kontakt-Email (für Support-Antworten oder Benachrichtigungen)
 */
export const sendContactEmail = async ({ to, subject, text, html }) => {
  const senderEmail = ACCOUNTS.default.user;
  const from = `"VIRUS Kontakt" <${senderEmail}>`;
  const replyTo = "kontakt@virus-event.de";
  return sendEmail({ to, subject, text, html, from, replyTo });
};

/**
 * Sendet Newsletter-Email
 */
export const sendNewsletterEmail = async ({ to, subject, text, html }) => {
  const senderEmail = ACCOUNTS.newsletter.user;
  const from = `"VIRUS Newsletter" <${senderEmail}>`;
  const replyTo = "newsletter@virus-event.de";
  return sendEmail({ to, subject, text, html, from, replyTo, accountName: 'newsletter' });
};

/**
 * Verifiziert die Verbindung zum Mailserver beim Start
 */
export const verifyEmailService = async () => {
  const transport = createTransporter('default');
  try {
    await transport.verify();
    console.log("✅ Email service ready");
    return true;
  } catch (error) {
    console.error("❌ Email service verification failed:", error);
    return false;
  }
};