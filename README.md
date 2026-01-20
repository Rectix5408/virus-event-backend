# Virus Event - Backend API

Backend API für die Virus Event Plattform.

## Installation
```bash
npm install
```

## Umgebungsvariablen

Erstelle eine `.env` Datei im Root-Verzeichnis:
```env
PORT=5000
MONGODB_URI=your_mongodb_connection_string
FRONTEND_URL=https://your-frontend-domain.com
NODE_ENV=production
JWT_SECRET=your_jwt_secret_key
```

## Entwicklung
```bash
npm run dev
```

## Production
```bash
npm start
```

## API Endpoints

- `GET /api/health` - Health Check
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Registrierung
- Weitere Endpoints siehe Code...

