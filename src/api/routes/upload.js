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

// URL firmada de DESCARGA para que el frontend (visor PDF) lea el archivo
// directo desde GCS sin pasar por nuestro servicio. ?gcs_path=<path>
//
// SEGURIDAD: validamos que el archivo pertenezca al tenant del usuario
// autenticado antes de firmar — sin esto, conocer el `gcs_path` (vía URL,
// log o adivinanza) bastaba para descargar documentos de otro despacho.
router.get('/signed-download-url', async (req, res) => {
  try {
    const gcsPath = req.query.gcs_path;
    if (!gcsPath) {
      return res.status(400).json({ status: 'error', code: 'MISSING_GCS_PATH', message: 'gcs_path es requerido.' });
    }

    const archivo = await databaseService.findArchivoByGcsPath(String(gcsPath));
    // 404 (no 403) cuando no existe O pertenece a otro tenant: no filtramos
    // si un path existe entre tenants. La diferencia es invisible al cliente.
    if (!archivo || archivo.eliminado || archivo.id_tenant !== req.tenantId) {
      return res.status(404).json({
        status: 'error', code: 'NOT_FOUND',
        message: 'Archivo no encontrado.',
      });
    }

    const result = await gcsService.getSignedDownloadUrl(String(gcsPath));
    res.status(200).json({ status: 'success', data: result });
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: err.message });
    }
    loggingService.error('Signed download URL error', { error: err.message });
    res.status(500).json({ status: 'error', code: 'SIGN_URL_FAILED', message: err.message });
  }
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
//
// IMPORTANTE: el sha256 lo calculamos NOSOTROS desde el objeto en GCS, no
// confiamos en el que mande el cliente. Sin esto la cadena de auditoría se
// rompe (un cliente malicioso podría declarar un hash ajeno al PDF que subió).
router.post('/confirm', async (req, res) => {
  try {
    const { folio, gcs_path, nombre } = req.body;
    if (!folio || !gcs_path || !nombre) {
      return res.status(400).json({ status: 'error', code: 'MISSING_FIELDS', message: 'folio, gcs_path, nombre requeridos.' });
    }

    let meta;
    try {
      meta = await gcsService.fetchObjectMetaAndHash(gcs_path);
    } catch (err) {
      if (err.code === 'NOT_FOUND') {
        return res.status(404).json({ status: 'error', code: 'OBJECT_NOT_FOUND', message: err.message });
      }
      throw err;
    }

    const dup = await databaseService.findDuplicate(folio, meta.sha256);
    if (dup) {
      return res.status(200).json({
        status: 'success',
        data: { archivo: dup, duplicate: true },
        message: 'Archivo duplicado detectado por sha256.',
      });
    }

    const archivo = await databaseService.registerArchivo({
      folio,
      nombre,
      gcsPath: gcs_path,
      mimeType: req.body.mime_type || meta.mime_type,
      sizeBytes: meta.size_bytes,
      sha256: meta.sha256,
      gcsGeneration: meta.generation,
      emailLetrado: req.user?.email,
      tenantId: req.tenantId,
    });

    res.status(201).json({ status: 'success', data: { archivo, duplicate: false } });
  } catch (err) {
    if (err.code === 'CROSS_TENANT') {
      return res.status(403).json({ status: 'error', code: 'CROSS_TENANT', message: err.message });
    }
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
      gcsGeneration: gcsResult.generation,
      emailLetrado: req.user?.email,
      tenantId: req.tenantId,
    });

    res.status(201).json({ status: 'success', data: { archivo, duplicate: false } });
  } catch (err) {
    loggingService.error('Direct upload error', { error: err.message });
    res.status(500).json({ status: 'error', code: 'UPLOAD_FAILED', message: err.message });
  }
});

module.exports = router;
