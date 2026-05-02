const express = require('express');
const router = express.Router();
const { pool } = require('../../config/database');

router.get('/', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'success', data: { service: 'ingestion-service', database: 'ok' } });
  } catch (err) {
    res.status(503).json({ status: 'error', code: 'DB_UNAVAILABLE', data: { error: err.message } });
  }
});

module.exports = router;
