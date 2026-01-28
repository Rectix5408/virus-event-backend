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

// Bestehende Funktionen (sendTicketEmail etc.) können diese Helper-Funktion nun nutzen
// oder so bleiben wie sie sind, solange sie exportiert werden.