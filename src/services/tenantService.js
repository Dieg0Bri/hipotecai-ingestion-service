/**
 * tenantService · resuelve id_tenant a partir del email del usuario autenticado.
 *
 * Cache en memoria con TTL para evitar pegarle a la BBDD en cada request.
 * En v0 todos los usuarios viven en el tenant 'default' (id=1) — esto deja
 * el contrato preparado para el día que aterrice un segundo cliente.
 */
const { pool } = require('../config/database');

const TTL_MS = 5 * 60 * 1000; // 5 min
const cache = new Map(); // email → { tenantId, expiresAt }
const DEFAULT_TENANT_ID = 1;

async function resolveTenantId(email) {
  if (!email) return DEFAULT_TENANT_ID;

  const cached = cache.get(email);
  if (cached && cached.expiresAt > Date.now()) return cached.tenantId;

  try {
    const { rows } = await pool.query(
      'SELECT id_tenant FROM dt_usuarios WHERE email = $1',
      [email]
    );
    const tenantId = rows[0]?.id_tenant ?? DEFAULT_TENANT_ID;
    cache.set(email, { tenantId, expiresAt: Date.now() + TTL_MS });
    return tenantId;
  } catch {
    return DEFAULT_TENANT_ID;
  }
}

function invalidate(email) {
  if (email) cache.delete(email);
}

module.exports = { resolveTenantId, invalidate, DEFAULT_TENANT_ID };
