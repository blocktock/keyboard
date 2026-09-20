const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const root = __dirname;

function loadEnvFile() {
  try {
    for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

loadEnvFile();

const { enrichWithAI } = require('./ai');
const {
  createSharedReport,
  deleteSharedReport,
  getSharedReport,
  listSharedReports
} = require('./share-store');
const publicFiles = new Map([
  ['/', 'landing.html'], ['/landing.html', 'landing.html'], ['/index.html', 'landing.html'],
  ['/analyze', 'index.html'], ['/analyze.html', 'index.html'],
  ['/community', 'index.html'], ['/styles.css', 'styles.css'], ['/insight.css', 'insight.css'], ['/landing.css', 'landing.css'], ['/landing.js', 'landing.js'],
  ['/tester', 'tester.html'], ['/tester.html', 'tester.html'], ['/tester.css', 'tester.css'], ['/tester.js', 'tester.js'],
  ['/keyboard.css', 'keyboard.css'], ['/app.js', 'app.js'], ['/keyboard-layouts.js', 'keyboard-layouts.js'],
  ['/download/macos', path.join('downloads', 'KeyPulse-macOS.zip')],
  ['/html2canvas.min.js', path.join('node_modules', 'html2canvas', 'dist', 'html2canvas.min.js')]
]);

const IDLE_GAP_MS = 30_000;
const BURST_WINDOW_MS = 5_000;
const BURST_KPM_THRESHOLD = 120;
const WASD_KEYS = ['W', 'A', 'S', 'D'];
const IMPORT_TTL_MS = 5 * 60 * 1000;
const SHARE_DRAFT_TTL_MS = 30 * 60 * 1000;
const pendingImports = new Map();
const pendingShareDrafts = new Map();

function purgeExpiredImports() {
  const now = Date.now();
  for (const [token, entry] of pendingImports) {
    if (entry.expiresAt <= now) pendingImports.delete(token);
  }
}

function purgeExpiredShareDrafts() {
  const now = Date.now();
  for (const [token, entry] of pendingShareDrafts) {
    if (entry.expiresAt <= now) pendingShareDrafts.delete(token);
  }
}

function storeShareDraft(analysis) {
  purgeExpiredShareDrafts();
  const token = randomUUID();
  pendingShareDrafts.set(token, { analysis, expiresAt: Date.now() + SHARE_DRAFT_TTL_MS });
  return token;
}

function getShareDraft(token) {
  purgeExpiredShareDrafts();
  const entry = pendingShareDrafts.get(token);
  return entry && entry.expiresAt > Date.now() ? entry.analysis : null;
}

function consumeShareDraft(token) {
  const analysis = getShareDraft(token);
  if (analysis) pendingShareDrafts.delete(token);
  return analysis;
}

function storePendingImport(analysis, shareDraftToken) {
  purgeExpiredImports();
  const token = randomUUID();
  pendingImports.set(token, { analysis, shareDraftToken, expiresAt: Date.now() + IMPORT_TTL_MS });
  return token;
}

function consumePendingImport(token) {
  purgeExpiredImports();
  const entry = pendingImports.get(token);
  if (!entry || entry.expiresAt <= Date.now()) {
    pendingImports.delete(token);
    return null;
  }
  pendingImports.delete(token);
  return { analysis: entry.analysis, shareDraftToken: entry.shareDraftToken };
}

function send(res, status, body, contentType = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 50 * 1024 * 1024) throw new Error('报告不能超过 50 MB');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function keyCountsFromEvents(events) {
  const keyCounts = {};
  for (const event of events) keyCounts[event.key] = (keyCounts[event.key] || 0) + 1;
  return keyCounts;
}

function validateReport(report) {
  if (!report || typeof report !== 'object' || !report.keyCounts || typeof report.keyCounts !== 'object') {
    throw new Error('报告缺少 keyCounts');
  }

  const warnings = [];
  const declaredCounts = Object.fromEntries(Object.entries(report.keyCounts)
    .filter(([key, count]) => typeof key === 'string' && Number.isFinite(Number(count)) && Number(count) > 0)
    .map(([key, count]) => [key, Math.floor(Number(count))]));
  if (!Object.keys(declaredCounts).length) throw new Error('报告不含有效键位统计');

  const events = Array.isArray(report.events)
    ? report.events
      .filter(event => event && typeof event.key === 'string' && Number.isFinite(Number(event.timestampMs)))
      .map(event => ({ key: event.key, timestampMs: Math.round(Number(event.timestampMs)) }))
      .sort((a, b) => a.timestampMs - b.timestampMs)
    : [];

  const declaredTotal = Number(report.totalKeyDowns) || Object.values(declaredCounts).reduce((sum, count) => sum + count, 0);
  let keyCounts = declaredCounts;
  let totalKeyDowns = declaredTotal;

  if (events.length) {
    const derivedCounts = keyCountsFromEvents(events);
    const derivedTotal = events.length;
    if (derivedTotal !== declaredTotal) {
      warnings.push(`事件数 (${derivedTotal}) 与 totalKeyDowns (${declaredTotal}) 不一致，已以事件流为准`);
      totalKeyDowns = derivedTotal;
      keyCounts = derivedCounts;
    } else {
      for (const [key, count] of Object.entries(derivedCounts)) {
        if ((declaredCounts[key] || 0) !== count) {
          warnings.push('keyCounts 与 events 聚合不一致，已以事件流为准');
          keyCounts = derivedCounts;
          break;
        }
      }
    }
  }

  const startedAt = report.startedAt ? new Date(report.startedAt).toISOString() : null;
  const endedAt = report.endedAt ? new Date(report.endedAt).toISOString() : null;

  return {
    schemaVersion: report.schemaVersion || 1,
    startedAt,
    endedAt,
    keyboardLayout: report.keyboardLayout || 'ansi-75',
    keyCounts,
    events,
    totalKeyDowns,
    hasTimingData: events.length >= 2,
    dataWarnings: warnings
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return Math.round(sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower));
}

function localDateKey(timestampMs) {
  const date = new Date(timestampMs);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function effectiveIntervals(events) {
  const intervals = [];
  for (let index = 1; index < events.length; index += 1) {
    const gap = events[index].timestampMs - events[index - 1].timestampMs;
    if (gap >= 0 && gap <= IDLE_GAP_MS) intervals.push(gap);
  }
  return intervals;
}

function intervalStats(intervals) {
  if (!intervals.length) return null;
  const sorted = [...intervals].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    meanMs: Math.round(total / sorted.length),
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    sampleSize: sorted.length
  };
}

function perKeyIntervalStats(events, keys) {
  return keys.map(key => {
    const timestamps = events.filter(event => event.key === key).map(event => event.timestampMs);
    const intervals = [];
    for (let index = 1; index < timestamps.length; index += 1) {
      const gap = timestamps[index] - timestamps[index - 1];
      if (gap >= 0 && gap <= IDLE_GAP_MS) intervals.push(gap);
    }
    const stats = intervalStats(intervals);
    return stats ? { key, ...stats } : null;
  }).filter(Boolean);
}

function sessionTiming(report, events) {
  let durationMs = null;
  if (report.startedAt && report.endedAt) {
    durationMs = Math.max(0, new Date(report.endedAt).getTime() - new Date(report.startedAt).getTime());
  } else if (events.length >= 2) {
    durationMs = events[events.length - 1].timestampMs - events[0].timestampMs;
  }

  let activeMs = 0;
  for (let index = 1; index < events.length; index += 1) {
    const gap = events[index].timestampMs - events[index - 1].timestampMs;
    if (gap >= 0 && gap <= IDLE_GAP_MS) activeMs += gap;
  }

  const kpm = durationMs && durationMs > 0 ? Number((events.length / (durationMs / 60000)).toFixed(1)) : null;
  const activeKpm = activeMs > 0 ? Number((events.length / (activeMs / 60000)).toFixed(1)) : null;

  return {
    startedAt: report.startedAt,
    endedAt: report.endedAt,
    durationMs,
    activeMs: events.length >= 2 ? activeMs : null,
    kpm,
    activeKpm
  };
}

function activityByHour(events) {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  for (const event of events) buckets[new Date(event.timestampMs).getHours()].count += 1;
  return buckets;
}

function activityByDay(events) {
  const buckets = new Map();
  for (const event of events) {
    const day = localDateKey(event.timestampMs);
    buckets.set(day, (buckets.get(day) || 0) + 1);
  }
  return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count }));
}

function activityTimeline(events) {
  if (!events.length) return { mode: 'none', data: [] };
  const days = new Set(events.map(event => localDateKey(event.timestampMs)));
  if (days.size <= 1) return { mode: 'hour', data: activityByHour(events) };
  return { mode: 'day', data: activityByDay(events) };
}

function burstAnalysis(events) {
  if (events.length < 2) return { peakKpm: null, burstEpisodes: 0, thresholdKpm: BURST_KPM_THRESHOLD };

  let peakKpm = 0;
  let burstEpisodes = 0;
  let previousBurst = false;

  for (let start = 0; start < events.length; start += 1) {
    let end = start;
    while (end < events.length && events[end].timestampMs - events[start].timestampMs <= BURST_WINDOW_MS) end += 1;
    const count = end - start;
    const kpm = Number((count / (BURST_WINDOW_MS / 60000)).toFixed(1));
    if (kpm > peakKpm) peakKpm = kpm;
    const isBurst = kpm >= BURST_KPM_THRESHOLD;
    if (isBurst && !previousBurst) burstEpisodes += 1;
    previousBurst = isBurst;
  }

  return { peakKpm, burstEpisodes, thresholdKpm: BURST_KPM_THRESHOLD };
}

function wasdSequenceAnalysis(events) {
  const wasd = new Set(WASD_KEYS);
  let wasdPresses = 0;
  let directionChanges = 0;
  let previousWasd = null;

  for (const event of events) {
    if (!wasd.has(event.key)) continue;
    wasdPresses += 1;
    if (previousWasd && previousWasd !== event.key) directionChanges += 1;
    previousWasd = event.key;
  }

  return {
    wasdPresses,
    directionChanges,
    changeRate: wasdPresses > 1 ? Number((directionChanges / (wasdPresses - 1) * 100).toFixed(1)) : 0
  };
}

function buildUsedKeys(report, events) {
  const total = report.totalKeyDowns;
  const intervalMap = new Map(
    perKeyIntervalStats(events, Object.keys(report.keyCounts)).map(item => [item.key, item])
  );

  return Object.entries(report.keyCounts)
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => {
      const share = total ? Number((count / total * 100).toFixed(1)) : 0;
      const interval = intervalMap.get(key);
      return {
        key,
        count,
        share,
        p50Ms: interval?.p50Ms ?? null,
        p95Ms: interval?.p95Ms ?? null
      };
    });
}

function computeLoadIndex({ total, wasdShare, timing, burst }) {
  const volume = Math.min(35, Math.log10(total + 1) * 12);
  const movement = Math.min(35, wasdShare * 0.7);
  const speed = Math.min(30, (timing?.activeKpm || 0) * 0.18 + (burst?.peakKpm || 0) * 0.05);
  return Math.min(100, Math.round(volume + movement + speed));
}

function formatDuration(ms) {
  if (ms === null || ms === undefined) return null;
  if (ms < 60000) return `${Math.round(ms / 1000)} 秒`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
}

function analyse(report, previousTotal = null) {
  const keys = Object.entries(report.keyCounts).sort((a, b) => b[1] - a[1]);
  const total = report.totalKeyDowns;
  const top = keys.slice(0, 5).map(([key, count]) => ({ key, count, share: Number((count / total * 100).toFixed(1)) }));
  const wasd = WASD_KEYS.reduce((sum, key) => sum + (report.keyCounts[key] || 0), 0);
  const wasdShare = total ? Number((wasd / total * 100).toFixed(1)) : 0;
  const events = report.events.slice().sort((a, b) => a.timestampMs - b.timestampMs);

  const intervals = effectiveIntervals(events);
  const timing = sessionTiming(report, events);
  const intervalSummary = intervalStats(intervals);
  const burst = burstAnalysis(events);
  const wasdSeq = wasdSequenceAnalysis(events);
  const timeline = activityTimeline(events);
  const movementHeavy = wasdShare >= 15;
  const loadIndex = computeLoadIndex({ total, wasdShare, timing, burst });
  const loadLevel = loadIndex >= 70 ? '偏高' : loadIndex >= 40 ? '适中' : '偏低';
  const usedKeys = buildUsedKeys(report, events);
  const totalDelta = previousTotal && previousTotal > 0 ? Number(((total - previousTotal) / previousTotal * 100).toFixed(1)) : null;

  return {
    generatedAt: new Date().toISOString(),
    totalKeyDowns: total,
    topKeys: top,
    usedKeyCount: keys.length,
    usedKeys,
    keyCounts: report.keyCounts,
    keyboardLayout: report.keyboardLayout || 'ansi-75',
    hasTimingData: report.hasTimingData,
    dataWarnings: report.dataWarnings || [],
    loadIndex,
    loadLevel,
    totalDelta,
    averageIntervalMs: intervalSummary?.p50Ms ?? null,
    intervalStats: intervalSummary,
    perKeyIntervals: perKeyIntervalStats(events, [...WASD_KEYS, 'Space', 'Enter'].filter(key => report.keyCounts[key])),
    timing: {
      ...timing,
      durationLabel: formatDuration(timing.durationMs),
      activeLabel: formatDuration(timing.activeMs)
    },
    burst,
    wasdSequence: wasdSeq,
    activityTimeline: timeline,
    wasdShare,
    topKeyLabel: movementHeavy && top[0] && WASD_KEYS.includes(top[0].key) ? '游戏移动键' : '最高频键位'
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'POST' && requestUrl.pathname === '/api/reports') {
      const report = validateReport(await readBody(req));
      const analysis = await enrichWithAI(analyse(report, null));
      const shareDraftToken = storeShareDraft(analysis);
      const importToken = storePendingImport(analysis, shareDraftToken);
      return send(res, 201, {
        reportId: randomUUID(),
        analysis,
        importToken,
        shareDraftToken
      });
    }
    if (req.method === 'GET' && requestUrl.pathname === '/api/reports/import') {
      const token = requestUrl.searchParams.get('token');
      if (!token) return send(res, 400, { error: '缺少 import token' });
      const imported = consumePendingImport(token);
      if (!imported) return send(res, 404, { error: '导入链接无效或已过期' });
      return send(res, 200, imported);
    }
    if (req.method === 'POST' && requestUrl.pathname === '/api/shares') {
      const body = await readBody(req);
      if (body.consent !== true) return send(res, 400, { error: '分享前必须确认公开数据范围' });
      const analysis = getShareDraft(body.shareDraftToken);
      if (!analysis) return send(res, 404, { error: '分享凭证无效或已过期，请重新上传报告' });
      const created = await createSharedReport(analysis, body);
      consumeShareDraft(body.shareDraftToken);
      return send(res, 201, {
        ...created,
        shareUrl: `/?share=${created.shareId}`
      });
    }
    if (req.method === 'GET' && requestUrl.pathname === '/api/shares') {
      const result = await listSharedReports({
        page: requestUrl.searchParams.get('page'),
        limit: requestUrl.searchParams.get('limit'),
        sort: requestUrl.searchParams.get('sort'),
        scene: requestUrl.searchParams.get('scene')
      });
      return send(res, 200, result);
    }
    const shareMatch = requestUrl.pathname.match(/^\/api\/shares\/([0-9a-f-]{36})$/i);
    if (shareMatch && req.method === 'GET') {
      const shared = await getSharedReport(shareMatch[1]);
      return shared ? send(res, 200, shared) : send(res, 404, { error: '分享报告不存在' });
    }
    if (shareMatch && req.method === 'DELETE') {
      const body = await readBody(req);
      const deleted = await deleteSharedReport(shareMatch[1], body.revokeToken);
      return deleted
        ? send(res, 200, { deleted: true })
        : send(res, 403, { error: '无权取消该分享或报告已删除' });
    }
    if (req.method === 'GET' && publicFiles.has(requestUrl.pathname)) {
      const fileName = publicFiles.get(requestUrl.pathname);
      const filePath = fileName.includes(path.sep) ? path.join(root, fileName) : path.join(root, fileName);
      const contentType = fileName.endsWith('.css') ? 'text/css; charset=utf-8'
        : fileName.endsWith('.js') ? 'text/javascript; charset=utf-8'
          : fileName.endsWith('.zip') ? 'application/zip'
          : 'text/html; charset=utf-8';
      return send(res, 200, await fsp.readFile(filePath), contentType);
    }
    send(res, 404, { error: 'Not found' });
  } catch (error) {
    const databaseError = ['ECONNREFUSED', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR'].includes(error.code);
    send(res, databaseError ? 503 : 400, {
      error: databaseError ? '分享服务暂不可用，请检查 MySQL 配置' : (error.message || '无法处理请求')
    });
  }
});

const port = Number(process.env.PORT || 3011);
const host = process.env.HOST || '127.0.0.1';
server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`KeyPulse 启动失败：端口 ${port} 已被占用。`);
    console.error('请先结束旧进程，例如：lsof -nP -iTCP:3011 -sTCP:LISTEN 然后 kill <PID>');
    process.exit(1);
  }
  throw error;
});
server.listen(port, host, () => console.log(`KeyPulse web service: http://${host}:${port}`));
