/**
 * Third-party model lifecycle.
 *
 * Groq retired both models this app used for months and nothing in the codebase
 * noticed, because the handler falls back to the direct AniList engine and that
 * engine works perfectly. The AI stage had been dead in production for seven
 * weeks and every response looked healthy.
 *
 * A model list is external data with an expiry date. This file pins the known
 * dead IDs so a rename cannot silently reintroduce them, and `live.test.mjs`
 * checks the live catalogue when a key is available.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(REPO_ROOT, 'api/recommend.js'), 'utf8');

/** Pull the model list out of the handler without widening its public surface. */
function readModelList() {
  const match = source.match(/const GROQ_MODELS\s*=\s*\[([^\]]*)\]/);
  assert.ok(match, 'GROQ_MODELS is no longer a literal array; update this test');
  const models = [...match[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  assert.ok(models.length > 0, 'the model list parsed as empty, which would hide a rename');
  return models;
}

/**
 * Model IDs that a free or developer-tier key can no longer use, with the date
 * each stopped being served and the replacement Groq published.
 *
 * Source: Groq deprecation notices and console.groq.com/docs/models. Groq lists
 * the two llama models under "Production" with limits of "ContactSales", which
 * is how an Enterprise-only model presents itself.
 */
const RETIRED = new Map([
  ['llama-3.3-70b-versatile', {
    when: '2026-08-16',
    replacement: 'openai/gpt-oss-120b',
  }],
  ['llama-3.1-8b-instant', {
    when: '2026-08-16',
    replacement: 'openai/gpt-oss-20b',
  }],
  ['qwen/qwen3.6-27b', {
    when: '2026-09-14',
    replacement: 'qwen/qwen3.8-27b',
  }],
  // Retired before this repo gained a test suite.
  ['gemma2-9b-it', { when: '2025-08', replacement: 'openai/gpt-oss-20b' }],
  ['llama3-70b-8192', { when: '2025-01', replacement: 'openai/gpt-oss-20b' }],
]);

/** Models on Groq's developer plan as of 2026-10, per the supported-models page. */
const CURRENTLY_SERVABLE = new Set([
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
  'whisper-large-v3',
  'whisper-large-v3-turbo',
]);

test('the model list contains no model Groq has retired', () => {
  const models = readModelList();
  for (const model of models) {
    const dead = RETIRED.get(model);
    assert.equal(
      dead,
      undefined,
      `GROQ_MODELS still lists "${model}", which Groq stopped serving to free and ` +
      `developer-tier keys on ${dead?.when}. Replacement: ${dead?.replacement}. ` +
      'Every request will fail with model_not_found and fall back to AniList.'
    );
  }
});

test('every model in the list is one Groq currently serves', () => {
  const models = readModelList();
  for (const model of models) {
    assert.ok(
      CURRENTLY_SERVABLE.has(model),
      `"${model}" is not in the curated set of models on Groq's developer plan. ` +
      'If it is genuinely still served, add it to CURRENTLY_SERVABLE; if not, it ' +
      'is dead and belongs in RETIRED.'
    );
  }
});

test('the retired list does not claim a live model is dead', () => {
  // Guards the guard: a wrong entry here would block a model that works.
  for (const [model] of RETIRED) {
    assert.ok(
      !CURRENTLY_SERVABLE.has(model),
      `"${model}" is in both RETIRED and CURRENTLY_SERVABLE; one of them is wrong`
    );
  }
});

test('the fastest model is tried first', () => {
  // The request budget is 7s wall clock under a 10s platform cap, and GPT-OSS
  // 120B runs at roughly half the throughput of 20B. Leading with 120B spends
  // most of the budget on one attempt and leaves no room for the AniList
  // fallback, so 20B goes first and 120B is the quality fallback.
  const models = readModelList();
  assert.equal(models[0], 'openai/gpt-oss-20b',
    'the slowest model is first; a single attempt can exhaust the time budget');
  assert.ok(models.length >= 2,
    'only one model is configured, so any retirement takes the whole feature down');
});

test('the model list is deduplicated', () => {
  const models = readModelList();
  assert.equal(new Set(models).size, models.length,
    `GROQ_MODELS repeats an entry: ${models.join(', ')}`);
});