const mysql = require('mysql2/promise');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { displayTitle, recommendLayouts } = require('./report-insights');

let pool;
let initialized = false;

function databaseConfig() {
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'keypulse',
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
    charset: 'utf8mb4'
  };
}

async function getPool() {
  if (!pool) pool = mysql.createPool(databaseConfig());
  if (!initialized) {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS shared_reports (
        id CHAR(36) PRIMARY KEY,
        title VARCHAR(80) NOT NULL,
        display_name VARCHAR(40) NOT NULL,
        usage_scene ENUM('gaming', 'typing', 'programming', 'mixed', 'other') NOT NULL DEFAULT 'mixed',
        keyboard_layout VARCHAR(32) NOT NULL,
        total_key_downs BIGINT UNSIGNED NOT NULL,
        used_key_count INT UNSIGNED NOT NULL,
        load_index TINYINT UNSIGNED NOT NULL,
        load_level VARCHAR(16) NOT NULL,
        usage_profile VARCHAR(24) NULL,
        top_key VARCHAR(32) NULL,
        top_key_count BIGINT UNSIGNED NULL,
        public_snapshot JSON NOT NULL,
        revoke_token_hash CHAR(64) NOT NULL,
        status ENUM('public', 'hidden', 'deleted') NOT NULL DEFAULT 'public',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_shared_reports_status_created (status, created_at),
        INDEX idx_shared_reports_scene (status, usage_scene),
        INDEX idx_shared_reports_load (status, load_index)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    initialized = true;
  }
  return pool;
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function cleanText(value, fallback, maxLength) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return (text || fallback).slice(0, maxLength);
}

function publicSnapshot(analysis) {
  const safeTiming = analysis.timing ? {
    durationLabel: analysis.timing.durationLabel || null,
    activeLabel: analysis.timing.activeLabel || null,
    kpm: analysis.timing.kpm ?? null,
    activeKpm: analysis.timing.activeKpm ?? null
  } : null;

  return {
    generatedAt: analysis.generatedAt,
    totalKeyDowns: analysis.totalKeyDowns,
    topKeys: analysis.topKeys || [],
    usedKeyCount: analysis.usedKeyCount,
    usedKeys: analysis.usedKeys || [],
    keyCounts: analysis.keyCounts || {},
    keyboardLayout: analysis.keyboardLayout || 'ansi-75',
    hasTimingData: Boolean(analysis.hasTimingData),
    loadIndex: analysis.loadIndex,
    loadLevel: analysis.loadLevel,
    averageIntervalMs: analysis.averageIntervalMs ?? null,
    intervalStats: analysis.intervalStats || null,
    timing: safeTiming,
    burst: analysis.burst || null,
    wasdSequence: analysis.wasdSequence || null,
    wasdShare: analysis.wasdShare ?? 0,
    topKeyLabel: analysis.topKeyLabel || '最高频键位',
    usageProfile: analysis.usageProfile || null,
    insight: analysis.insight || null,
    hotZoneAdvice: analysis.hotZoneAdvice || null,
    cautions: analysis.cautions || [],
    recommendation: analysis.recommendation || null,
    secondaryRecommendation: analysis.secondaryRecommendation || null,
    layoutRecommendation: recommendLayouts(analysis),
    perKeyRecommendations: analysis.perKeyRecommendations || [],
    ai: analysis.ai ? {
      provider: analysis.ai.provider,
      model: analysis.ai.model,
      generated: Boolean(analysis.ai.generated)
    } : null,
    dataWarnings: []
  };
}

function parseSnapshot(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function mapSummary(row) {
  return {
    id: row.id,
    title: displayTitle(row.title, { topKey: row.top_key, totalKeyDowns: Number(row.total_key_downs) }, row.usage_scene),
    displayName: row.display_name,
    usageScene: row.usage_scene,
    keyboardLayout: row.keyboard_layout,
    totalKeyDowns: Number(row.total_key_downs),
    usedKeyCount: Number(row.used_key_count),
    loadIndex: Number(row.load_index),
    loadLevel: row.load_level,
    usageProfile: row.usage_profile,
    topKey: row.top_key,
    topKeyCount: row.top_key_count == null ? null : Number(row.top_key_count),
    createdAt: new Date(row.created_at).toISOString()
  };
}

async function createSharedReport(analysis, input) {
  const db = await getPool();
  const id = randomUUID();
  const revokeToken = randomBytes(32).toString('hex');
  const snapshot = publicSnapshot(analysis);
  const topKey = snapshot.topKeys[0] || null;
  const allowedScenes = new Set(['gaming', 'typing', 'programming', 'mixed', 'other']);
  const usageScene = allowedScenes.has(input.usageScene) ? input.usageScene : 'mixed';
  const title = displayTitle(cleanText(input.title, '', 80), analysis, usageScene);
  const displayName = cleanText(input.displayName, '匿名用户', 40);

  await db.execute(`
    INSERT INTO shared_reports (
      id, title, display_name, usage_scene, keyboard_layout,
      total_key_downs, used_key_count, load_index, load_level,
      usage_profile, top_key, top_key_count, public_snapshot, revoke_token_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    title,
    displayName,
    usageScene,
    snapshot.keyboardLayout,
    snapshot.totalKeyDowns,
    snapshot.usedKeyCount,
    snapshot.loadIndex,
    snapshot.loadLevel || '',
    snapshot.usageProfile,
    topKey?.key || null,
    topKey?.count || null,
    JSON.stringify(snapshot),
    hashToken(revokeToken)
  ]);

  return { shareId: id, revokeToken };
}

async function listSharedReports({ page = 1, limit = 12, sort = 'latest', scene } = {}) {
  const db = await getPool();
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safeLimit = Math.min(30, Math.max(1, Math.floor(Number(limit) || 12)));
  const offset = (safePage - 1) * safeLimit;
  const clauses = ["status = 'public'"];
  const params = [];

  if (scene && ['gaming', 'typing', 'programming', 'mixed', 'other'].includes(scene)) {
    clauses.push('usage_scene = ?');
    params.push(scene);
  }

  const orderBy = sort === 'presses'
    ? 'total_key_downs DESC, created_at DESC'
    : sort === 'load'
      ? 'load_index DESC, created_at DESC'
      : 'created_at DESC';
  const where = clauses.join(' AND ');
  const [rows] = await db.query(`
    SELECT id, title, display_name, usage_scene, keyboard_layout,
      total_key_downs, used_key_count, load_index, load_level,
      usage_profile, top_key, top_key_count, created_at
    FROM shared_reports
    WHERE ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `, [...params, safeLimit, offset]);
  const [[countRow]] = await db.query(
    `SELECT COUNT(*) AS total FROM shared_reports WHERE ${where}`,
    params
  );

  return {
    items: rows.map(mapSummary),
    page: safePage,
    limit: safeLimit,
    total: Number(countRow.total),
    hasMore: offset + rows.length < Number(countRow.total)
  };
}

async function getSharedReport(id) {
  const db = await getPool();
  const [rows] = await db.execute(`
    SELECT id, title, display_name, usage_scene, created_at, public_snapshot
    FROM shared_reports
    WHERE id = ? AND status = 'public'
    LIMIT 1
  `, [id]);
  if (!rows[0]) return null;
  const analysis = parseSnapshot(rows[0].public_snapshot);
  return {
    id: rows[0].id,
    title: displayTitle(rows[0].title, analysis, rows[0].usage_scene),
    displayName: rows[0].display_name,
    usageScene: rows[0].usage_scene,
    createdAt: new Date(rows[0].created_at).toISOString(),
    analysis: { ...analysis, layoutRecommendation: recommendLayouts(analysis) }
  };
}

async function deleteSharedReport(id, revokeToken) {
  const db = await getPool();
  const [result] = await db.execute(`
    UPDATE shared_reports
    SET status = 'deleted'
    WHERE id = ? AND revoke_token_hash = ? AND status = 'public'
  `, [id, hashToken(revokeToken || '')]);
  return result.affectedRows > 0;
}

module.exports = {
  createSharedReport,
  deleteSharedReport,
  getSharedReport,
  listSharedReports
};
