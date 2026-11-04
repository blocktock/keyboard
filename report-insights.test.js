const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const insights = require('./report-insights');

test('titles distinguish reports and preserve custom titles', () => {
  const report = { totalKeyDowns: 2474, topKeys: [{ key: 'Space' }], usageProfile: 'typing' };
  assert.equal(insights.buildReportTitle(report), '办公打字 · 空格 领衔的 2,474 次敲击');
  assert.match(insights.buildReportTitle(report, 'programming'), /^编程日常/);
  assert.notEqual(insights.buildReportTitle(report), insights.buildReportTitle({ ...report, totalKeyDowns: 100 }));
  assert.equal(insights.displayTitle('我的 KeyPulse 报告', report), insights.buildReportTitle(report));
  assert.equal(insights.displayTitle('我的工作键盘', report), '我的工作键盘');
  assert.equal(insights.displayTitle('', report), insights.buildReportTitle(report));
});

test('layout recommendations follow actual key groups, including old reports', () => {
  for (const [keyCounts, expected] of [
    [{ A: 200, Space: 100 }, '68'],
    [{ A: 200, F12: 2 }, '84'],
    [{ A: 200, Home: 1 }, '84'],
    [{ A: 200, Home: 30 }, '87'],
    [{ A: 200, Num1: 1, Home: 1, F1: 1 }, '108'],
    [{ A: 200, NumLock: 1 }, '68']
  ]) {
    const result = insights.recommendLayouts({ keyCounts });
    assert.equal(result.primary.id, expected);
    assert.notEqual(result.secondary.id, expected);
    assert.match(result.note, /本次/);
    assert.equal(result.source, 'statistics');
  }
  const old = insights.recommendLayouts({ usedKeys: [{ key: 'F5', count: 12 }] });
  assert.equal(old.primary.id, '84');
  assert.ok(old.evidence.includes('F 区 12 次'));
  assert.equal(insights.recommendLayouts({}).primary.id, '84');
});

test('layout aliases and browser logic match the server', () => {
  assert.equal(insights.layoutId('80'), '87');
  assert.equal(insights.layoutId('ansi-75'), '84');
  assert.equal(insights.layoutId('bogus'), null);
  const browser = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('./report-insights'), 'utf8'), browser);
  assert.equal(browser.ReportInsights.buildReportTitle({ totalKeyDowns: 500 }), insights.buildReportTitle({ totalKeyDowns: 500 }));
});
