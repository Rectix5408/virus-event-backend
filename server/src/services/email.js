import QRCode from "qrcode";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

// Email Transporter Setup
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

/**
 * Generates a QR code for a ticket
 */
export const generateTicketQRCode = async (ticketData) => {
  try {
    const qrContent = `VIRUS_TICKET|${ticketData.id}|${ticketData.eventId}|${ticketData.email}`;
    const qrCodeDataUrl = await QRCode.toDataURL(qrContent, {
      errorCorrectionLevel: "H",
      type: "image/png",
      quality: 0.95,
      margin: 1,
      width: 300,
    });
    return qrCodeDataUrl;
  } catch (error) {
    console.error("QR Code generation error:", error);
    throw error;
  }
};

/**
 * Generates HTML email template with QR code
 */
const generateEmailHTML = (ticketData, qrCodeDataUrl, eventDetails) => {
  return `
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dein VIRUS EVENT Ticket</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: #1a1a1a;
            color: #ffffff;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            background: #0a0a0a;
            border: 2px solid #ff0000;
            padding: 0;
        }
        .header {
            background: linear-gradient(135deg, #ff0000, #cc0000);
            padding: 40px 20px;
            text-align: center;
            border-bottom: 2px solid #ff0000;
        }
        .header h1 {
            font-size: 32px;
            font-weight: bold;
            letter-spacing: 2px;
            margin-bottom: 10px;
        }
        .header p {
            font-size: 14px;
            opacity: 0.9;
            letter-spacing: 1px;
        }
        .content {
            padding: 40px 20px;
        }
        .greeting {
            margin-bottom: 30px;
        }
        .greeting h2 {
            font-size: 20px;
            margin-bottom: 10px;
            color: #ff0000;
        }
        .greeting p {
            line-height: 1.6;
            color: #cccccc;
        }
        .ticket-info {
            background: #1a1a1a;
            border: 1px solid #333333;
            padding: 20px;
            margin: 30px 0;
            border-radius: 4px;
        }
        .ticket-info-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 15px;
            padding-bottom: 15px;
            border-bottom: 1px solid #333333;
        }
        .ticket-info-row:last-child {
            margin-bottom: 0;
            padding-bottom: 0;
            border-bottom: none;
        }
        .ticket-info-label {
            color: #999999;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .ticket-info-value {
            color: #ff0000;
            font-weight: bold;
            font-size: 14px;
        }
        .qr-section {
            text-align: center;
            margin: 40px 0;
            padding: 30px;
            background: #1a1a1a;
            border: 1px dashed #ff0000;
            border-radius: 4px;
        }
        .qr-section p {
            color: #999999;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 20px;
        }
        .qr-code {
            display: inline-block;
            background: white;
            padding: 10px;
            border-radius: 4px;
        }
        .qr-code img {
            display: block;
            width: 200px;
            height: 200px;
        }
        .event-details {
            background: #1a1a1a;
            border-left: 4px solid #ff0000;
            padding: 20px;
            margin: 30px 0;
        }
        .event-details h3 {
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 15px;
            color: #ff0000;
        }
        .event-details p {
            color: #cccccc;
            font-size: 13px;
            line-height: 1.8;
            margin-bottom: 10px;
        }
        .instructions {
            background: #1a1a1a;
            border: 1px solid #333333;
            padding: 20px;
            margin: 30px 0;
            border-radius: 4px;
        }
        .instructions h3 {
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 15px;
            color: #ff0000;
        }
        .instructions ol {
            margin-left: 20px;
            color: #cccccc;
            font-size: 13px;
            line-height: 1.8;
        }
        .instructions li {
            margin-bottom: 10px;
        }
        .footer {
            background: #0a0a0a;
            border-top: 2px solid #ff0000;
            padding: 20px;
            text-align: center;
            font-size: 12px;
            color: #666666;
        }
        .footer p {
            margin-bottom: 8px;
        }
        .social-links {
            margin-top: 10px;
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <h1>🎫 VIRUS EVENT</h1>
            <p>DEIN TICKET IST BEREIT</p>
        </div>

        <!-- Content -->
        <div class="content">
            <!-- Greeting -->
            <div class="greeting">
                <h2>Hallo ${ticketData.firstName},</h2>
                <p>danke für deine Bestellung! Hier ist dein Ticket für das VIRUS EVENT. Zeige einfach diesen QR-Code beim Einlass vor.</p>
            </div>

            <!-- Ticket Information -->
            <div class="ticket-info">
                <div class="ticket-info-row">
                    <div class="ticket-info-label">Ticket Typ</div>
                    <div class="ticket-info-value">${ticketData.tierName}</div>
                </div>
                <div class="ticket-info-row">
                    <div class="ticket-info-label">Bestellnummer</div>
                    <div class="ticket-info-value">${ticketData.id}</div>
                </div>
                <div class="ticket-info-row">
                    <div class="ticket-info-label">Email</div>
                    <div class="ticket-info-value">${ticketData.email}</div>
                </div>
            </div>

            <!-- QR Code -->
            <div class="qr-section">
                <p>Dein Ticket QR-Code</p>
                <div class="qr-code">
                    <img src="${qrCodeDataUrl}" alt="Ticket QR Code">
                </div>
                <p style="margin-top: 15px; font-size: 11px;">Bitte speichere oder drucke diesen QR-Code</p>
            </div>

            <!-- Event Details -->
            <div class="event-details">
                <h3>Event Informationen</h3>
                <p><strong>Veranstaltung:</strong> ${eventDetails.name}</p>
                <p><strong>Datum:</strong> ${eventDetails.date}</p>
                <p><strong>Uhrzeit:</strong> ${eventDetails.time}</p>
                <p><strong>Ort:</strong> ${eventDetails.location}</p>
            </div>

            <!-- Instructions -->
            <div class="instructions">
                <h3>Was kommt als nächstes?</h3>
                <ol>
                    <li>Speichere diese Email oder drucke sie aus</li>
                    <li>Speichere den QR-Code auf deinem Handy</li>
                    <li>Erscheine pünktlich vor dem Event</li>
                    <li>Zeige deinen QR-Code beim Einlass vor</li>
                    <li>Viel Spaß beim Event! 🎉</li>
                </ol>
            </div>
        </div>

        <!-- Footer -->
        <div class="footer">
            <p>© 2026 VIRUS EVENT. Alle Rechte vorbehalten.</p>
            <p>Bei Fragen: support@virus-event.de</p>
            <div class="social-links">
                <p>Follow us: Instagram | Facebook | Twitter</p>
            </div>
        </div>
    </div>
</body>
</html>
  `;
};

/**
 * Generates plain text email template
 */
const generateEmailText = (ticketData, eventDetails) => {
  return `
VIRUS EVENT - DEIN TICKET

Hallo ${ticketData.firstName},

danke für deine Bestellung! Hier sind deine Ticket-Details:

TICKET INFORMATIONEN
==================
Ticket Typ: ${ticketData.tierName}
Bestellnummer: ${ticketData.id}
Email: ${ticketData.email}
Status: Bestätigt

EVENT DETAILS
=============
Veranstaltung: ${eventDetails.name}
Datum: ${eventDetails.date}
Uhrzeit: ${eventDetails.time}
Ort: ${eventDetails.location}

NÄCHSTE SCHRITTE
================
1. Speichere diese Email
2. Zeige den QR-Code beim Einlass vor
3. Viel Spaß beim Event!

Bei Fragen kontaktiere uns: support@virus-event.de

© 2026 VIRUS EVENT
  `;
};

/**
 * Sends ticket confirmation email
 */
export const sendTicketEmail = async (ticketData, eventDetails) => {
  try {
    // Generate QR Code
    const qrCodeDataUrl = await generateTicketQRCode(ticketData);

    // Generate HTML and Text templates
    const htmlContent = generateEmailHTML(ticketData, qrCodeDataUrl, eventDetails);
    const textContent = generateEmailText(ticketData, eventDetails);

    // Send email
    const mailOptions = {
      from: process.env.SMTP_FROM || "noreply@virus-event.de",
      to: ticketData.email,
      subject: `🎫 Dein VIRUS EVENT Ticket - ${eventDetails.name}`,
      html: htmlContent,
      text: textContent,
    };

    const result = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", result.messageId);
    return result;
  } catch (error) {
    console.error("Email sending error:", error);
    throw error;
  }
};

/**
 * Sends a bulk email to multiple recipients.
 * @param {string[]} recipients - An array of email addresses.
 * @param {string} subject - The subject of the email.
 * @param {string} body - The HTML content of the email.
 */
export const sendBulkEmail = async (recipients, subject, body) => {
  console.log(`Sending bulk email to ${recipients.length} recipients...`);

  const generateNewsletterHTML = (content) => {
    return `
      <!DOCTYPE html>
      <html lang="de">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${subject}</title>
          <style>
              body { font-family: -apple-system, sans-serif; background: #1a1a1a; color: #ffffff; }
              .container { max-width: 600px; margin: 0 auto; background: #0a0a0a; border: 1px solid #333; padding: 20px; }
              .header { text-align: center; border-bottom: 1px solid #ff0000; padding-bottom: 20px; margin-bottom: 20px; }
              .content { line-height: 1.6; }
              .footer { margin-top: 30px; text-align: center; font-size: 12px; color: #666; }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header"><h1>VIRUS EVENT - NEWSLETTER</h1></div>
              <div class="content">${content}</div>
              <div class="footer"><p>&copy; 2026 VIRUS EVENT | <a href="#" style="color: #666;">Unsubscribe</a></p></div>
          </div>
      </body>
      </html>
    `;
  };

  const htmlContent = generateNewsletterHTML(body);

  const mailOptions = {
    from: process.env.SMTP_FROM || "noreply@virus-event.de",
    subject: subject,
    html: htmlContent,
  };

  const promises = recipients.map(recipient => 
    transporter.sendMail({ ...mailOptions, to: recipient })
  );

  const results = await Promise.allSettled(promises);

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`Failed to send email to ${recipients[index]}:`, result.reason);
    }
  });

  console.log("Bulk email sending process finished.");
  return results;
};


/**
 * Verify email service is working
 */
export const verifyEmailService = async () => {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    console.log("ℹ Email service skipped: No SMTP credentials in .env");
    return false;
  }

  try {
    await transporter.verify();
    console.log("✓ Email service verified and ready to send!");
    return true;
  } catch (error) {
    console.error("✗ Email service verification failed:", error);
    return false;
  }
};
