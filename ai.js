const { recommendLayouts } = require('./report-insights');

function deepSeekConfig() {
  return {
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
    model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    timeoutMs: Number(process.env.DEEPSEEK_TIMEOUT_MS || 30000)
  };
}

const SYSTEM_PROMPT = `你是 KeyPulse 键盘使用分析助手。你会收到按键统计数据与时序指标，请基于这些数字生成中文结论与轴体推荐。

要求：
1. 只能使用输入 metrics 里已有的数字和事实，不得编造按键次数、KPM、间隔或时间戳。
2. 若 hasTimingData 为 false，不要描述速率、连按、时段趋势。
3. 输出必须是合法 JSON，不要 markdown，不要额外解释。
4. 必须为 usedKeys 中的每一个键返回 keyRecommendations 条目，不得遗漏。
5. 每个 keyRecommendations 条目需包含 switch（轴体型号）、tag（简短类型标签）、specs（触发行程/压力等）、reason（推荐理由）。
6. 轴体推荐应结合该键的使用频次、占比与间隔特征，给出个性化建议。
7. 语气简洁、专业，像给用户的个性化报告。每个键的 reason 控制在 40 个汉字以内，避免重复冗长的描述。

JSON 结构：
{
  "usageProfile": "gaming | typing | mixed",
  "summary": "2-3 句总体洞察",
  "hotZoneAdvice": "热区与手感建议",
  "switchRecommendation": {
    "primary": { "keys": "...", "switch": "...", "tag": "...", "specs": "...", "reason": "..." },
    "secondary": { "keys": "...", "switch": "...", "tag": "...", "specs": "...", "reason": "..." } | null
  },
  "keyRecommendations": [
    { "key": "W", "switch": "...", "tag": "...", "specs": "...", "reason": "..." }
  ],
  "cautions": ["可选注意事项，没有则 []"]
}`;

function buildUserPrompt(analysis) {
  const metrics = {
    hasTimingData: analysis.hasTimingData,
    totalKeyDowns: analysis.totalKeyDowns,
    usedKeyCount: analysis.usedKeyCount,
    usedKeys: analysis.usedKeys,
    topKeys: analysis.topKeys,
    loadIndex: analysis.loadIndex,
    loadLevel: analysis.loadLevel,
    wasdShare: analysis.wasdShare,
    timing: analysis.timing,
    intervalStats: analysis.intervalStats,
    burst: analysis.burst,
    wasdSequence: analysis.wasdSequence,
    perKeyIntervals: analysis.perKeyIntervals,
    activityTimeline: analysis.activityTimeline,
    dataWarnings: analysis.dataWarnings
  };
  return `请基于以下 metrics 生成完整分析 JSON，并为 usedKeys 中每个键给出 keyRecommendations：\n${JSON.stringify(metrics, null, 2)}`;
}

function parseAIContent(content, usedKeyCount) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('AI 返回的分析不是完整有效的 JSON，请重试');
  }
  if (!parsed.summary || !parsed.switchRecommendation?.primary) {
    throw new Error('AI 返回结构不完整');
  }
  if (!Array.isArray(parsed.keyRecommendations) || !parsed.keyRecommendations.length) {
    throw new Error('AI 未返回逐键推荐');
  }
  if (usedKeyCount && parsed.keyRecommendations.length < usedKeyCount) {
    throw new Error(`AI 逐键推荐不完整（${parsed.keyRecommendations.length}/${usedKeyCount}）`);
  }
  return parsed;
}

function buildPerKeyFromAI(usedKeys, aiKeys) {
  const statsMap = new Map((usedKeys || []).map(item => [item.key, item]));
  return aiKeys
    .filter(item => item?.key)
    .map(ai => {
      const stats = statsMap.get(ai.key) || {};
      return {
        key: ai.key,
        count: stats.count ?? 0,
        share: stats.share ?? 0,
        p50Ms: stats.p50Ms ?? null,
        p95Ms: stats.p95Ms ?? null,
        switch: ai.switch || '—',
        tag: ai.tag || '—',
        specs: ai.specs || '',
        reason: ai.reason || '—',
        source: 'ai'
      };
    })
    .sort((a, b) => b.count - a.count);
}

function mapRecommendation(entry) {
  if (!entry) return null;
  return {
    keys: entry.keys || '—',
    switch: entry.switch || '—',
    tag: entry.tag || '—',
    specs: entry.specs || '',
    reason: entry.reason || '—'
  };
}

function applyAIAnalysis(analysis, aiResult) {
  const primary = aiResult.switchRecommendation.primary;
  const secondary = aiResult.switchRecommendation.secondary || null;

  return {
    ...analysis,
    usageProfile: aiResult.usageProfile || 'mixed',
    insight: aiResult.summary,
    hotZoneAdvice: aiResult.hotZoneAdvice || '',
    cautions: Array.isArray(aiResult.cautions) ? aiResult.cautions : [],
    perKeyRecommendations: buildPerKeyFromAI(analysis.usedKeys, aiResult.keyRecommendations),
    recommendation: mapRecommendation(primary),
    secondaryRecommendation: mapRecommendation(secondary),
    ai: {
      provider: 'deepseek',
      model: deepSeekConfig().model,
      generated: true
    }
  };
}

function emptyAIResult(analysis, reason) {
  return {
    ...analysis,
    insight: null,
    hotZoneAdvice: null,
    cautions: [],
    perKeyRecommendations: [],
    recommendation: null,
    secondaryRecommendation: null,
    ai: {
      provider: 'deepseek',
      model: deepSeekConfig().model,
      generated: false,
      reason
    }
  };
}

async function enrichWithAI(analysis) {
  analysis = { ...analysis, layoutRecommendation: recommendLayouts(analysis) };
  const { apiKey, baseURL, model, timeoutMs } = deepSeekConfig();
  if (!apiKey) {
    return emptyAIResult(analysis, '未配置 DEEPSEEK_API_KEY');
  }

  try {
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(analysis) }
        ],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        // Reserve enough output for every key, including Chinese explanations.
        max_tokens: Math.min(32768, Math.max(4096, 2048 + (analysis.usedKeys?.length || analysis.usedKeyCount || 0) * 256)),
        temperature: 0.4
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error?.message || payload.message || `DeepSeek HTTP ${response.status}`);
    }

    const choice = payload.choices?.[0];
    if (choice?.finish_reason === 'length') {
      throw new Error('AI 分析达到输出长度上限，返回内容被截断，请重试');
    }
    const content = choice?.message?.content;
    if (!content) throw new Error('DeepSeek 未返回内容');

    return applyAIAnalysis(analysis, parseAIContent(content, analysis.usedKeyCount));
  } catch (error) {
    return emptyAIResult(analysis, error.message || 'AI 分析失败');
  }
}

module.exports = { enrichWithAI };
