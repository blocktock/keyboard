const { test } = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');

test('sharing keeps custom titles, upgrades old defaults and excludes raw events', async t => {
  const original = mysql.createPool;
  const rows = [];
  mysql.createPool = () => ({
    execute: async (sql, params) => {
      if (sql.includes('CREATE TABLE')) return [];
      if (sql.includes('INSERT INTO')) {
        rows.push({ id: params[0], title: params[1], display_name: params[2], usage_scene: params[3],
          keyboard_layout: params[4], total_key_downs: params[5], used_key_count: params[6],
          load_index: params[7], load_level: params[8], usage_profile: params[9],
          top_key: params[10], top_key_count: params[11], public_snapshot: params[12], created_at: new Date() });
        return [];
      }
      return [rows.filter(row => row.id === params[0])];
    },
    query: async sql => sql.includes('COUNT(*)') ? [[{ total: rows.length }]] : [rows]
  });
  t.after(() => { mysql.createPool = original; });
  const store = require('./share-store');
  const report = { totalKeyDowns: 10, keyCounts: { F5: 10 }, topKeys: [{ key: 'F5', count: 10 }],
    usedKeys: [{ key: 'F5', count: 10 }], usedKeyCount: 1, keyboardLayout: 'ansi-75', loadIndex: 10,
    events: [{ key: 'F5', timestampMs: 123 }], timing: { startedAt: 'private', durationLabel: '1 分钟' } };
  const created = await store.createSharedReport(report, { title: '', usageScene: 'programming' });
  assert.match(rows[0].title, /^编程日常.*F5.*10/);
  const snapshot = JSON.parse(rows[0].public_snapshot);
  assert.equal(snapshot.events, undefined);
  assert.equal(snapshot.timing.startedAt, undefined);
  assert.equal(snapshot.layoutRecommendation.primary.id, '84');

  rows[0].title = '我的 KeyPulse 报告';
  delete snapshot.layoutRecommendation;
  rows[0].public_snapshot = JSON.stringify(snapshot);
  const listing = await store.listSharedReports();
  const detail = await store.getSharedReport(created.shareId);
  assert.equal(listing.items[0].title, detail.title);
  assert.match(detail.title, /^编程日常/);
  assert.equal(detail.analysis.layoutRecommendation.primary.id, '84');
  assert.equal(rows[0].title, '我的 KeyPulse 报告');

  await store.createSharedReport(report, { title: '  我的编程键盘  ', usageScene: 'programming' });
  assert.equal(rows[1].title, '我的编程键盘');
});
