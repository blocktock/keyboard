(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReportInsights = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const layouts = {
    '68': { label: '65% 紧凑布局', description: '保留独立方向键，缩短键盘宽度，为鼠标腾出空间。', tradeoff: '没有独立 F 区，部分导航操作需要组合键。' },
    '84': { label: '75% 均衡布局', description: '保留 F 区与方向键，兼顾常用功能和桌面空间。', tradeoff: '导航键较紧凑，购买前确认 Home、End 等键位是否保留。' },
    '87': { label: 'TKL 80% 布局', description: '独立 F 区、导航区和方向区，便于定位和切换操作。', tradeoff: '比 75% 更宽，不含数字小键盘。' },
    '108': { label: '全尺寸布局', description: '保留数字小键盘与独立导航区，减少输入方式的切换。', tradeoff: '占用更多桌面宽度，需要留意鼠标活动空间。' }
  };
  const aliases = { 'ansi-75': '84', '75': '84', '65': '68', '80': '87', tkl: '87', '104': '108', full: '108' };
  function layoutId(value) {
    const id = String(value || '').toLowerCase();
    return aliases[id] || (layouts[id] ? id : null);
  }
  function layoutLabel(value) {
    return layouts[layoutId(value)]?.label || '未标注配列';
  }
  function buildReportTitle(analysis, scene) {
    const profile = scene || analysis.usageScene || analysis.usageProfile;
    const label = { gaming: '游戏时光', typing: '办公打字', programming: '编程日常', mixed: '日常敲击', other: '键盘日记' }[profile] || '日常敲击';
    const top = analysis.topKeys?.[0]?.key || analysis.topKey;
    const key = { Space: '空格', Backspace: '退格', Enter: '回车' }[top] || top;
    const count = Math.max(0, Number(analysis.totalKeyDowns) || 0).toLocaleString('zh-CN');
    return `${label} · ${key ? `${key} 领衔的 ` : ''}${count} 次敲击`.slice(0, 80);
  }
  function displayTitle(title, analysis, scene) {
    return !title?.trim() || title.trim() === '我的 KeyPulse 报告'
      ? buildReportTitle(analysis, scene) : title;
  }
  function recommendLayouts(analysis) {
    const counts = analysis.keyCounts || Object.fromEntries((analysis.usedKeys || []).map(item => [item.key, item.count]));
    const sum = predicate => Object.entries(counts).reduce((total, [key, count]) => total + (predicate(key) ? Math.max(0, Number(count) || 0) : 0), 0);
    const numpad = sum(key => /^Num(?:[0-9.+*/-]|Enter)$/.test(key));
    const fn = sum(key => /^F(?:[1-9]|1[0-2])$/.test(key));
    const navigation = sum(key => ['Home', 'End', 'Insert', 'PageUp', 'PageDown'].includes(key));
    const arrows = sum(key => ['Up', 'Down', 'Left', 'Right'].includes(key));
    const total = sum(() => true);
    const evidence = [`数字小键盘 ${numpad} 次`, `F 区 ${fn} 次`, `导航键 ${navigation} 次`, `方向键 ${arrows} 次`];
    let primary, secondary, reason, alternativeReason;
    if (!total) {
      primary = '84'; secondary = '87';
      reason = '缺少可用的逐键统计，先提供保留功能行与方向键的均衡选择。';
      alternativeReason = '若需要完整独立导航区，可考虑 TKL；请结合实际常用键位确认。';
    } else if (numpad > 0) {
      primary = '108'; secondary = '87';
      reason = `本次使用数字小键盘 ${numpad} 次，优先保留独立数字区。`;
      alternativeReason = '若希望缩小主键盘，可选 TKL 搭配独立数字小键盘；需要额外设备与摆放空间。';
    } else if (navigation >= 20 || (navigation >= 3 && navigation / total >= 0.01)) {
      primary = '87'; secondary = '84';
      reason = `本次导航键使用 ${navigation} 次，独立导航区更便于直接定位。`;
      alternativeReason = '需要更紧凑时可考虑 75%，先确认常用导航键均有独立键位。';
    } else if (fn > 0 || navigation > 0) {
      primary = '84'; secondary = '87';
      reason = `本次 F 区使用 ${fn} 次、导航键 ${navigation} 次，建议保留功能行并核对常用导航键。`;
      alternativeReason = '偏好分区清晰、键位间距更宽松时，可考虑 TKL。';
    } else {
      primary = '68'; secondary = '84';
      reason = '本次未记录到 F 区、导航键和数字小键盘输入，可考虑保留方向键的紧凑布局。';
      alternativeReason = '若其他任务会用到 F 区，75% 布局能保留更多直接操作。';
    }
    return {
      source: 'statistics',
      primary: { id: primary, ...layouts[primary], reason },
      secondary: { id: secondary, ...layouts[secondary], reason: alternativeReason },
      evidence,
      note: '依据本次键位统计生成，不代表长期习惯。配列标记仅作参考，未记录到的键也可能用于其他任务；选购前请核对常用键位。'
    };
  }
  return { layoutId, layoutLabel, buildReportTitle, displayTitle, recommendLayouts };
});
