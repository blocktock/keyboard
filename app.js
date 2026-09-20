let heat = {};
let currentLayoutId = localStorage.getItem('keypulse.layout') || '108';
let activeRecGroupKeys = null;

const emptyState = document.getElementById('emptyState');
const analysisPanel = document.getElementById('analysisPanel');
const keyboard = document.getElementById('keyboardLayout');
const selectReportButton = document.getElementById('selectReportButton');
const reportFileInput = document.getElementById('reportFileInput');
const uploadTitle = document.getElementById('uploadTitle');
const uploadNote = document.getElementById('uploadNote');
const uploadBanner = document.querySelector('.upload-banner');
const activitySection = document.getElementById('activitySection');
const layoutSelect = document.getElementById('layoutSelect');
const keyboardDesc = document.getElementById('keyboardDesc');
const heatmapExportCard = document.getElementById('heatmapExportCard');
const heatmapExportMeta = document.getElementById('heatmapExportMeta');
const exportFab = document.getElementById('exportFab');
const exportFabButton = document.getElementById('exportFabButton');
const exportFabMenu = document.getElementById('exportFabMenu');
const shareCurrentButton = document.getElementById('shareCurrentButton');
const shareDialog = document.getElementById('shareDialog');
const shareForm = document.getElementById('shareForm');
const shareError = document.getElementById('shareError');
const confirmShareButton = document.getElementById('confirmShareButton');
const shareSuccessDialog = document.getElementById('shareSuccessDialog');
const shareUrlInput = document.getElementById('shareUrlInput');
const copyShareUrlButton = document.getElementById('copyShareUrlButton');
const viewSharedReportButton = document.getElementById('viewSharedReportButton');
const sharedReportGrid = document.getElementById('sharedReportGrid');
const shareSceneFilter = document.getElementById('shareSceneFilter');
const shareSortFilter = document.getElementById('shareSortFilter');
const galleryMoreButton = document.getElementById('galleryMoreButton');
const sharedDetailDialog = document.getElementById('sharedDetailDialog');
const sharedDetailContent = document.getElementById('sharedDetailContent');
const deleteSharedReportButton = document.getElementById('deleteSharedReportButton');
const sharedViewBanner = document.getElementById('sharedViewBanner');
const sharedViewTitle = document.getElementById('sharedViewTitle');
const sharedViewMeta = document.getElementById('sharedViewMeta');
let currentAnalysis = null;
let currentShareDraftToken = null;
let currentSharedReportId = null;
let latestSharedReportId = null;
let galleryPage = 1;

const ANALYSIS_STORAGE_KEY = 'keypulse.analysis';
const SHARE_REVOKE_PREFIX = 'keypulse.share.revoke.';

const EXPORT_TARGETS = {
  heatmap: { selector: '#heatmapExportCard', prefix: 'keypulse-heatmap', hide: ['.layout-picker'] },
  ai: { selector: '#aiExportCard', prefix: 'keypulse-ai' },
  switches: { selector: '#switchExportCard', prefix: 'keypulse-switches' },
  full: { selector: '#analysisPanel', prefix: 'keypulse-report', hide: ['.layout-picker', '.export-fab'] }
};

function initLayoutSelect() {
  layoutSelect.innerHTML = Object.entries(KEYBOARD_LAYOUTS)
    .map(([id, layout]) => `<option value="${id}">${layout.label}</option>`)
    .join('');
  layoutSelect.value = currentLayoutId;
  layoutSelect.addEventListener('change', () => {
    currentLayoutId = layoutSelect.value;
    localStorage.setItem('keypulse.layout', currentLayoutId);
    updateLayoutMeta();
    renderKeyboard();
  });
}

function resolveLayoutId(reportLayout) {
  if (reportLayout) {
    const normalized = String(reportLayout).toLowerCase();
    if (REPORT_LAYOUT_MAP[normalized]) return REPORT_LAYOUT_MAP[normalized];
  }
  return localStorage.getItem('keypulse.layout') || '108';
}

function updateLayoutMeta() {
  const layout = KEYBOARD_LAYOUTS[currentLayoutId];
  if (!layout) return;
  keyboardDesc.textContent = layout.desc;
}

function setView(hasAnalysis) {
  emptyState.hidden = hasAnalysis;
  analysisPanel.hidden = !hasAnalysis;
  if (!hasAnalysis) exportFab.classList.add('hidden');
}

function createKeyElement(item) {
  if (item.gap) {
    const el = document.createElement('div');
    el.className = 'kb-gap';
    el.style.setProperty('--key-width', item.gap);
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  const { label, u = 1 } = item;
  const key = document.createElement('div');
  key.className = 'kb-key';
  key.style.setProperty('--key-width', u);
  const display = label.startsWith('Num') ? label.slice(3) : label === 'Space' ? '␣' : label;
  key.textContent = display;
  key.title = label;
  const stats = heat[label];
  if (stats) {
    key.dataset.heat = stats[0];
    key.dataset.count = stats[1];
  }
  return key;
}

function renderKeyRow(keys) {
  const rowEl = document.createElement('div');
  rowEl.className = 'kb-row';
  keys.forEach(item => rowEl.appendChild(createKeyElement(item)));
  return rowEl;
}

function renderSection(section) {
  const zone = document.createElement('div');
  zone.className = `kb-section kb-${section.className}`;

  if (section.type === 'rows') {
    section.rows.forEach(keys => zone.appendChild(renderKeyRow(keys)));
    return zone;
  }

  zone.classList.add('kb-grid');
  zone.style.setProperty('--grid-cols', section.grid.cols);
  zone.style.setProperty('--grid-rows', section.grid.rows);
  section.grid.cells.forEach(item => {
    const key = createKeyElement(item);
    key.style.gridColumn = `${item.col} / span ${item.w}`;
    key.style.gridRow = `${item.row} / span ${item.h}`;
    zone.appendChild(key);
  });
  return zone;
}

function renderKeyboard() {
  const layout = KEYBOARD_LAYOUTS[currentLayoutId];
  if (!layout) return;

  keyboard.innerHTML = '';
  keyboard.className = `kb-board layout-${currentLayoutId}`;

  if (layout.top.length) {
    const top = document.createElement('div');
    top.className = 'kb-top';
    layout.top.forEach(section => top.appendChild(renderSection(section)));
    keyboard.appendChild(top);
  }

  const body = document.createElement('div');
  body.className = 'kb-body';
  layout.body.forEach(section => body.appendChild(renderSection(section)));
  keyboard.appendChild(body);
  updateLayoutMeta();
  if (activeRecGroupKeys) setKeyboardGroupHighlight(activeRecGroupKeys);
}

function setKeyboardGroupHighlight(keys) {
  activeRecGroupKeys = keys;
  document.querySelectorAll('.kb-key').forEach(el => {
    const label = el.title;
    const inGroup = keys && keys.includes(label);
    el.classList.toggle('kb-key-rec-focus', Boolean(inGroup));
    el.classList.toggle('kb-key-rec-dim', Boolean(keys && !inGroup));
  });
}

function groupRecommendations(items) {
  const groups = new Map();
  for (const item of items) {
    const id = [item.switch, item.tag || '', item.specs || ''].join('::');
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        switch: item.switch,
        tag: item.tag || '—',
        specs: item.specs || '',
        reason: item.reason || '',
        keys: [],
        totalCount: 0,
        totalShare: 0
      });
    }
    const group = groups.get(id);
    group.keys.push(item);
    group.totalCount += Number(item.count) || 0;
    group.totalShare += Number(item.share) || 0;
  }

  return [...groups.values()]
    .map(group => {
      const keys = group.keys.sort((a, b) => b.count - a.count);
      return {
        ...group,
        keys,
        reason: keys.find(item => item.reason)?.reason || group.reason,
        totalShare: Number(group.totalShare.toFixed(1))
      };
    })
    .sort((a, b) => b.totalCount - a.totalCount);
}

function renderKeyDistribution(keys) {
  const max = keys[0]?.count || 1;
  return keys.map(item => `
    <div class="rec-key-row">
      <span class="table-key rec-key-label" title="${escapeAttr(item.key)}">${formatKeyLabel(item.key)}</span>
      <span class="rec-key-bar"><i style="width:${Math.round(item.count / max * 100)}%"></i></span>
      <span class="rec-key-meta">${Number(item.count).toLocaleString()} · ${item.share}%${item.p50Ms ? ` · ${item.p50Ms}ms` : ''}</span>
    </div>
  `).join('');
}

function isMissingApiKey(ai) {
  const reason = ai?.reason || '';
  return reason.includes('DEEPSEEK_API_KEY') || reason === '未配置 DEEPSEEK_API_KEY';
}

function getAiUnavailableMessage(ai) {
  if (!ai || ai.generated) return null;
  if (isMissingApiKey(ai)) return '需配置 DEEPSEEK_API_KEY 并由 AI 分析后展示';
  return ai.reason || '轴体推荐需 AI 分析后展示';
}

function renderPerKeyGroups(items, ai) {
  const container = document.getElementById('perKeyGroupList');
  const summary = document.getElementById('perKeySummary');
  setKeyboardGroupHighlight(null);

  if (!items?.length) {
    const message = ai?.generated ? '暂无轴体推荐' : getAiUnavailableMessage(ai);
    container.innerHTML = `<p class="table-empty">${message}</p>`;
    summary.textContent = ai?.generated
      ? '暂无轴体推荐'
      : (isMissingApiKey(ai) ? '轴体推荐完全由 AI 生成，请先配置 API Key' : (ai?.reason || '等待 AI 分析'));
    return;
  }

  const groups = groupRecommendations(items);
  summary.textContent = `${items.length} 个键位 · ${groups.length} 种推荐 · 点击展开查看分布`;

  container.innerHTML = groups.map((group, index) => `
    <article class="rec-group" data-group-id="${index}">
      <button class="rec-group-head" type="button" aria-expanded="false">
        <div class="rec-group-main">
          <div class="rec-group-title">
            <span class="tag ${tagClass(group.tag)}">${group.tag}</span>
            <strong>${group.switch}</strong>
            ${group.specs ? `<small>${group.specs}</small>` : ''}
          </div>
          <p class="rec-group-stats">${group.keys.length} 个键位 · ${group.totalCount.toLocaleString()} 次 · 占 ${group.totalShare}%</p>
          <p class="rec-group-preview">${group.keys.slice(0, 8).map(item => formatKeyLabel(item.key)).join(' · ')}${group.keys.length > 8 ? ' …' : ''}</p>
        </div>
        <span class="rec-group-chevron">›</span>
      </button>
      <div class="rec-group-body hidden">
        <p class="rec-group-reason">${group.reason}</p>
        <div class="rec-key-grid">${renderKeyDistribution(group.keys)}</div>
      </div>
    </article>
  `).join('');

  container.querySelectorAll('.rec-group-head').forEach(button => {
    button.addEventListener('click', () => {
      const article = button.closest('.rec-group');
      const groupId = article.dataset.groupId;
      const body = article.querySelector('.rec-group-body');
      const isOpen = !body.classList.contains('hidden');

      container.querySelectorAll('.rec-group').forEach(node => {
        node.querySelector('.rec-group-body').classList.add('hidden');
        node.querySelector('.rec-group-head').setAttribute('aria-expanded', 'false');
        node.classList.remove('is-open');
      });

      if (isOpen) {
        setKeyboardGroupHighlight(null);
        return;
      }

      body.classList.remove('hidden');
      button.setAttribute('aria-expanded', 'true');
      article.classList.add('is-open');
      const group = groups[Number(groupId)];
      setKeyboardGroupHighlight(group.keys.map(item => item.key));
      article.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  });
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatKeyLabel(key) {
  if (key === 'Space') return 'Space';
  return key;
}

function tagClass(tag) {
  if (!tag) return 'standard';
  if (/快速|轻触|游戏|银|触发/i.test(tag)) return 'fast';
  if (/静音|低噪|办公|打字/i.test(tag)) return 'quiet';
  if (/重|稳|修饰/i.test(tag)) return 'heavy';
  if (/段落|确认/i.test(tag)) return 'tactile';
  return 'standard';
}

function formatDayLabel(date) {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

function renderBarChart(container, items, labelFn) {
  const max = Math.max(...items.map(item => item.count), 1);
  container.innerHTML = `
    <div class="bar-chart">
      ${items.map(item => `
        <div class="bar-col">
          <i style="height:${Math.max(8, Math.round(item.count / max * 132))}px"></i>
          <span>${labelFn(item)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderActivityChart(timeline) {
  const container = document.getElementById('activityChart');
  const title = document.getElementById('activityChartTitle');

  if (!timeline?.data?.length || timeline.mode === 'none') {
    activitySection.classList.add('hidden');
    return;
  }

  if (timeline.mode === 'hour') {
    const activeHours = timeline.data.filter(item => item.count > 0);
    if (!activeHours.length) {
      activitySection.classList.add('hidden');
      return;
    }
    activitySection.classList.remove('hidden');
    title.textContent = '按键活跃时段（本地时区）';
    renderBarChart(container, timeline.data, item => `${String(item.hour).padStart(2, '0')}:00`);
    return;
  }

  activitySection.classList.remove('hidden');
  title.textContent = '按键活跃趋势（按天）';
  renderBarChart(container, timeline.data, item => formatDayLabel(item.date));
}

function setDataWarnings(warnings) {
  const el = document.getElementById('dataWarnings');
  if (!warnings?.length) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.classList.remove('hidden');
  el.textContent = `数据修正：${warnings.join('；')}`;
}

function renderAiOverall(recommendation, secondary) {
  const el = document.getElementById('aiOverall');
  if (!recommendation) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="overall-rec">
      <div class="overall-rec-main">
        <span class="tag ${tagClass(recommendation.tag)}">${recommendation.tag || '主推'}</span>
        <strong>${recommendation.keys}</strong>
        <p>${recommendation.switch}${recommendation.specs ? ` · ${recommendation.specs}` : ''}</p>
        <small>${recommendation.reason}</small>
      </div>
      ${secondary ? `
        <div class="overall-rec-secondary">
          <span class="tag ${tagClass(secondary.tag)}">${secondary.tag || '备选'}</span>
          <strong>${secondary.keys}</strong>
          <p>${secondary.switch}${secondary.specs ? ` · ${secondary.specs}` : ''}</p>
          <small>${secondary.reason}</small>
        </div>
      ` : ''}
    </div>
  `;
}

function setAiNote(analysis) {
  const summaryEl = document.getElementById('aiSummary');
  const hotZoneEl = document.getElementById('aiHotZone');
  const cautionsEl = document.getElementById('aiCautions');
  const noteEl = document.getElementById('aiNote');
  const badgeEl = document.getElementById('usageProfileBadge');

  summaryEl.textContent = analysis.insight || (
    analysis.ai?.generated ? '—' : (isMissingApiKey(analysis.ai)
      ? '需配置 DEEPSEEK_API_KEY 后重新上传，以生成 AI 分析与轴体推荐。'
      : '等待 AI 分析…')
  );

  if (analysis.hotZoneAdvice) {
    hotZoneEl.classList.remove('hidden');
    hotZoneEl.innerHTML = `<strong>热区建议：</strong>${analysis.hotZoneAdvice}`;
  } else {
    hotZoneEl.classList.add('hidden');
    hotZoneEl.textContent = '';
  }

  renderAiOverall(analysis.recommendation, analysis.secondaryRecommendation);

  if (analysis.usageProfile) {
    badgeEl.textContent = analysis.usageProfile === 'gaming' ? '游戏型' : analysis.usageProfile === 'typing' ? '打字型' : '混合型';
    badgeEl.classList.remove('hidden');
  } else {
    badgeEl.classList.add('hidden');
  }

  if (analysis.cautions?.length) {
    cautionsEl.classList.remove('hidden');
    cautionsEl.innerHTML = analysis.cautions.map(item => `<li>${item}</li>`).join('');
  } else {
    cautionsEl.classList.add('hidden');
    cautionsEl.innerHTML = '';
  }

  if (analysis.ai?.generated) {
    noteEl.classList.remove('hidden');
    noteEl.textContent = `轴体推荐由 DeepSeek ${analysis.ai.model || 'deepseek-v4-flash'} 生成`;
    return;
  }
  if (analysis.ai?.reason) {
    noteEl.classList.remove('hidden');
    noteEl.textContent = analysis.ai.reason;
    return;
  }
  noteEl.classList.add('hidden');
  noteEl.textContent = '';
}

function renderInputStats(analysis) {
  const summary = document.getElementById('inputStatsSummary');
  const parts = [];
  if (analysis.timing?.durationLabel) parts.push(`会话 ${analysis.timing.durationLabel}`);
  if (analysis.timing?.startedAt) {
    const start = new Date(analysis.timing.startedAt);
    parts.push(`${start.toLocaleDateString('zh-CN')} ${start.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`);
  }
  summary.textContent = parts.length ? parts.join(' · ') : '—';
}

function renderPerKeyTable(items, ai) {
  renderPerKeyGroups(items, ai);
}

function updateUploadBannerFromAnalysis(analysis) {
  resetUploadBanner();
  uploadTitle.textContent = '报告已导入';
  if (analysis.ai?.generated) {
    uploadNote.textContent = 'AI 分析已完成。使用右侧「导出」选择要保存的内容。';
    return;
  }
  if (isMissingApiKey(analysis.ai)) {
    uploadBanner.classList.add('ai-pending');
    uploadNote.textContent = '需配置 DEEPSEEK_API_KEY 并由 AI 分析后展示轴体推荐。基础统计与热力图已可用。';
    return;
  }
  uploadBanner.classList.add('ai-error');
  uploadNote.textContent = `AI 分析未完成：${analysis.ai?.reason || '未知原因'}`;
}

function updateExportMeta(analysis) {
  const layout = KEYBOARD_LAYOUTS[currentLayoutId];
  const topKey = analysis.topKeys?.[0];
  const topLabel = topKey ? `${formatKeyLabel(topKey.key)} ${topKey.count.toLocaleString()} 次` : '—';
  heatmapExportMeta.textContent = [
    `总按键 ${analysis.totalKeyDowns.toLocaleString()} · 使用键位 ${analysis.usedKeyCount}`,
    `最高频 ${topLabel} · 配列 ${layout?.label || currentLayoutId}`,
    `生成 ${new Date(analysis.generatedAt || Date.now()).toLocaleString('zh-CN')}`
  ].join(' · ');
  heatmapExportMeta.classList.remove('hidden');
}

async function exportSectionPng(targetKey) {
  if (!currentAnalysis || typeof html2canvas !== 'function') return;
  const target = EXPORT_TARGETS[targetKey];
  if (!target) return;

  const element = document.querySelector(target.selector);
  if (!element) return;

  closeExportMenu();
  exportFabButton.disabled = true;
  exportFabButton.textContent = '生成中…';
  exportFab.classList.add('hidden');

  const hidden = [];
  for (const selector of target.hide || []) {
    document.querySelectorAll(selector).forEach(node => {
      if (!node.classList.contains('hidden')) {
        node.classList.add('hidden');
        hidden.push(node);
      }
    });
  }
  if (targetKey === 'heatmap') {
    heatmapExportCard.querySelector('.keyboard-heading-actions')?.classList.add('export-capture-mode');
  }

  try {
    const canvas = await html2canvas(element, {
      backgroundColor: '#ffffff',
      scale: Math.min(2, window.devicePixelRatio || 1.5),
      useCORS: true,
      logging: false
    });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const link = document.createElement('a');
    link.download = `${target.prefix}-${stamp}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } finally {
    hidden.forEach(node => node.classList.remove('hidden'));
    heatmapExportCard.querySelector('.keyboard-heading-actions')?.classList.remove('export-capture-mode');
    exportFabButton.disabled = false;
    exportFabButton.textContent = '导出';
    exportFab.classList.remove('hidden');
  }
}

function closeExportMenu() {
  exportFabMenu.classList.add('hidden');
  exportFabButton.setAttribute('aria-expanded', 'false');
}

function toggleExportMenu() {
  const open = exportFabMenu.classList.contains('hidden');
  exportFabMenu.classList.toggle('hidden', !open);
  exportFabButton.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function usageSceneLabel(scene) {
  return {
    gaming: '游戏',
    typing: '办公打字',
    programming: '编程',
    mixed: '混合使用',
    other: '其他'
  }[scene] || '混合使用';
}

function openShareDialog() {
  closeExportMenu();
  if (!currentShareDraftToken) {
    uploadBanner.classList.add('ai-pending');
    uploadTitle.textContent = '当前报告无法分享';
    uploadNote.textContent = '分享凭证已过期或页面已刷新，请重新上传报告后再分享。';
    return;
  }
  shareError.classList.add('hidden');
  shareError.textContent = '';
  document.getElementById('shareConsent').checked = false;
  const profile = currentAnalysis?.usageProfile;
  document.getElementById('shareUsageScene').value =
    ['gaming', 'typing', 'mixed'].includes(profile) ? profile : 'mixed';
  shareDialog.showModal();
}

async function submitShare(event) {
  event.preventDefault();
  if (!currentShareDraftToken) return;
  confirmShareButton.disabled = true;
  confirmShareButton.textContent = '分享中…';
  shareError.classList.add('hidden');

  try {
    const response = await fetch('/api/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shareDraftToken: currentShareDraftToken,
        title: document.getElementById('shareTitle').value,
        displayName: document.getElementById('shareDisplayName').value,
        usageScene: document.getElementById('shareUsageScene').value,
        consent: document.getElementById('shareConsent').checked
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '分享失败');

    currentShareDraftToken = null;
    shareCurrentButton.hidden = true;
    localStorage.setItem(`${SHARE_REVOKE_PREFIX}${result.shareId}`, result.revokeToken);
    latestSharedReportId = result.shareId;
    shareUrlInput.value = new URL(result.shareUrl, window.location.origin).href;
    shareDialog.close();
    shareSuccessDialog.showModal();
    loadSharedReports({ reset: true });
  } catch (error) {
    shareError.textContent = error.message || '分享失败，请稍后重试';
    shareError.classList.remove('hidden');
  } finally {
    confirmShareButton.disabled = false;
    confirmShareButton.textContent = '匿名分享';
  }
}

function renderSharedReportCards(items, append = false) {
  const html = items.map(item => `
    <button type="button" class="shared-report-card" data-share-id="${escapeAttr(item.id)}">
      <h3>${escapeHtml(item.title)}</h3>
      <p class="shared-report-byline">${escapeHtml(item.displayName)} · ${new Date(item.createdAt).toLocaleDateString('zh-CN')}</p>
      <div class="shared-report-metrics">
        <span>总按键<strong>${Number(item.totalKeyDowns).toLocaleString()}</strong></span>
        <span>使用键位<strong>${item.usedKeyCount}</strong></span>
        <span>负载指数<strong>${item.loadIndex}</strong></span>
      </div>
      <div class="shared-report-tags">
        <span>${escapeHtml(usageSceneLabel(item.usageScene))}</span>
        <span>${escapeHtml(item.keyboardLayout)}</span>
        ${item.topKey ? `<span>高频 ${escapeHtml(formatKeyLabel(item.topKey))}</span>` : ''}
      </div>
    </button>
  `).join('');

  if (!append) sharedReportGrid.innerHTML = html;
  else sharedReportGrid.insertAdjacentHTML('beforeend', html);
  sharedReportGrid.querySelectorAll('[data-share-id]').forEach(card => {
    card.addEventListener('click', () => openSharedReport(card.dataset.shareId));
  });
}

async function loadSharedReports({ reset = false } = {}) {
  if (reset) {
    galleryPage = 1;
    sharedReportGrid.innerHTML = '<p class="gallery-status">正在加载公开报告…</p>';
  }
  const params = new URLSearchParams({
    page: String(galleryPage),
    limit: '12',
    sort: shareSortFilter.value
  });
  if (shareSceneFilter.value) params.set('scene', shareSceneFilter.value);

  try {
    const response = await fetch(`/api/shares?${params}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '加载失败');
    if (!result.items.length && galleryPage === 1) {
      sharedReportGrid.innerHTML = '<p class="gallery-status">还没有人分享报告，成为第一个分享者吧。</p>';
    } else {
      renderSharedReportCards(result.items, galleryPage > 1);
    }
    galleryMoreButton.classList.toggle('hidden', !result.hasMore);
  } catch (error) {
    if (galleryPage === 1) {
      sharedReportGrid.innerHTML = `<p class="gallery-status">${escapeHtml(error.message || '报告广场暂不可用')}</p>`;
    }
    galleryMoreButton.classList.add('hidden');
  }
}

async function openSharedReport(id) {
  if (location.pathname.startsWith('/community')) {
    location.href = `/analyze?share=${encodeURIComponent(id)}`;
    return;
  }
  try {
    const response = await fetch(`/api/shares/${encodeURIComponent(id)}`);
    const shared = await response.json();
    if (!response.ok) throw new Error(shared.error || '报告不存在');
    currentSharedReportId = shared.id;
    const analysis = shared.analysis;
    document.documentElement.classList.add('shared-report-view');
    document.title = `${shared.title} · KeyPulse 公开报告`;
    document.querySelector('.analyze-intro .eyebrow').textContent = 'PUBLIC KEYBOARD INSIGHT';
    document.querySelector('.analyze-intro > p:last-child').textContent = '这是一份由用户主动公开的脱敏分析，只展示聚合数据与洞察，不包含原始按键事件。';
    sharedViewTitle.textContent = shared.title;
    sharedViewMeta.textContent = `${shared.displayName} · ${usageSceneLabel(shared.usageScene)} · ${new Date(shared.createdAt).toLocaleString('zh-CN')}`;
    sharedViewBanner.classList.remove('hidden');
    applyAnalysis(analysis, { persist: false });
    deleteSharedReportButton.classList.toggle(
      'hidden',
      !localStorage.getItem(`${SHARE_REVOKE_PREFIX}${shared.id}`)
    );
  } catch (error) {
    uploadTitle.textContent = '无法打开分享报告';
    uploadNote.textContent = error.message;
    uploadBanner.classList.add('ai-error');
  }
}

async function deleteCurrentSharedReport() {
  if (!currentSharedReportId) return;
  const revokeToken = localStorage.getItem(`${SHARE_REVOKE_PREFIX}${currentSharedReportId}`);
  if (!revokeToken || !window.confirm('确定取消分享这份报告吗？')) return;
  const response = await fetch(`/api/shares/${encodeURIComponent(currentSharedReportId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revokeToken })
  });
  const result = await response.json();
  if (!response.ok) {
    window.alert(result.error || '取消分享失败');
    return;
  }
  localStorage.removeItem(`${SHARE_REVOKE_PREFIX}${currentSharedReportId}`);
  if (document.documentElement.classList.contains('shared-report-view')) {
    location.href = '/community';
    return;
  }
  sharedDetailDialog.close();
  loadSharedReports({ reset: true });
}

function loadStoredAnalysis() {
  try {
    const raw = localStorage.getItem(ANALYSIS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistAnalysis(analysis) {
  try {
    localStorage.setItem(ANALYSIS_STORAGE_KEY, JSON.stringify(analysis));
  } catch (error) {
    console.warn('无法保存分析结果到 localStorage', error);
  }
}

function enrichAnalysisDelta(analysis, previous) {
  if (analysis.totalDelta != null || !previous?.totalKeyDowns) return analysis;
  const prev = Number(previous.totalKeyDowns);
  if (!prev) return analysis;
  return {
    ...analysis,
    totalDelta: Number(((analysis.totalKeyDowns - prev) / prev * 100).toFixed(1))
  };
}

function applyAnalysis(analysis, {
  persist = true,
  shareDraftToken = null,
  promptShare = false
} = {}) {
  const previous = persist ? loadStoredAnalysis() : null;
  const enriched = enrichAnalysisDelta(analysis, previous);
  currentAnalysis = enriched;
  currentShareDraftToken = shareDraftToken;
  shareCurrentButton.hidden = !currentShareDraftToken;
  if (persist) persistAnalysis(enriched);
  const entries = Object.entries(enriched.keyCounts)
    .filter(([, count]) => Number.isFinite(Number(count)) && Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  const max = Number(entries[0]?.[1]) || 1;
  heat = Object.fromEntries(entries.map(([key, count]) => {
    const ratio = Number(count) / max;
    return [key, [ratio > 0.75 ? 3 : ratio > 0.4 ? 2 : 1, Number(count).toLocaleString()]];
  }));

  currentLayoutId = resolveLayoutId(enriched.keyboardLayout);
  layoutSelect.value = currentLayoutId;

renderKeyboard();
  renderInputStats(enriched);
  renderPerKeyTable(enriched.perKeyRecommendations, enriched.ai);

  document.getElementById('totalPresses').textContent = enriched.totalKeyDowns.toLocaleString();
  document.getElementById('activeKpm').textContent = enriched.timing?.activeKpm ? `${enriched.timing.activeKpm} KPM` : '—';
  document.getElementById('sessionDuration').textContent = enriched.timing?.durationLabel || '无时间戳';
  document.getElementById('usedKeyCount').textContent = String(enriched.usedKeyCount ?? entries.length);
  document.getElementById('loadIndex').textContent = `${enriched.loadIndex} / 100 · ${enriched.loadLevel || '—'}`;

  setDataWarnings(enriched.dataWarnings);
  setAiNote(enriched);
  renderActivityChart(enriched.activityTimeline);
  updateExportMeta(enriched);
  updateUploadBannerFromAnalysis(enriched);
  exportFab.classList.remove('hidden');
  setView(true);
  if (promptShare && currentShareDraftToken) {
    window.setTimeout(() => shareDialog.showModal(), 250);
  }
}

function resetUploadBanner() {
  uploadBanner.style.background = '';
  uploadBanner.classList.remove('ai-pending', 'ai-error');
}

initLayoutSelect();
exportFabButton.addEventListener('click', event => {
  event.stopPropagation();
  toggleExportMenu();
});
exportFab.addEventListener('click', event => event.stopPropagation());
exportFabMenu.querySelectorAll('[data-export]').forEach(button => {
  button.addEventListener('click', event => {
    event.stopPropagation();
    exportSectionPng(button.dataset.export);
  });
});
shareCurrentButton.addEventListener('click', openShareDialog);
shareForm.addEventListener('submit', submitShare);
document.querySelectorAll('[data-close-dialog]').forEach(button => {
  button.addEventListener('click', () => {
    document.getElementById(button.dataset.closeDialog)?.close();
  });
});
copyShareUrlButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(shareUrlInput.value);
  copyShareUrlButton.textContent = '已复制';
  window.setTimeout(() => { copyShareUrlButton.textContent = '复制链接'; }, 1200);
});
viewSharedReportButton.addEventListener('click', () => {
  shareSuccessDialog.close();
  if (latestSharedReportId) openSharedReport(latestSharedReportId);
});
deleteSharedReportButton.addEventListener('click', deleteCurrentSharedReport);
shareSceneFilter.addEventListener('change', () => loadSharedReports({ reset: true }));
shareSortFilter.addEventListener('change', () => loadSharedReports({ reset: true }));
galleryMoreButton.addEventListener('click', () => {
  galleryPage += 1;
  loadSharedReports();
});
document.addEventListener('click', () => closeExportMenu());
selectReportButton.addEventListener('click', () => reportFileInput.click());

reportFileInput.addEventListener('change', async () => {
  const file = reportFileInput.files[0];
  if (!file) return;

  if (file.size > 50 * 1024 * 1024) {
    resetUploadBanner();
    uploadTitle.textContent = '报告文件过大';
    uploadNote.textContent = '请上传不超过 50 MB 的 JSON 报告。';
    reportFileInput.value = '';
    return;
  }

  selectReportButton.disabled = true;
  selectReportButton.textContent = 'AI 分析中…';
  uploadBanner.style.background = '#1d4439';
  uploadTitle.textContent = '正在分析报告';
  uploadNote.textContent = `正在调用 AI 分析 ${file.name}…`;

  try {
    const report = JSON.parse(await file.text());
    if (!report || typeof report.keyCounts !== 'object') throw new Error('无效的报告格式');

    const response = await fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '分析失败');

    applyAnalysis(result.analysis, {
      shareDraftToken: result.shareDraftToken,
      promptShare: true
    });
    selectReportButton.textContent = '上传新报告';
  } catch (error) {
    uploadBanner.style.background = '#6b2e42';
    uploadTitle.textContent = '分析失败';
    uploadNote.textContent = error.message || '请确认服务已启动，并选择有效的 KeyPulse JSON 报告。';
    selectReportButton.textContent = '重新选择报告';
    setView(false);
  } finally {
    selectReportButton.disabled = false;
    reportFileInput.value = '';
  }
});

setView(false);

function loadStoredAnalysisOnStartup() {
  const stored = loadStoredAnalysis();
  if (stored) applyAnalysis(stored, { persist: false });
}

async function bootstrapAnalysis() {
  const startupParams = new URLSearchParams(window.location.search);
  if (startupParams.get('share')) return;
  const importToken = startupParams.get('importToken');
  if (importToken) {
    try {
      const response = await fetch(`/api/reports/import?token=${encodeURIComponent(importToken)}`);
      const result = await response.json();
      if (response.ok && result.analysis) {
        applyAnalysis(result.analysis, {
          shareDraftToken: result.shareDraftToken,
          promptShare: true
        });
        history.replaceState({}, '', window.location.pathname);
        return;
      }
    } catch {}
  }
  loadStoredAnalysisOnStartup();
}

bootstrapAnalysis();
loadSharedReports({ reset: true });

const initialShareId = new URLSearchParams(window.location.search).get('share');
if (initialShareId) {
  window.setTimeout(() => openSharedReport(initialShareId), 150);
}
