const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('share dialog initializes suggested titles and retains user edits', async () => {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', textContent: '', innerHTML: '', checked: true,
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {}, setAttribute() {}, querySelectorAll: () => [],
      showModal() { this.open = true; }
    });
    return nodes.get(id);
  };
  const context = vm.createContext({
    ReportInsights: require('./report-insights'),
    localStorage: { getItem: () => null },
    document: { getElementById: node, querySelector: node, querySelectorAll: () => [], addEventListener() {} },
    location: { pathname: '/analyze' },
    window: { location: { search: '' }, setTimeout() {} },
    URLSearchParams,
    fetch: async () => ({ ok: true, json: async () => ({ items: [], hasMore: false }) })
  });
  vm.runInContext(fs.readFileSync(require.resolve('./keyboard-layouts'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('./app'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  vm.runInContext(`currentAnalysis = { totalKeyDowns: 2474, topKeys: [{ key: 'Space' }] };
    currentShareDraftToken = 'test-token'; openShareDialog();`, context);
  assert.match(node('shareTitle').value, /空格.*2,474/);
  assert.equal(node('shareConsent').checked, false);
  assert.equal(node('shareDialog').open, true);
  node('shareUsageScene').value = 'programming';
  vm.runInContext('updateSuggestedShareTitle()', context);
  assert.match(node('shareTitle').value, /^编程日常/);
  node('shareTitle').value = '我的自定义标题';
  node('shareUsageScene').value = 'gaming';
  vm.runInContext('updateSuggestedShareTitle(); openShareDialog()', context);
  assert.equal(node('shareTitle').value, '我的自定义标题');
  assert.equal(node('shareUsageScene').value, 'gaming');

  vm.runInContext('renderLayoutRecommendations({ keyCounts: { F5: 10 } })', context);
  assert.match(node('layoutRecommendations').innerHTML, /75% 均衡布局/);
  assert.match(node('layoutRecommendations').innerHTML, /备选布局/);
  vm.runInContext('setAiNote({ hotZoneAdvice: "<img src=x>", cautions: ["<script>x</script>"] })', context);
  assert.equal(node('aiHotZone').textContent, '热区建议：<img src=x>');
  assert.match(node('aiCautions').innerHTML, /&lt;script&gt;/);
});
