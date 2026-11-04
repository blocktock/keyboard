const { test } = require('node:test');
const assert = require('node:assert/strict');
const { enrichWithAI } = require('./ai');

test('AI analysis handles large reports and incomplete responses', async t => {
  const originalFetch = global.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  t.after(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  });

  const usedKeys = Array.from({ length: 56 }, (_, i) => ({ key: `Key${i}`, count: 1 }));
  const analysis = { usedKeys, usedKeyCount: usedKeys.length };
  const complete = JSON.stringify({
    summary: '测试分析',
    switchRecommendation: { primary: { switch: '测试轴体' } },
    keyRecommendations: usedKeys.map(({ key }) => ({ key, switch: '测试轴体' }))
  });
  let request;
  function mockResponse(content, finishReason) {
    global.fetch = async (_url, options) => {
      request = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ choices: [{ finish_reason: finishReason, message: { content } }] })
      };
    };
  }

  await t.test('reserves output for all 56 used keys and keeps their recommendations', async () => {
    mockResponse(complete, 'stop');
    const result = await enrichWithAI(analysis);
    assert.equal(request.max_tokens, 16384);
    assert.equal(result.ai.generated, true);
    assert.equal(result.perKeyRecommendations.length, 56);
  });

  await t.test('identifies truncation before attempting JSON parsing', async () => {
    mockResponse('{"summary":"unfinished', 'length');
    const result = await enrichWithAI(analysis);
    assert.equal(result.ai.generated, false);
    assert.match(result.ai.reason, /输出长度上限.*截断/);
    assert.equal(result.usedKeys, usedKeys);
  });

  await t.test('rejects even parseable output when the provider reports truncation', async () => {
    mockResponse(complete, 'length');
    const result = await enrichWithAI(analysis);
    assert.equal(result.ai.generated, false);
    assert.match(result.ai.reason, /截断/);
  });

  await t.test('explains malformed AI JSON without blaming the uploaded report', async () => {
    mockResponse('{"summary":"unfinished', 'stop');
    const result = await enrichWithAI(analysis);
    assert.equal(result.ai.generated, false);
    assert.match(result.ai.reason, /AI 返回的分析不是完整有效的 JSON/);
  });
});
