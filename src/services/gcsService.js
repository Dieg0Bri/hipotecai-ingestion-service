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
  });

  return {
    gcs_path: objectKey,
    gcs_uri: `gs://${config.gcsBucketDocumentos}/${objectKey}`,
    size_bytes: buffer.length,
    mime_type: mimeType,
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

module.exports = { putObject, getSignedUploadUrl, buildObjectKey };

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
