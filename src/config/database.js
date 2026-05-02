const { Pool } = require('pg');
const config = require('../../config');
const loggingService = require('../services/loggingService');

const isCloudRun = !!process.env.K_SERVICE;
const instanceConnectionName = process.env.INSTANCE_CONNECTION_NAME;

const dbConfig = isCloudRun && instanceConnectionName
  ? {
      host: `/cloudsql/${instanceConnectionName}`,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database,
      max: 5,
    }
  : { ...config.database, max: 10 };

const pool = new Pool(dbConfig);
pool.on('error', (err) => loggingService.error('pg pool error', { error: err.message }));

async function testConnection() {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    loggingService.info('PostgreSQL ok');
  } catch (err) {
    loggingService.error('PostgreSQL failed', { error: err.message });
    if (config.environment === 'production') throw err;
  }
}

module.exports = { pool, testConnection };
