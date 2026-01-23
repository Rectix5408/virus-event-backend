import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// Transporter Konfiguration
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: false, // false für Port 587 (STARTTLS), true für 465
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
  tls: {
    // Wichtig: Erlaubt auch selbst-signierte Zertifikate, falls nötig
    rejectUnauthorized: false 
  }
});

export const verifyEmailService = async () => {
  try {
    await transporter.verify();
    console.log('✓ Email service is ready');
    return true;
  } catch (error) {
    console.error('❌ Email service error:', error);
    // Debugging-Hilfe (Passwort nicht loggen!)
    console.error('Email Config:', {
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      user: process.env.EMAIL_USER,
      passLength: process.env.EMAIL_PASSWORD ? process.env.EMAIL_PASSWORD.length : 0
    });
    return false;
  }
};

export const sendTicketEmail = async (ticket, event) => {
  const mailOptions = {
    from: `"VIRUS EVENT" <${process.env.EMAIL_FROM}>`,
    to: ticket.email,
    subject: `Dein Ticket für ${event.name}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #333;">Deine Bestellung ist bestätigt!</h1>
        <p>Hallo ${ticket.firstName},</p>
        <p>Vielen Dank für deine Bestellung. Hier ist dein Ticket für <strong>${event.name}</strong>.</p>
        
        <div style="background: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <p><strong>Ticket ID:</strong> ${ticket.id}</p>
          <p><strong>Kategorie:</strong> ${ticket.tierName}</p>
          <p><strong>Anzahl:</strong> ${ticket.quantity}</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <img src="${ticket.qrCode}" alt="Ticket QR Code" style="width: 200px; height: 200px;" />
        </div>

        <p>Dein VIRUS EVENT Team</p>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log(`✓ Email sent to ${ticket.email}`);
};

export const sendBulkEmail = async (recipients, subject, htmlContent) => {
  console.log(`Starting bulk email to ${recipients.length} recipients`);
  
  // Sende Emails parallel (in einer echten App sollte man hier eine Queue verwenden)
  const promises = recipients.map(recipient => {
    const mailOptions = {
      from: `"VIRUS EVENT" <${process.env.EMAIL_FROM}>`,
      to: recipient.email,
      subject: subject,
      html: htmlContent
    };
    return transporter.sendMail(mailOptions).catch(err => console.error(`Failed to send to ${recipient.email}:`, err.message));
  });

  await Promise.all(promises);
};