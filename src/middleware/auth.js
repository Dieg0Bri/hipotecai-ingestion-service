const { OAuth2Client } = require('google-auth-library');
const config = require('../../config');
const loggingService = require('../services/loggingService');

const client = config.googleClientId ? new OAuth2Client(config.googleClientId) : null;

const TEST_USER = {
  email: 'test@hipotecai.cl',
  sub: 'test-oauth-id-000',
  name: 'Letrado de prueba',
  email_verified: true,
};

const verifyGoogleOAuth = async (req, res, next) => {
  try {
    if (config.skipAuth || process.env.NODE_ENV === 'test') {
      req.user = TEST_USER;
      return next();
    }

    const userInfoHeader = req.headers['x-apigateway-api-userinfo'];
    const authHeader = req.headers['x-forwarded-authorization'] || req.headers['authorization'];

    if (!userInfoHeader && !authHeader) {
      return res.status(401).json({ status: 'error', code: 'NO_AUTH', message: 'Auth requerida.' });
    }

    let userInfo = null;

    if (userInfoHeader) {
      try {
        userInfo = JSON.parse(Buffer.from(userInfoHeader, 'base64').toString('utf-8'));
      } catch (err) {
        loggingService.warn('Could not decode gateway userinfo', { error: err.message });
      }
    }

    if (!userInfo && authHeader && client) {
      const token = authHeader.replace('Bearer ', '');
      try {
        const ticket = await client.verifyIdToken({ idToken: token, audience: config.googleClientId });
        const p = ticket.getPayload();
        userInfo = { sub: p.sub, email: p.email, name: p.name, picture: p.picture, email_verified: p.email_verified };
      } catch (err) {
        return res.status(401).json({ status: 'error', code: 'INVALID_TOKEN', message: 'Token inválido.' });
      }
    }

    if (!userInfo) return res.status(401).json({ status: 'error', code: 'NO_USER_INFO', message: 'Sin info usuario.' });
    req.user = userInfo;
    next();
  } catch (err) {
    loggingService.error('OAuth middleware error', { error: err.message });
    return res.status(500).json({ status: 'error', code: 'AUTH_ERROR', message: 'Error de autenticación.' });
  }
};

/**
 * Middleware para Eventarc — valida que el JWT venga de service account
 * autorizada de GCP. Para el v0 lo dejamos permisivo en local.
 */
const verifyEventarc = (req, _res, next) => {
  if (config.environment === 'development' || config.skipAuth) return next();
  // Producción: validar OIDC token del trigger Eventarc
  // (omitido en v0; se delega a la conf de Cloud Run + IAM)
  next();
};

module.exports = { verifyGoogleOAuth, verifyEventarc };
