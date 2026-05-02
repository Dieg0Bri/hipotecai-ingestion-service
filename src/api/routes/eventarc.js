/**
 * /api-ingestion/eventarc — receptor de eventos de Cloud Storage
 * --------------------------------------------------------------
 * Cuando GCS finaliza la creación de un objeto en el bucket de
 * documentos, Eventarc invoca este endpoint con un CloudEvent. El
 * servicio cambia el estado del archivo a "clasificando" y notifica
 * al clasificador-api (vía Pub/Sub o llamada directa).
 *
 * Para v0 sólo cambia el estado en BDD; la cadena del pipeline se
 * conectará en una iteración posterior.
 */
const express = require('express');
const { pool } = require('../../config/database');
const loggingService = require('../../services/loggingService');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    // CloudEvent body: { bucket, name, ... } o { message: { data: base64(JSON) } } según el modo Pub/Sub
    let payload = req.body || {};
    if (payload.message?.data) {
      try {
        payload = JSON.parse(Buffer.from(payload.message.data, 'base64').toString());
      } catch (err) {
        loggingService.warn('Eventarc: could not decode pubsub data', { error: err.message });
      }
    }

    const bucket = payload.bucket;
    const name = payload.name; // path completo en el bucket: {folio}/{ts}_{archivo}
    if (!bucket || !name) {
      loggingService.warn('Eventarc: payload sin bucket/name', { payload });
      return res.status(204).send(); // ACK silencioso para no reintentar
    }

    loggingService.info('Eventarc trigger', { bucket, name });

    // Marcar archivo como "clasificando" para reflejar progreso
    await pool.query(
      `UPDATE dt_archivos
       SET estado_procesamiento = 'clasificando', fecha_actualizacion = NOW()
       WHERE gcs_path = $1`,
      [name]
    );

    // En iteración futura: publicar en Pub/Sub o llamar al clasificador-api
    res.status(204).send();
  } catch (err) {
    loggingService.error('Eventarc handler error', { error: err.message });
    // 204 para que GCS Eventarc no reintente indefinidamente; el log queda
    res.status(204).send();
  }
});

module.exports = router;
