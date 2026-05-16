/**
 * databaseService · registra la ingesta en dt_archivos.
 * Comparte el esquema postgres con estudios-service.
 */
const crypto = require('crypto');
const { pool } = require('../config/database');
const loggingService = require('./loggingService');

class DatabaseService {
  hashFile(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  async findEstudioIdByFolio(folio) {
    const { rows } = await pool.query(
      'SELECT id_estudio FROM dt_estudio WHERE folio = $1 AND eliminado = FALSE',
      [folio]
    );
    return rows[0]?.id_estudio || null;
  }

  async registerArchivo({
    folio, nombre, gcsPath, mimeType, sizeBytes, sha256, gcsGeneration,
    emailLetrado, tenantId,
  }) {
    if (!sha256) throw new Error('sha256 es obligatorio (auditoría legal)');

    // Resolvemos id_estudio + id_tenant en el mismo statement: si el caller
    // pasó tenantId, validamos que coincida con el dueño del estudio (defensa
    // contra cross-tenant). Si no lo pasó, tomamos el del estudio.
    const estudioQ = await pool.query(
      'SELECT id_estudio, id_tenant FROM dt_estudio WHERE folio = $1 AND eliminado = FALSE',
      [folio]
    );
    const estudio = estudioQ.rows[0];
    if (!estudio) throw new Error(`Estudio ${folio} no existe`);
    if (tenantId != null && estudio.id_tenant !== tenantId) {
      const e = new Error(`Estudio ${folio} pertenece a otro tenant`);
      e.code = 'CROSS_TENANT';
      throw e;
    }

    const sql = `
      INSERT INTO dt_archivos (
        id_tenant, id_estudio, nombre, gcs_path, mime_type, size_bytes, sha256,
        gcs_generation, sello_inmutable_at, sha256_verificado_at,
        estado_procesamiento, eliminado, fecha_subida, email_subio
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(),
              'recibido', FALSE, NOW(), $9)
      RETURNING *
    `;
    const { rows } = await pool.query(sql, [
      estudio.id_tenant, estudio.id_estudio, nombre, gcsPath, mimeType,
      sizeBytes, sha256, gcsGeneration || null, emailLetrado || null,
    ]);
    return rows[0];
  }

  /**
   * Cambia el estado de procesamiento (recibido → clasificando → clasificado → extrayendo → procesado)
   */
  async updateProcessingState(idArchivo, state, idClasificacion = null) {
    const fields = ['estado_procesamiento = $2', 'fecha_actualizacion = NOW()'];
    const params = [idArchivo, state];

    if (idClasificacion) {
      fields.push(`id_clasificacion = $${params.length + 1}`);
      params.push(idClasificacion);
    }

    const sql = `UPDATE dt_archivos SET ${fields.join(', ')} WHERE id_archivo = $1 RETURNING *`;
    const { rows } = await pool.query(sql, params);
    return rows[0];
  }

  /**
   * Lookup mínimo para validar autorización antes de firmar URLs de descarga.
   * Devuelve {id_archivo, id_estudio, id_tenant, eliminado} o null si no existe.
   */
  async findArchivoByGcsPath(gcsPath) {
    const { rows } = await pool.query(
      `SELECT id_archivo, id_estudio, id_tenant, eliminado
       FROM dt_archivos WHERE gcs_path = $1`,
      [gcsPath]
    );
    return rows[0] || null;
  }

  /**
   * Lookup del .md OCR por su URI completa (`gs://bucket/path`). Devuelve
   * el path dentro del bucket + el tenant del archivo padre para que el
   * caller decida si firma o devuelve 404.
   *
   * Hacemos JOIN a dt_archivos porque el tenant vive ahí, no en
   * dt_ocr_documento — el OCR es un artefacto derivado y hereda la
   * autorización del archivo original.
   */
  async findOcrDocumentoByGcsUri(gcsUri) {
    const { rows } = await pool.query(
      `SELECT o.gcs_path, o.gcs_bucket, a.id_archivo, a.id_tenant, a.eliminado
       FROM dt_ocr_documento o
       JOIN dt_archivos a ON a.id_archivo = o.id_archivo
       WHERE o.gcs_uri = $1`,
      [gcsUri]
    );
    return rows[0] || null;
  }

  /**
   * Detecta duplicados por sha256 dentro del mismo estudio.
   */
  async findDuplicate(folio, sha256) {
    const { rows } = await pool.query(
      `SELECT a.* FROM dt_archivos a
       INNER JOIN dt_estudio e ON e.id_estudio = a.id_estudio
       WHERE e.folio = $1 AND a.sha256 = $2 AND a.eliminado = FALSE`,
      [folio, sha256]
    );
    return rows[0] || null;
  }
}

module.exports = new DatabaseService();
