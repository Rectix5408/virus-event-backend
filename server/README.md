# 🚀 VIRUS EVENT Backend Server

Express.js Backend Server für das VIRUS EVENT Ticket-Kaufsystem mit Stripe Integration und Email-Service.

## Features

- ✅ **Stripe Integration** - Sichere Zahlungen via Stripe Checkout
- ✅ **Email Service** - Automatische Ticket-Bestätigungen mit QR-Codes
- ✅ **Webhook Handler** - Verarbeitet Stripe Payment Events
- ✅ **QR Code Generation** - Eindeutige Tickets für jeden Käufer
- ✅ **CORS Enabled** - Kommunikation mit React Frontend

## Installation

```bash
cd server
npm install
```

## Environment Setup

1. Kopiere `.env` von `.env.example` (bereits vorbereitet mit Test Keys)
2. Optional: Gmail SMTP konfigurieren für Emails

### Email Setup (Optional)

Für Email-Versand mit Gmail:

1. **Google Account mit 2FA einrichten**
2. **App Password generieren:**
   - https://myaccount.google.com/apppasswords
   - Auswählen: Mail und Windows Computer
   - Generiertes Passwort kopieren

3. **In `.env` eintragen:**
```env
SMTP_USER=deine-email@gmail.com
SMTP_PASSWORD=dein-app-password
```

## Starten

### Development
```bash
npm run dev
```

Server läuft auf `http://localhost:3001`

### Production
```bash
npm start
```

## API Endpoints

### POST `/api/create-checkout-session`
Erstellt eine Stripe Checkout Session.

**Request:**
```json
{
  "tierId": "vip",
  "quantity": 2,
  "email": "user@example.com",
  "firstName": "Max",
  "lastName": "Mustermann",
  "eventId": "virus-chapter-1",
  "successUrl": "http://localhost:5173/tickets/success",
  "cancelUrl": "http://localhost:5173/tickets"
}
```

**Response:**
```json
{
  "sessionId": "cs_test_...",
  "url": "https://checkout.stripe.com/pay/cs_test_..."
}
```

### POST `/api/webhooks/stripe`
Webhook für Stripe Payment Events.

Behandelt:
- `payment_intent.succeeded` - Zahlung erfolgreich → Ticket generieren + Email senden
- `payment_intent.payment_failed` - Zahlung fehlgeschlagen
- `charge.refunded` - Rückerstattung verarbeitet

### GET `/health`
Health Check Endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-18T12:00:00.000Z"
}
```

## Funktionsweise

1. **Frontend** - Benutzer füllt Ticketformular aus
2. **Backend** - Erstellt Stripe Checkout Session via `/api/create-checkout-session`
3. **Stripe** - Benutzer zahlt über Stripe Checkout
4. **Webhook** - Stripe sendet `payment_intent.succeeded` an `/api/webhooks/stripe`
5. **Backend** - Generiert Ticket mit QR-Code und sendet Email
6. **User** - Erhält Email mit Ticket und QR-Code

## Stripe Test Daten

**Public Key:** `pk_test_51SqsVCDPFcO0nQEc9UvdpB3YQ6BMJnV02l7aZDkwA2x36hxeAqyRQmGvjLFpLIyUqaOeyC0xpU3nY5DJplshZ1KC004Uiv6OIu`

**Secret Key:** `sk_test_51SqsVCDPFcO0nQEcmNKfYLRJf04UiPAAUPMqoh46N1Qe4tuRLK05i7LQgeARibKQ5dx8d9zCEU3GcVHlcvyYO8NM00erVwldDj`

### Test Kartennummern

- ✅ **4242 4242 4242 4242** - Zahlung erfolgreich
- ❌ **4000 0000 0000 0002** - Zahlung abgelehnt
- ⚠️ **4000 0000 0000 3220** - Authentifizierung erforderlich

[Weitere Test Karten →](https://stripe.com/docs/testing)

## Struktur

```
server/
├── index.js                    # Main entry point
├── package.json
├── .env                        # Environment variables
├── .env.example
├── .gitignore
└── src/
    ├── routes/
    │   └── api.js              # API endpoints
    ├── services/
    │   ├── stripe.js           # Stripe integration
    │   └── email.js            # Email service
    └── utils/
        └── helpers.js          # Utility functions
```

## Dependencies

- **express** - Web framework
- **stripe** - Stripe SDK
- **nodemailer** - Email service
- **qrcode** - QR code generation
- **dotenv** - Environment variables
- **cors** - Cross-origin resource sharing
- **body-parser** - Request parsing

## Debugging

### Email nicht versendet?

1. **SMTP Credentials prüfen:**
   ```bash
   node -e "
   const email = require('./src/services/email.js');
   email.verifyEmailService().then(r => process.exit(r ? 0 : 1));
   "
   ```

2. **Logs prüfen:**
   - Console auf der Backend-Konsole
   - Stripe Dashboard: Events → Logs

3. **Gmail Sicherheit:**
   - [Weniger sichere Apps erlauben](https://myaccount.google.com/security) (falls 2FA nicht gesetzt)
   - Oder App Password verwenden

### Stripe Webhook testen

```bash
# Lokal testen mit Stripe CLI
stripe listen --forward-to localhost:3001/api/webhooks/stripe
stripe trigger payment_intent.succeeded
```

## Production Deployment

1. **Environment Variables setzen:**
   - `` → Production Secret Key
   - `STRIPE_WEBHOOK_SECRET` → Production Webhook Secret
   - `SMTP_*` → Production Email Credentials
   - `FRONTEND_URL` → Production Frontend URL

2. **Datenbankverbindung hinzufügen** (MongoDB/PostgreSQL)

3. **Webhook URL in Stripe Dashboard konfigurieren:**
   - Dashboard → Webhooks
   - Add endpoint
   - URL: `https://your-api.com/api/webhooks/stripe`
   - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`

4. **Server deployen:**
   ```bash
   npm run build
   npm start
   ```

## Support

Bei Fragen oder Problemen:
- Stripe Docs: https://stripe.com/docs
- Nodemailer Docs: https://nodemailer.com/
- Express Docs: https://expressjs.com/

---

**© 2026 VIRUS EVENT**
