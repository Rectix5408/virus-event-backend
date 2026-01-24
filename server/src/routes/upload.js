import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { protect } from './auth.js';

// Fix für __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Stelle sicher, dass Upload-Verzeichnisse existieren
const ensureUploadDirectory = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

// Konfiguriere Speicher für verschiedene Upload-Typen
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const entity = req.params.entity || 'general';
    const uploadPath = path.join(__dirname, '../../uploads', entity);
    ensureUploadDirectory(uploadPath);
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const entity = req.params.entity || 'general';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const sanitizedOriginalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${entity}-${uniqueSuffix}-${sanitizedOriginalName}`);
  }
});

// Filter für Dateitypen
const fileFilter = (req, file, cb) => {
  const allowedTypes = {
    image: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
    document: ['application/pdf', 'text/plain', 'application/msword'],
    video: ['video/mp4', 'video/webm', 'video/ogg'],
    audio: ['audio/mpeg', 'audio/wav', 'audio/ogg']
  };

  const uploadType = req.query.type || 'image';
  const allowedMimeTypes = allowedTypes[uploadType] || allowedTypes.image;

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Ungültiger Dateityp. Erlaubt: ${allowedMimeTypes.join(', ')}`), false);
  }
};

// Größenbeschränkungen
const limits = {
  fileSize: 10 * 1024 * 1024, // 10MB Standard
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: limits
});

// Universeller Upload-Endpunkt
router.post('/:entity', protect, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ message: `Upload Fehler: ${err.message}` });
    } else if (err) {
      return res.status(500).json({ message: `Server Fehler: ${err.message}` });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'Keine Datei hochgeladen.' });
    }
    next();
  });
}, (req, res) => {

  const fileUrl = `/uploads/${req.params.entity}/${req.file.filename}`;
  const fileInfo = {
    url: fileUrl,
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
    entity: req.params.entity,
    uploadedAt: new Date().toISOString()
  };

  res.status(201).json(fileInfo);
});

// Mehrere Dateien hochladen
router.post('/:entity/multiple', protect, upload.array('files', 10), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ message: 'Keine Dateien hochgeladen.' });
  }

  const files = req.files.map(file => ({
    url: `/uploads/${req.params.entity}/${file.filename}`,
    filename: file.filename,
    originalName: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    entity: req.params.entity,
    uploadedAt: new Date().toISOString()
  }));

  res.status(201).json({ files });
});

// Datei löschen
router.delete('/:entity/:filename', protect, (req, res) => {
  const { entity, filename } = req.params;
  const filePath = path.join(__dirname, '../../uploads', entity, filename);

  fs.unlink(filePath, (err) => {
    if (err) {
      if (err.code === 'ENOENT') {
        return res.status(200).json({ message: 'Datei war bereits gelöscht.' });
      }
      return res.status(500).json({ message: 'Fehler beim Löschen der Datei.' });
    }
    res.json({ message: 'Datei erfolgreich gelöscht.' });
  });
});

// Dateiinformationen abrufen
router.get('/:entity/:filename/info', protect, (req, res) => {
  const { entity, filename } = req.params;
  const filePath = path.join(__dirname, '../../uploads', entity, filename);

  fs.stat(filePath, (err, stats) => {
    if (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ message: 'Datei nicht gefunden.' });
      }
      return res.status(500).json({ message: 'Fehler beim Abrufen der Dateiinformationen.' });
    }

    res.json({
      filename: filename,
      entity: entity,
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      url: `/uploads/${entity}/${filename}`
    });
  });
});

export default router;