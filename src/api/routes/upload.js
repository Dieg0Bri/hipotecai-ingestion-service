/**
 * /api-ingestion/upload — subida directa multipart (fallback)
 * /api-ingestion/signed-upload-url — genera URL V4 PUT para subida directa frontend → GCS
 *
 * Flujo recomendado:
 *   1. frontend pide POST /signed-upload-url con folio + filename + mimeType
 *   2. frontend hace PUT al url firmado con el archivo
 *   3. Eventarc dispara el clasificador-api (lateralmente)
 *   4. frontend confirma con POST /upload/confirm para registrar en dt_archivos
 */
const express = require('express');
const multer = require('multer');
const config = require('../../../config');
const gcsService = require('../../services/gcsService');
const databaseService = require('../../services/databaseService');
const loggingService = require('../../services/loggingService');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadSizeBytes },
});

// 1) URL firmada para subida directa
router.post('/signed-upload-url', async (req, res) => {
  try {
    const { folio, filename, mime_type } = req.body;
    if (!folio || !filename) {
      return res.status(400).json({ status: 'error', code: 'MISSING_FIELDS', message: 'folio y filename son requeridos.' });
    }
    const result = await gcsService.getSignedUploadUrl(folio, filename, mime_type || 'application/pdf');
    res.status(200).json({ status: 'success', data: result });
  } catch (err) {
    loggingService.error('Signed upload URL error', { error: err.message });
    res.status(500).json({ status: 'error', code: 'SIGN_URL_FAILED', message: err.message });
  }
});

// 2) Confirmación post-upload (para registrar en BDD)
router.post('/confirm', async (req, res) => {
  try {
    const { folio, gcs_path, nombre, mime_type, size_bytes, sha256 } = req.body;
    if (!folio || !gcs_path || !nombre) {
      return res.status(400).json({ status: 'error', code: 'MISSING_FIELDS', message: 'folio, gcs_path, nombre requeridos.' });
    }

    if (sha256) {
      const dup = await databaseService.findDuplicate(folio, sha256);
      if (dup) {
        return res.status(200).json({
          status: 'success',
          data: { archivo: dup, duplicate: true },
          message: 'Archivo duplicado detectado por sha256.',
        });
      }
    }

    const archivo = await databaseService.registerArchivo({
      folio, nombre, gcsPath: gcs_path, mimeType: mime_type, sizeBytes: size_bytes, sha256,
      emailLetrado: req.user?.email,
    });

    res.status(201).json({ status: 'success', data: { archivo, duplicate: false } });
  } catch (err) {
    loggingService.error('Upload confirm error', { error: err.message });
    res.status(500).json({ status: 'error', code: 'CONFIRM_FAILED', message: err.message });
  }
});

// 3) Fallback: subida multipart directa
router.post('/', upload.single('file'), async (req, res) => {
  try {
    const folio = req.body.folio;
    if (!folio) return res.status(400).json({ status: 'error', code: 'MISSING_FOLIO', message: 'folio requerido.' });
    if (!req.file) return res.status(400).json({ status: 'error', code: 'NO_FILE', message: 'Falta el archivo.' });

    const sha256 = databaseService.hashFile(req.file.buffer);
    const dup = await databaseService.findDuplicate(folio, sha256);
    if (dup) {
      return res.status(200).json({ status: 'success', data: { archivo: dup, duplicate: true }, message: 'Duplicado.' });
    }

    const gcsResult = await gcsService.putObject(
      folio,
      req.file.originalname,
      req.file.buffer,
      req.file.mimetype
    );

    const archivo = await databaseService.registerArchivo({
      folio,
      nombre: req.file.originalname,
      gcsPath: gcsResult.gcs_path,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      sha256,
      emailLetrado: req.user?.email,
    });

    res.status(201).json({ status: 'success', data: { archivo, duplicate: false } });
  } catch (err) {
    loggingService.error('Direct upload error', { error: err.message });
    res.status(500).json({ status: 'error', code: 'UPLOAD_FAILED', message: err.message });
  }
});

module.exports = router;
