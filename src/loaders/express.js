const express = require('express');
const cors = require('cors');
const { verifyGoogleOAuth, verifyEventarc } = require('../middleware/auth');
const loggingService = require('../services/loggingService');
const config = require('../../config');

const healthRoutes = require('../api/routes/health');
const uploadRoutes = require('../api/routes/upload');
const eventarcRoutes = require('../api/routes/eventarc');

module.exports = (app) => {
  app.use(loggingService.requestLogger());

  const corsOptions = process.env.NODE_ENV === 'test' ? { origin: '*' } : {
    origin: (origin, cb) => {
      if (!origin || config.allowedOrigins.includes(origin)) return cb(null, true);
      loggingService.warn('CORS rejected', { origin });
      return cb(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
  };

  app.use(cors(corsOptions));
  app.use(express.json({ limit: '2mb' }));

  // Pública
  app.use('/api-ingestion/health', healthRoutes);

  // Eventarc (sin OAuth, lo valida verifyEventarc por OIDC)
  app.use('/api-ingestion/eventarc', verifyEventarc, eventarcRoutes);

  // Upload (OAuth)
  app.use('/api-ingestion/upload', verifyGoogleOAuth, uploadRoutes);

  app.use(loggingService.errorLogger());

  loggingService.info('ingestion-service routes registered', {
    endpoints: [
      'GET   /api-ingestion/health',
      'POST  /api-ingestion/upload                  (multipart fallback)',
      'POST  /api-ingestion/upload/signed-upload-url',
      'POST  /api-ingestion/upload/confirm',
      'POST  /api-ingestion/eventarc                (GCS trigger)',
    ],
  });
};
