import nodemailer from 'nodemailer';

// Transporter Singleton (wird beim ersten Aufruf erstellt)
let transporter = null;

const createTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: false, // true für 465, false für andere Ports
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
      tls: {
        ciphers: 'SSLv3'
      }
    });
  }
  return transporter;
};

export const sendEmail = async ({ to, subject, html, text, headers }) => {
  const transport = createTransporter();
  const info = await transport.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || 'VIRUS Event'}" <${process.env.EMAIL_FROM}>`,
    to,
    subject,
    html,
    text,
    headers // Für List-Unsubscribe
  });
  return info;
};

/**
 * Sendet das Ticket per E-Mail
 * @param {Object} ticket - Ticket Objekt aus der DB (muss email, firstName, id, tierName, qrCode enthalten)
 * @param {Object} event - Event Objekt (muss title, date, location enthalten)
 */
export const sendTicketEmail = async (ticket, event) => {
  const to = ticket.email;
  const subject = `Dein Ticket für ${event.title}`;
  
  const html = `
    <div style="background-color: #000000; color: #ffffff; font-family: Arial, sans-serif; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; border: 1px solid #333333; padding: 20px;">
        <h1 style="color: #ff0000; text-align: center;">VIRUS EVENT</h1>
        <h2 style="text-align: center;">Dein Ticket ist da!</h2>
        
        <p>Hallo ${ticket.firstName},</p>
        <p>Du hast erfolgreich ein Ticket für <strong>${event.title}</strong> erworben.</p>
        
        <div style="background-color: #111111; padding: 15px; margin: 20px 0; border-left: 4px solid #ff0000;">
          <p style="margin: 5px 0;"><strong>Event:</strong> ${event.title}</p>
          <p style="margin: 5px 0;"><strong>Datum:</strong> ${event.date}</p>
          <p style="margin: 5px 0;"><strong>Ort:</strong> ${event.location}</p>
          <p style="margin: 5px 0;"><strong>Ticket-ID:</strong> ${ticket.id}</p>
          <p style="margin: 5px 0;"><strong>Kategorie:</strong> ${ticket.tierName}</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <img src="${ticket.qrCode}" alt="Ticket QR Code" style="width: 200px; height: 200px; background-color: #ffffff; padding: 10px;" />
          <p style="font-size: 12px; color: #888888;">Zeige diesen QR-Code am Einlass vor.</p>
        </div>

        <p>Wir freuen uns auf dich!</p>
        <p style="font-size: 12px; color: #666666; margin-top: 30px;">
          Dies ist eine automatische E-Mail. Bitte antworte nicht darauf.<br>
          VIRUS Event
        </p>
      </div>
    </div>
  `;

  const text = `Hallo ${ticket.firstName},\n\nHier ist dein Ticket für ${event.title}.\nDatum: ${event.date}\nOrt: ${event.location}\nTicket ID: ${ticket.id}\n\nBitte nutze die HTML-Ansicht, um deinen QR-Code zu sehen.`;

  return sendEmail({ to, subject, html, text });
};

/**
 * Sendet Bestellbestätigung für Merch
 */
export const sendOrderConfirmationEmail = async (order) => {
  const to = order.email;
  const subject = `Bestellbestätigung #${order.orderId}`;
  
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

  return sendEmail({ to, subject, html, text });
};