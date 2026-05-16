/**
 * gcsService · cliente de Cloud Storage
 * --------------------------------------------------------------
 *  · putObject       — sube buffer al bucket
 *  · getSignedUploadUrl — emite URL firmada V4 PUT (frontend upload directo)
 *  · buildObjectKey  — convención de paths: {folio}/{ts}_{nombre}
 */
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const config = require('../../config');
const loggingService = require('./loggingService');

let storage;
try {
  storage = new Storage();
} catch (err) {
  loggingService.warn('GCS init failed (esperable sin ADC)', { error: err.message });
}

function buildObjectKey(folio, originalName) {
  const safe = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const ts = Date.now();
  return `${folio}/${ts}_${safe}`;
}

async function putObject(folio, originalName, buffer, mimeType) {
  if (!storage) throw new Error('GCS no inicializado.');

  const objectKey = buildObjectKey(folio, originalName);
  const file = storage.bucket(config.gcsBucketDocumentos).file(objectKey);

  // ifGenerationMatch: 0 → falla si ya existe un objeto con esta key.
  // Combinado con object versioning y retention en el bucket, esto convierte la
  // ingesta en write-once para auditoría legal.
  await file.save(buffer, {
    contentType: mimeType,
    metadata: {
      metadata: {
        folio,
        originalName,
        uploadedAt: new Date().toISOString(),
      },
    },
    resumable: false,
    preconditionOpts: { ifGenerationMatch: 0 },
  });

  // Refresh metadata para capturar el `generation` que GCS asignó.
  const [meta] = await file.getMetadata();

  return {
    gcs_path: objectKey,
    gcs_uri: `gs://${config.gcsBucketDocumentos}/${objectKey}`,
    size_bytes: buffer.length,
    mime_type: mimeType,
    generation: meta.generation ? String(meta.generation) : null,
  };
}

/**
 * Para flujos por signed-upload-url: el cliente subió el archivo, nosotros
 * sólo conocemos el path. Descargamos para hashear server-side y leer el
 * `generation`. Esencial para inmutabilidad: el sha256 que el cliente declara
 * por su lado NO es confiable.
 */
async function fetchObjectMetaAndHash(gcsPath) {
  if (!storage) throw new Error('GCS no inicializado.');
  const crypto = require('crypto');
  const file = storage.bucket(config.gcsBucketDocumentos).file(gcsPath);

  const [exists] = await file.exists();
  if (!exists) {
    const e = new Error(`Objeto no existe: ${gcsPath}`);
    e.code = 'NOT_FOUND';
    throw e;
  }

  const [meta] = await file.getMetadata();
  const [buf] = await file.download();
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

  return {
    gcs_path: gcsPath,
    sha256,
    size_bytes: buf.length,
    mime_type: meta.contentType || null,
    generation: meta.generation ? String(meta.generation) : null,
  };
}

async function getSignedUploadUrl(folio, originalName, mimeType) {
  if (!storage) throw new Error('GCS no inicializado.');

  const objectKey = buildObjectKey(folio, originalName);
  const file = storage.bucket(config.gcsBucketDocumentos).file(objectKey);

  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    contentType: mimeType,
    expires: Date.now() + config.gcsSignedUrlExpirationMinutes * 60 * 1000,
  });

  return {
    upload_url: url,
    gcs_path: objectKey,
    gcs_uri: `gs://${config.gcsBucketDocumentos}/${objectKey}`,
    expires_in: config.gcsSignedUrlExpirationMinutes * 60,
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
  };
}

// Signed URL de READ para que el frontend descargue el PDF directo desde GCS.
// 1 hora de validez. El SA del ingestion-service necesita storage.objectViewer.
async function getSignedDownloadUrl(gcsPath) {
  if (!storage) throw new Error('GCS no inicializado.');
  const file = storage.bucket(config.gcsBucketDocumentos).file(gcsPath);
  const [exists] = await file.exists();
  if (!exists) {
    const e = new Error(`Objeto no existe: ${gcsPath}`);
    e.code = 'NOT_FOUND';
    throw e;
  }
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + 60 * 60 * 1000,
  });
  return { download_url: url, gcs_path: gcsPath, expires_in: 3600 };
}

// Signed URL de READ para el .md OCR (bucket separado de los PDFs originales).
// Recibe el path dentro del bucket OCR — el caller ya validó que la URI
// pertenezca a este bucket y que el archivo padre sea del tenant del usuario.
async function getSignedDownloadUrlOcr(ocrPath) {
  if (!storage) throw new Error('GCS no inicializado.');
  const file = storage.bucket(config.gcsBucketOcr).file(ocrPath);
  const [exists] = await file.exists();
  if (!exists) {
    const e = new Error(`Objeto no existe: ${ocrPath}`);
    e.code = 'NOT_FOUND';
    throw e;
  }
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + 60 * 60 * 1000,
  });
  return { download_url: url, gcs_path: ocrPath, expires_in: 3600 };
}

module.exports = {
  putObject,
  getSignedUploadUrl,
  getSignedDownloadUrl,
  getSignedDownloadUrlOcr,
  fetchObjectMetaAndHash,
  buildObjectKey,
};

// Helper: extensión a partir de mimetype para fallback
function _ext(mimeType, originalName) {
  const ext = path.extname(originalName);
  if (ext) return ext;
  if (mimeType?.includes('pdf')) return '.pdf';
  if (mimeType?.includes('jpeg')) return '.jpg';
  if (mimeType?.includes('png')) return '.png';
  return '.bin';
}
module.exports._ext = _ext;
