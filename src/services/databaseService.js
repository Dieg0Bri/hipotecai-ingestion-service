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

  async registerArchivo({ folio, nombre, gcsPath, mimeType, sizeBytes, sha256, emailLetrado }) {
    const idEstudio = await this.findEstudioIdByFolio(folio);
    if (!idEstudio) throw new Error(`Estudio ${folio} no existe`);

    const sql = `
      INSERT INTO dt_archivos (
        id_estudio, nombre, gcs_path, mime_type, size_bytes, sha256,
        estado_procesamiento, eliminado, fecha_subida, email_subio
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'recibido', FALSE, NOW(), $7)
      RETURNING *
    `;
    const { rows } = await pool.query(sql, [
      idEstudio, nombre, gcsPath, mimeType, sizeBytes, sha256, emailLetrado || null,
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
