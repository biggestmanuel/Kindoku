/**
 * Opt-in contract tests against the real Groq API.
 *
 * The handler falls back to the direct AniList engine when Groq fails, and that
 * engine is fully functional. So a dead, retired, quota-exhausted or
 * contract-changed AI stage produces responses that look completely healthy.
 * That is exactly how both configured models could be retired for seven weeks
 * with nothing but a green test suite to show for it.
 *
 * These tests exercise the AI stage for real, so they are the only ones that can
 * catch that class of failure. They run automatically when a key is present and
 * are skipped otherwise:
 *
 *   GROQ_API_KEY=gsk_... npm test          # runs them
 *   npm test                                # skips them
 *
 * Reads nothing private: the prompt is the same one production sends, and the
 * assertions only look at what comes back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import handler from '../api/recommend.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = (process.env.GROQ_API_KEY || '').trim();
const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';

const options = {
  skip: KEY
    ? false
    : 'set GROQ_API_KEY to run the live Groq contract tests',
};

function configuredModels() {
  const source = readFileSync(resolve(REPO_ROOT, 'api/recommend.js'), 'utf8');
  const match = source.match(/const GROQ_MODELS\s*=\s*\[([^\]]*)\]/);
  assert.ok(match, 'GROQ_MODELS is no longer a literal array');
  return [...match[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
}

function createRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}

/**
 * Call the real handler against the real APIs. No fetch stubbing anywhere, so
 * this covers the prompt, the request parameters, the JSON parsing, the AniList
 * verification, and the fallback ordering together.
 */
async function search(searchInput) {
  const res = createRes();
  await handler({ method: 'POST', body: { mode: 'search', searchInput }, headers: {}, socket: {} }, res);
  return res;
}

test('Groq is reachable with this key', options, async () => {
  const res = await fetch(GROQ_MODELS_URL, {
    headers: { Authorization: `Bearer ${KEY}` },
    signal: AbortSignal.timeout(20_000),
  });

  assert.equal(res.ok, true,
    `Groq rejected the key with HTTP ${res.status}. ` +
    'If this is 401 the key is invalid; if 403 it lacks access to these models.');

  const json = await res.json();
  const served = new Set((json.data || []).map(m => m.id));
  assert.ok(served.size > 0, 'Groq returned an empty catalogue');

  for (const model of configuredModels()) {
    assert.ok(
      served.has(model),
      `"${model}" is configured but Groq does not serve it to this key. ` +
      `This key can use: ${[...served].join(', ')}. ` +
      'Every request falls back to AniList while this is true.'
    );
  }
});

test('every configured model answers with usable content', options, async () => {
  // A model can be listed and still reject the parameters this code sends, or
  // run out of tokens before answering. Both leave the content field empty.
  for (const model of configuredModels()) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
        temperature: 0.8,
        max_tokens: 3000,
        reasoning_effort: 'low',
        include_reasoning: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    assert.equal(res.ok, true,
      `"${model}" rejected the request with HTTP ${res.status}: ` +
      `${(await res.text()).slice(0, 200)}`);

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    assert.ok(typeof content === 'string' && content.trim().length > 0,
      `"${model}" returned no content; finish_reason was ` +
      `${data?.choices?.[0]?.finish_reason}. Reasoning tokens count against ` +
      'max_tokens, so an exhausted budget is indistinguishable from a refusal ' +
      'unless this is checked.');
  }
});

test('the AI stage answers a real search end to end', options, async () => {
  // The headline assertion: the feature works, not just the key. It covers the
  // prompt asking for JSON, the parser, and AniList verification of whatever the
  // model hallucinated.
  const res = await search(`Solo Leveling ${Math.floor(Math.random() * 1e6)}`);

  assert.equal(res.statusCode, 200);
  assert.ok(
    String(res.body.model || '').startsWith('Groq'),
    `the AI stage produced nothing: the response came from ` +
    `"${res.body.model}". Every configured model failed. Read the handler's ` +
    '[kindoku] groq failed log line for the reason.'
  );

  const recs = res.body.recommendations;
  assert.ok(Array.isArray(recs) && recs.length > 0,
    'the AI stage answered but produced no usable recommendations');

  // Everything returned was verified against AniList, so these are real titles
  // rather than the model's inventions.
  for (const rec of recs) {
    assert.equal(typeof rec.title, 'string');
    assert.ok(rec.title.trim().length > 0, 'the model returned a blank title');
    assert.ok(
      rec.coverImage && rec.coverImage.startsWith('https://'),
      `"${rec.title}" has no AniList cover, so it was not verified against AniList`
    );
  }
});

test('the AI path still degrades when Groq is rate limited', options, async () => {
  // Deliberately burst to trip the key's own rate limit, then confirm the
  // request still returns results. A broken fallback would turn a quota problem
  // into an outage.
  const first = await search(`Frieren ${Math.floor(Math.random() * 1e9)}`);
  assert.equal(first.statusCode, 200);

  const burst = await Promise.all([1, 2, 3, 4].map(() => search(`Berserk ${Math.random()}`)));
  for (const res of burst) {
    assert.equal(res.statusCode, 200,
      'a burst exhausted the key\'s quota and the request did not degrade');
    assert.ok(Array.isArray(res.body.recommendations),
      'the fallback returned no recommendations array');
  }
});