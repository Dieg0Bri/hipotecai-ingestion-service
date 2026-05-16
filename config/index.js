const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 8083,
  environment: process.env.NODE_ENV || 'production',
  skipAuth: process.env.SKIP_AUTH === 'true',

  logLevel: process.env.LOG_LEVEL || 'info',
  serviceVersion: process.env.SERVICE_VERSION || '0.0.1',
  serviceName: 'ingestion-service',

  googleClientId: process.env.GOOGLE_CLIENT_ID,
  apiGatewayUrl: process.env.API_GATEWAY_URL,

  allowedOrigins: (process.env.ALLOWED_ORIGINS
    || 'http://localhost:3030,http://localhost:3000,http://127.0.0.1:3030').split(','),

  // GCS
  gcsBucketDocumentos: process.env.GCS_BUCKET_DOCUMENTOS || 'hipotecai-documentos',
  // Bucket separado para el .md derivado del OCR. ingestion-service firma
  // signed URLs de lectura para que el visor descargue el markdown — no lo
  // escribe, eso vive en ocr-api. La firma viene a este servicio porque acá
  // ya hay tenant scoping para el PDF original y reutilizamos el patrón.
  gcsBucketOcr: process.env.GCS_BUCKET_OCR || 'hipotecai-ocr',
  gcsSignedUrlExpirationMinutes: parseInt(process.env.GCS_SIGNED_URL_EXPIRATION_MINUTES, 10) || 15,
  maxUploadSizeBytes: parseInt(process.env.MAX_UPLOAD_SIZE_BYTES, 10) || 50 * 1024 * 1024, // 50 MB

  // Servicios aguas abajo
  estudiosServiceUrl: process.env.ESTUDIOS_SERVICE_URL || 'http://localhost:8082',

  database: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'hipotecai',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  },
};
