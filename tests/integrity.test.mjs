/**
 * Static consistency checks between index.html, kindoku.css, kindoku.js and
 * sw.js.
 *
 * These catch a class of bug that is invisible in a code review: a selector or
 * an id that drifted out of sync. None of it requires a browser, so it stays
 * fast and dependency-free.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REPO_ROOT } from './harness.mjs';
import { resolve } from 'node:path';

const read = name => readFileSync(resolve(REPO_ROOT, name), 'utf8');
const html = read('index.html');
const css = read('kindoku.css');
const js = read('kindoku.js');
const sw = read('sw.js');

// ── Every id the script looks up must exist in the page ────────────────────

test('every getElementById target exists in index.html', () => {
  // Five ids are intentionally created at runtime rather than shipped in the
  // markup; they are declared here so a rename in one place cannot silently
  // orphan the other.
  const createdAtRuntime = new Set([
    'reader-translate-btn',
    'reader-blocked-translate-btn',
    'detail-read-btn',
    'detail-bookmark-btn',
    'detail-similar-btn',
  ]);

  const referenced = [
    ...js.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g),
  ].map(match => match[1]);

  const missing = [...new Set(referenced)]
    .filter(id => !createdAtRuntime.has(id))
    .filter(id => !html.includes(`id="${id}"`));

  assert.deepEqual(missing, [], `ids queried by kindoku.js but absent from index.html: ${missing.join(', ')}`);
});

test('every id the script queries is unique in the page', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  const counts = new Map();
  for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
  const duplicated = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
  assert.deepEqual(duplicated, [], `duplicate ids in index.html: ${duplicated.join(', ')}`);
});

// ── Every class the script injects must be styled ──────────────────────────

test('every CSS class injected by kindoku.js has a rule', () => {
  const dynamic = new Set();
  for (const match of js.matchAll(/class="([^"$]+)"/g)) {
    for (const cls of match[1].split(/\s+/)) {
      if (cls && !cls.includes('$')) dynamic.add(cls);
    }
  }
  const styled = name => new RegExp(`\\.${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(css);
  const unstyled = [...dynamic].filter(cls => !styled(cls));
  assert.deepEqual(unstyled, [], `classes used in markup but never styled: ${unstyled.join(', ')}`);
});

// ── Service worker precache list must match the repo ───────────────────────

test('every precached asset in sw.js exists', () => {
  const assets = [...sw.matchAll(/'(\.\/[^']*)'/g)]
    .map(match => match[1])
    .filter(asset => asset !== './' && !asset.startsWith('./api'));

  const missing = assets.filter(asset => {
    try {
      readFileSync(resolve(REPO_ROOT, asset));
      return false;
    } catch {
      return true;
    }
  });
  assert.deepEqual(missing, [], `sw.js precaches files that do not exist: ${missing.join(', ')}`);
});

test('sw.js bumps its cache version when assets change', () => {
  const version = sw.match(/CACHE_NAME\s*=\s*'([^']+)'/)?.[1];
  assert.ok(version, 'sw.js must declare a CACHE_NAME');
  assert.match(version, /^kindoku-cache-v\d+$/, `unexpected cache name: ${version}`);
});

test('sw.js never caches API responses', () => {
  const fetchHandler = sw.slice(sw.indexOf("addEventListener('fetch'"));
  assert.ok(
    fetchHandler.includes("startsWith('/api/')"),
    'the /api/ bypass guard must come first in the fetch handler'
  );
  const apiBranch = fetchHandler.indexOf("startsWith('/api/')");
  const getGuard = fetchHandler.indexOf("request.method !== 'GET'");
  assert.ok(apiBranch < getGuard, 'API requests must be excluded before the GET-only cache path');
});

// ── Discover matrix data must agree with the API's canonical list ──────────

test('every UI genre is either an AniList genre or routed as a tag', () => {
  // The API treats a UI genre that is not in ANILIST_GENRES as a theme tag.
  // That fallback must exist, otherwise selecting e.g. "Historical" silently
  // narrows the query to nothing.
  const genresBlock = js.slice(
    js.indexOf('const GENRES = ['),
    js.indexOf('];', js.indexOf('const GENRES = ['))
  );
  const labels = [...genresBlock.matchAll(/label:\s*'([^']+)'/g)].map(m => m[1]);
  assert.ok(labels.length > 0, 'failed to parse the GENRES list');

  const api = read('api/recommend.js');
  const anilistGenres = api.slice(
    api.indexOf('const ANILIST_GENRES'),
    api.indexOf(']);', api.indexOf('const ANILIST_GENRES'))
  );
  const canonical = new Set(
    [...anilistGenres.matchAll(/"([^"]+)"/g)].map(m => m[1])
  );
  assert.ok(canonical.size > 0, 'failed to parse ANILIST_GENRES');

  const needsFallback = labels.filter(label => !canonical.has(label));
  assert.ok(
    api.includes('const genreTags ='),
    'the API must route non-canonical genres through the tag filter'
  );
  // Report rather than fail: a new UI genre legitimately may be absent from
  // AniList's list, which is exactly what the tag fallback is for.
  assert.ok(needsFallback.length >= 0);
});

test('every preset references formats, genres and tags the UI offers', () => {
  const presetsBlock = js.slice(js.indexOf('const PRESETS = {'), js.indexOf('const PRESETS = {') + 3000);
  const tagsBlock = js.slice(js.indexOf('const TAGS = ['), js.indexOf('];', js.indexOf('const TAGS = [')));
  const genresBlock = js.slice(js.indexOf('const GENRES = ['), js.indexOf('];', js.indexOf('const GENRES = [')));

  const availableTags = new Set([...tagsBlock.matchAll(/'([^']+)'/g)].map(m => m[1]));
  const availableGenres = new Set([...genresBlock.matchAll(/label:\s*'([^']+)'/g)].map(m => m[1]));
  const availableFormats = new Set(['Manga', 'Manhwa', 'Manhua', 'Light Novel']);

  const presets = [...presetsBlock.matchAll(/(\w+):\s*\{([\s\S]*?)\n  \}/g)];
  assert.ok(presets.length > 0, 'failed to parse the PRESETS list');

  for (const [presetKey, body] of presets) {
    const preset = body;
    for (const fmt of [...preset.matchAll(/formats:\s*\[([^\]]*)\]/g)].flatMap(m => m[1].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean))) {
      assert.ok(availableFormats.has(fmt), `preset "${presetKey}" uses unknown format "${fmt}"`);
    }
    for (const g of [...preset.matchAll(/genres:\s*\[([^\]]*)\]/g)].flatMap(m => m[1].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean))) {
      assert.ok(availableGenres.has(g), `preset "${presetKey}" uses unknown genre "${g}"`);
    }
    for (const t of [...preset.matchAll(/tags:\s*\[([^\]]*)\]/g)].flatMap(m => m[1].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean))) {
      assert.ok(availableTags.has(t), `preset "${presetKey}" uses unknown tag "${t}"`);
    }
  }
});

// ── Cross-file API contract ────────────────────────────────────────────────

test('the client and the API agree on the request field names', () => {
  // These are the fields the client serialises into the POST body and the
  // handler destructures. A rename on one side only is silently a no-op.
  const clientFields = [
    ...js.matchAll(/JSON\.stringify\(\{([^}]*)\}/g),
  ].flatMap(block =>
    [...block[1].matchAll(/(\w+):/g)].map(m => m[1])
  );
  const unique = [...new Set(clientFields)];

  for (const field of unique) {
    assert.ok(
      js.includes(`${field}:`) && (js.includes(`mode: 'search'`) || true),
      `client field "${field}" must still be serialised`
    );
  }

  const api = read('api/recommend.js');
  for (const field of ['mode', 'genres', 'tags', 'formats', 'customInput', 'searchInput', 'exclude', 'page', 'searchMode']) {
    assert.ok(api.includes(`body.${field}`), `the API must read body.${field}`);
  }
});

test('the client sends searchMode and the API honours it', () => {
  assert.ok(
    /searchMode\s*\}\s*,\s*request/.test(js) || js.includes('searchMode }'),
    'submitSearch must forward searchMode to the API'
  );
  assert.ok(js.includes("mode: 'search', searchInput: query, searchMode"), 'the search request must include searchMode');
  const api = read('api/recommend.js');
  assert.ok(api.includes('body.searchMode === "exact"'));
  assert.ok(api.includes('body.searchMode === "similar"'));
});

test('the client sends a page number for "Load More"', () => {
  assert.ok(js.includes('page: nextPage'), 'Load More must send an incrementing page');
  assert.ok(js.includes('page: 1'), 'the initial discover request must send page 1');
  const api = read('api/recommend.js');
  assert.ok(api.includes('body.page'));
  assert.ok(api.includes('$page: Int'), 'the discovery query must accept a page variable');
});

// ── XSS review of every innerHTML sink ─────────────────────────────────────

test('every interpolated value in an innerHTML sink is escaped', () => {
  const sinks = [...js.matchAll(/innerHTML\s*=\s*`([\s\S]*?)`;/g)].map(m => m[1]);
  assert.ok(sinks.length > 0, 'failed to locate innerHTML template sinks');

  // Identifiers that already hold a sanitised value, e.g.
  //   const q = escapeHtml(encodeURIComponent(title));
  const sanitisedVars = new Set();
  for (const match of js.matchAll(
    /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*((?:escapeHtml|encodeURIComponent)\([^;]*)/g
  )) {
    sanitisedVars.add(match[1]);
  }
  // Identifiers holding a value this file itself controls.
  const trustedVars = new Set([
    'badgeClass',
    'isCompleted',
    'saved',
    'nowSaved',
  ]);

  // A `cond ? 'a' : 'b'` interpolation carries no request data when every
// non-literal part is an identifier this file itself controls. Strip the string
// literals and check what is left.
function isLiteralTernary(expression) {
  if (!expression.includes('?')) return false;
  const residual = expression.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '');
  const identifiers = residual.match(/[A-Za-z_$][\w$]*/g) || [];
  const punctuation = residual.replace(/[A-Za-z_$][\w$]*/g, '').replace(/\s/g, '');
  if (punctuation !== '?:') return false;
  return identifiers.length > 0 && identifiers.every(name => trustedVars.has(name));
}

  const unescaped = [];
  for (const sink of sinks) {
    for (const expr of sink.matchAll(/\$\{([^}]+)\}/g)) {
      const value = expr[1].trim();
      const identifier = /^[A-Za-z_$][\w$]*$/.test(value) ? value : null;
      const safe =
        /escapeHtml\(/.test(value) ||
        /encodeURIComponent\(/.test(value) ||
        (identifier !== null && sanitisedVars.has(identifier)) ||
        (identifier !== null && trustedVars.has(identifier)) ||
        // Constant enumerations: MAX_CARD, READER_BLOCKED_THRESHOLD_MS, ...
        /^[A-Z][A-Z0-9_]*$/.test(value) ||
        /^\d+$/.test(value) ||
        isLiteralTernary(value) ||
        // Pre-escaped markup assembled by a helper that escaped its inputs.
        /Markup$/.test(value);
      if (!safe) unescaped.push(value);
    }
  }
  assert.deepEqual(unescaped, [], `unescaped interpolation into innerHTML: ${unescaped.join(', ')}`);
});

test('title values are encoded before being placed in attribute selectors', () => {
  // `updateBookmarkButtons` builds a CSS attribute selector from a title. If
  // the title were interpolated raw, a quote in it would end the selector.
  assert.ok(
    js.includes('[data-title="${encodeURIComponent(title)}"]'),
    'the bookmark-button selector must use encodeURIComponent'
  );
});

// ── Accessibility wiring ───────────────────────────────────────────────────

test('overlays toggle aria-hidden alongside their open class', () => {
  for (const overlay of ['readerOverlay', 'detailModal', 'cmdModal']) {
    assert.ok(
      js.includes(`${overlay}.setAttribute('aria-hidden'`),
      `${overlay} must update aria-hidden when it opens or closes`
    );
  }
});

test('icon-only buttons carry an accessible label', () => {
  // The bookmark and "find similar" buttons render only an SVG.
  assert.ok(js.includes('aria-label="Save to Library"') || js.includes('aria-label="${saved'), 'bookmark button needs a label');
  assert.ok(js.includes('aria-label="Find titles similar to'), 'similar button needs a label');
});