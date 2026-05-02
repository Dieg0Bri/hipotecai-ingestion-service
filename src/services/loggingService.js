const winston = require('winston');
const config = require('../../config');

const isCloudRun = !!process.env.K_SERVICE;
const SEVERITY = { debug: 'DEBUG', info: 'INFO', warn: 'WARNING', error: 'ERROR' };

function structuredLog(level, message, metadata = {}) {
  if (isCloudRun) {
    process.stdout.write(JSON.stringify({
      severity: SEVERITY[level] || 'DEFAULT',
      message,
      service: config.serviceName,
      version: config.serviceVersion,
      timestamp: new Date().toISOString(),
      ...metadata,
    }) + '\n');
  } else {
    winstonLogger.log(level, message, metadata);
  }
}

const winstonLogger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `${timestamp} [${config.serviceName}] ${level}: ${message}${metaStr}`;
    })
  ),
  transports: [new winston.transports.Console()],
});

module.exports = {
  debug: (msg, m) => structuredLog('debug', msg, m),
  info:  (msg, m) => structuredLog('info', msg, m),
  warn:  (msg, m) => structuredLog('warn', msg, m),
  error: (msg, m) => structuredLog('error', msg, m),
  requestLogger() {
    return (req, _res, next) => {
      req.requestId = req.headers['x-cloud-trace-context']?.split('/')[0]
        || `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      next();
    };
  },
  errorLogger() {
    // eslint-disable-next-line no-unused-vars
    return (err, req, res, _next) => {
      structuredLog('error', 'Unhandled error', {
        error: err.message, stack: err.stack, method: req.method, url: req.url, requestId: req.requestId,
      });
      res.status(500).json({ status: 'error', code: 'INTERNAL_ERROR', message: 'Error interno' });
    };
  },
};
