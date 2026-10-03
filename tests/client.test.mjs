/**
 * Tests for the pure client-side logic in `kindoku.js`.
 *
 * `kindoku.js` is a classic browser script, so its top-level `function`
 * declarations become properties of the global object. Loading it into a vm
 * context with stubbed DOM APIs (see `harness.mjs`) lets the real code run
 * unmodified.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadApp, MemoryStorage, REPO_ROOT } from './harness.mjs';

const jsSource = readFileSync(resolve(REPO_ROOT, 'kindoku.js'), 'utf8');

function storageWith(entries = {}) {
  const storage = new MemoryStorage();
  for (const [key, value] of Object.entries(entries)) storage.setItem(key, value);
  return storage;
}

// ── escapeHtml ─────────────────────────────────────────────────────────────

test('escapeHtml neutralises every HTML-significant character', () => {
  const { escapeHtml } = loadApp();
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
  assert.equal(escapeHtml('"quoted"'), '&quot;quoted&quot;');
  assert.equal(escapeHtml("it's"), 'it&#39;s');
  // `&` must be escaped first, otherwise the entities below get double-escaped.
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
});

test('escapeHtml coerces non-strings and preserves zero/false', () => {
  const { escapeHtml } = loadApp();
  assert.equal(escapeHtml(0), '0');
  assert.equal(escapeHtml(false), 'false');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(42), '42');
});

test('escapeHtml closes an XSS payload in a single pass', () => {
  const { escapeHtml } = loadApp();
  const payload = '"><img src=x onerror=alert(1)>';
  const escaped = escapeHtml(payload);
  assert.ok(!escaped.includes('<img'));
  assert.ok(!escaped.includes('">'));
});

// ── Title normalisation ────────────────────────────────────────────────────

test('normalizeTitle is case- and whitespace-insensitive', () => {
  const { normalizeTitle } = loadApp();
  assert.equal(normalizeTitle('Berserk'), 'berserk');
  assert.equal(normalizeTitle('  Berserk  '), 'berserk');
  assert.equal(normalizeTitle('BERSERK'), 'berserk');
  assert.equal(normalizeTitle(null), '');
  assert.equal(normalizeTitle(undefined), '');
  assert.equal(normalizeTitle(123), '123');
});

// ── Bookmark normalisation & merging ───────────────────────────────────────

test('normalizeBookmark rejects records with no usable title', () => {
  const { normalizeBookmark } = loadApp();
  assert.equal(normalizeBookmark(null), null);
  assert.equal(normalizeBookmark(undefined), null);
  assert.equal(normalizeBookmark('a string'), null);
  assert.equal(normalizeBookmark(42), null);
  assert.equal(normalizeBookmark([]), null);
  assert.equal(normalizeBookmark({}), null);
  assert.equal(normalizeBookmark({ title: '' }), null);
  assert.equal(normalizeBookmark({ title: '   ' }), null);
  assert.equal(normalizeBookmark({ title: 42 }), null);
});

test('normalizeBookmark fills defaults for partial records', () => {
  const { normalizeBookmark } = loadApp();
  const rec = normalizeBookmark({ title: 'Solo Leveling' });
  assert.equal(rec.title, 'Solo Leveling');
  assert.equal(rec.type, 'Manga');
  assert.deepEqual(rec.genre, []);
  assert.equal(rec.synopsis, '');
  assert.equal(rec.status, 'Ongoing');
  assert.ok(Number.isFinite(rec.savedAt));
});

test('normalizeBookmark drops non-string genre entries', () => {
  const { normalizeBookmark } = loadApp();
  const rec = normalizeBookmark({ title: 'X', genre: ['Action', 5, null, 'Fantasy'] });
  assert.deepEqual(rec.genre, ['Action', 'Fantasy']);
});

test('normalizeBookmark preserves a valid savedAt', () => {
  const { normalizeBookmark } = loadApp();
  assert.equal(normalizeBookmark({ title: 'X', savedAt: 1234 }).savedAt, 1234);
  assert.notEqual(normalizeBookmark({ title: 'X', savedAt: 'soon' }).savedAt, 'soon');
});

// Regression: importing a JSON file whose entries lack a `title` made the merge
// expression throw on `item.title.toLowerCase()`, which the surrounding try/catch
// reported as "Invalid JSON backup file format" — a valid file, wrong message,
// and nothing imported.
test('mergeLibraryBookmarks skips malformed entries without throwing', () => {
  const { mergeLibraryBookmarks } = loadApp();
  const merged = mergeLibraryBookmarks(
    [{ title: 'Good One' }, null, {}, { title: 42 }, 'nope', { title: 'Good Two' }],
    []
  );
  assert.deepEqual(merged.map(b => b.title), ['Good One', 'Good Two']);
});

test('mergeLibraryBookmarks does not throw on any junk input', () => {
  const { mergeLibraryBookmarks } = loadApp();
  for (const input of [null, undefined, 'nope', 42, [null], [[]], [{}]]) {
    assert.doesNotThrow(() => mergeLibraryBookmarks(input, []));
  }
});

test('mergeLibraryBookmarks de-duplicates case-insensitively, imported first', () => {
  const { mergeLibraryBookmarks } = loadApp();
  const merged = mergeLibraryBookmarks(
    [{ title: 'Berserk', synopsis: 'from file' }],
    [{ title: 'BERSERK', synopsis: 'already saved' }]
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].synopsis, 'from file', 'the imported copy wins');
});

test('mergeLibraryBookmarks keeps existing entries that are not in the import', () => {
  const { mergeLibraryBookmarks } = loadApp();
  const merged = mergeLibraryBookmarks(
    [{ title: 'Imported' }],
    [{ title: 'Existing' }]
  );
  assert.deepEqual(merged.map(b => b.title), ['Imported', 'Existing']);
});

test('mergeLibraryBookmarks caps the result size', () => {
  const { mergeLibraryBookmarks } = loadApp();
  const many = Array.from({ length: 900 }, (_, i) => ({ title: `Title ${i}` }));
  assert.equal(mergeLibraryBookmarks(many, []).length, 500);
  assert.equal(mergeLibraryBookmarks(many, [], 10).length, 10);
});

// ── Library persistence ────────────────────────────────────────────────────

test('getLibraryBookmarks survives corrupt stored data', () => {
  const { getLibraryBookmarks } = loadApp({
    localStorage: storageWith({ kindoku_library: '{not json' }),
  });
  assert.deepEqual(getLibraryBookmarks(), []);
});

test('getLibraryBookmarks survives a non-array payload', () => {
  const { getLibraryBookmarks } = loadApp({
    localStorage: storageWith({ kindoku_library: '{"title":"X"}' }),
  });
  assert.deepEqual(getLibraryBookmarks(), []);
});

test('getLibraryBookmarks filters out entries stored by an older buggy import', () => {
  const { getLibraryBookmarks } = loadApp({
    localStorage: storageWith({
      kindoku_library: JSON.stringify([{ title: 'Fine' }, { nope: true }, null]),
    }),
  });
  const list = getLibraryBookmarks();
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'Fine');
});

test('isBookmarked is case-insensitive and safe on empty input', () => {
  const app = loadApp();
  app.saveLibraryBookmarks([{ title: 'Solo Leveling' }]);
  assert.equal(app.isBookmarked('solo leveling'), true);
  assert.equal(app.isBookmarked('SOLO LEVELING'), true);
  assert.equal(app.isBookmarked('Berserk'), false);
  assert.equal(app.isBookmarked(''), false);
  assert.equal(app.isBookmarked(null), false);
});

test('toggleBookmark adds then removes, without duplicating', () => {
  const app = loadApp();
  app.toggleBookmark({ title: 'Berserk', type: 'Manga' });
  assert.equal(app.getLibraryBookmarks().length, 1);
  app.toggleBookmark({ title: 'berserk' });
  assert.equal(app.getLibraryBookmarks().length, 0);
});

test('toggleBookmark ignores a record with no title', () => {
  const app = loadApp();
  app.toggleBookmark({ type: 'Manga' });
  assert.equal(app.getLibraryBookmarks().length, 0);
  assert.doesNotThrow(() => app.toggleBookmark(null));
});

test('updateBookmarkButtons handles a title with CSS-hostile characters', () => {
  // Regression: the selector was built by interpolating an encoded title; a
  // quote in the title could terminate the attribute selector and throw.
  const app = loadApp();
  assert.doesNotThrow(() => app.updateBookmarkButtons('He"l\\o [World] & Co'));
  assert.doesNotThrow(() => app.updateBookmarkButtons("It's a Test"));
  assert.doesNotThrow(() => app.updateBookmarkButtons('100% > 50%'));
});

// ── Search history ─────────────────────────────────────────────────────────

test('getSearchHistory survives corrupt stored data', () => {
  const { getSearchHistory } = loadApp({
    localStorage: storageWith({ kindoku_history: 'not json at all' }),
  });
  assert.deepEqual(getSearchHistory(), []);
});

test('getSearchHistory filters non-string entries', () => {
  const { getSearchHistory } = loadApp({
    localStorage: storageWith({
      kindoku_history: JSON.stringify(['Berserk', 42, null, '  ']),
    }),
  });
  assert.deepEqual(getSearchHistory(), ['Berserk']);
});

test('addSearchHistory is newest-first, de-duplicated and capped', () => {
  const app = loadApp();
  app.addSearchHistory('Berserk');
  app.addSearchHistory('Solo Leveling');
  app.addSearchHistory('BERSERK');
  assert.deepEqual(app.getSearchHistory(), ['BERSERK', 'Solo Leveling']);

  for (let i = 0; i < 20; i++) app.addSearchHistory(`Title ${i}`);
  assert.equal(app.getSearchHistory().length, 10);
});

test('addSearchHistory ignores one-character queries', () => {
  const app = loadApp();
  app.addSearchHistory('a');
  assert.deepEqual(app.getSearchHistory(), []);
});

// ── Result filtering & sorting ─────────────────────────────────────────────

test('ratingValue coerces string ratings and rejects junk', () => {
  const { ratingValue } = loadApp();
  assert.equal(ratingValue({ rating: '8.4' }), 8.4);
  assert.equal(ratingValue({ rating: 8 }), 8);
  assert.equal(ratingValue({ rating: '' }), 0);
  assert.equal(ratingValue({}), 0);
  assert.equal(ratingValue(null), 0);
  assert.equal(ratingValue({ rating: 'N/A' }), 0);
});

test('compareRecommendations sorts by rating descending', () => {
  const { compareRecommendations } = loadApp();
  const recs = [
    { title: 'Low', rating: '5.0' },
    { title: 'High', rating: '9.1' },
    { title: 'Mid', rating: '7.2' },
  ];
  const sorted = [...recs].sort((a, b) => compareRecommendations(a, b, 'rating'));
  assert.deepEqual(sorted.map(r => r.title), ['High', 'Mid', 'Low']);
});

test('compareRecommendations breaks rating ties by title so order is stable', () => {
  const { compareRecommendations } = loadApp();
  const a = { title: 'Beta', rating: '8.0' };
  const b = { title: 'Alpha', rating: '8.0' };
  assert.ok(compareRecommendations(a, b, 'rating') > 0);
  assert.ok(compareRecommendations(b, a, 'rating') < 0);
});

test('compareRecommendations handles unrated titles without NaN', () => {
  const { compareRecommendations } = loadApp();
  const sorted = [
    { title: 'No Rating' },
    { title: 'Rated', rating: '7.0' },
  ].sort((a, b) => compareRecommendations(a, b, 'rating'));
  assert.deepEqual(sorted.map(r => r.title), ['Rated', 'No Rating']);
});

test('compareRecommendations sorts by title and by type', () => {
  const { compareRecommendations } = loadApp();
  const byTitle = [
    { title: 'zeta' },
    { title: 'Alpha' },
    { title: 'beta' },
  ].sort((a, b) => compareRecommendations(a, b, 'title'));
  assert.deepEqual(byTitle.map(r => r.title), ['Alpha', 'beta', 'zeta']);

  const byType = [
    { title: 'A', type: 'Manhwa' },
    { title: 'B', type: 'Light Novel' },
    { title: 'C', type: 'Manga' },
  ].sort((a, b) => compareRecommendations(a, b, 'type'));
  assert.deepEqual(byType.map(r => r.type), ['Light Novel', 'Manga', 'Manhwa']);
});

test('compareRecommendations is a no-op for the default sort', () => {
  const { compareRecommendations } = loadApp();
  assert.equal(compareRecommendations({ title: 'B' }, { title: 'A' }, 'default'), 0);
  assert.equal(compareRecommendations({ title: 'B' }, { title: 'A' }, undefined), 0);
});

test('matchesResultsFilter searches title, genre, synopsis and type', () => {
  const { matchesResultsFilter } = loadApp();
  const rec = {
    title: 'Solo Leveling',
    genre: ['Action', 'Fantasy'],
    synopsis: 'A weak hunter becomes the strongest.',
    type: 'Manhwa',
  };
  assert.equal(matchesResultsFilter(rec, ''), true);
  assert.equal(matchesResultsFilter(rec, 'solo'), true);
  assert.equal(matchesResultsFilter(rec, 'FANTASY'), true);
  assert.equal(matchesResultsFilter(rec, 'hunter'), true);
  assert.equal(matchesResultsFilter(rec, 'manhwa'), true);
  assert.equal(matchesResultsFilter(rec, 'horror'), false);
});

test('matchesResultsFilter survives records with missing fields', () => {
  const { matchesResultsFilter } = loadApp();
  assert.equal(matchesResultsFilter({}, 'anything'), false);
  assert.equal(matchesResultsFilter({ title: 'X' }, 'x'), true);
  assert.equal(matchesResultsFilter({ genre: 'not-an-array' }, 'x'), false);
  assert.equal(matchesResultsFilter(null, 'x'), false);
});

// ── Recommendation merging ─────────────────────────────────────────────────

// Regression: "Load More" appended server results blindly, so the same title
// could appear several times in the grid.
test('mergeRecommendations appends only unseen titles', () => {
  const { mergeRecommendations } = loadApp();
  const existing = [{ title: 'Berserk' }, { title: 'Vagabond' }];
  const fresh = mergeRecommendations(existing, [
    { title: 'Berserk' },
    { title: 'Ubersoldier' },
    { title: 'VAGABOND' },
    { title: 'Ubersoldier' },
  ]);
  assert.deepEqual(fresh.map(r => r.title), ['Ubersoldier']);
});

test('mergeRecommendations preserves the order of incoming results', () => {
  const { mergeRecommendations } = loadApp();
  const fresh = mergeRecommendations([], [
    { title: 'C' }, { title: 'A' }, { title: 'B' },
  ]);
  assert.deepEqual(fresh.map(r => r.title), ['C', 'A', 'B']);
});

test('mergeRecommendations skips records with no title', () => {
  const { mergeRecommendations } = loadApp();
  assert.deepEqual(
    mergeRecommendations([], [null, {}, { title: '' }, { title: '   ' }, { title: 'Real' }])
      .map(r => r.title),
    ['Real']
  );
});

test('mergeRecommendations handles non-array input', () => {
  const { mergeRecommendations } = loadApp();
  assert.deepEqual(mergeRecommendations([], null), []);
  assert.deepEqual(mergeRecommendations([], 'nope'), []);
  assert.doesNotThrow(() => mergeRecommendations(null, null));
});

// ── Reader URL helpers ─────────────────────────────────────────────────────

test('toTranslatedUrl wraps the URL in Google translate proxy', () => {
  const { toTranslatedUrl } = loadApp();
  const result = toTranslatedUrl('https://example.com/reader?ch=1');
  assert.ok(result.startsWith('https://translate.google.com/translate?'));
  assert.ok(result.includes('sl=auto'));
  assert.ok(result.includes('tl=en'));
  assert.ok(result.includes(encodeURIComponent('https://example.com/reader?ch=1')));
});

test('toTranslatedUrl escapes a URL that would otherwise break the query string', () => {
  const { toTranslatedUrl } = loadApp();
  const result = toTranslatedUrl('https://example.com/a?b=1&c=2#frag');
  assert.ok(!result.includes('#frag'), 'the fragment cannot leak into the query');
  assert.ok(result.includes('%26c%3D2'));
});

// ── Shuffle ────────────────────────────────────────────────────────────────

// Regression: `[...arr].sort(() => 0.5 - Math.random())` is a biased shuffle
// that frequently leaves items in place.
test('shuffled actually permutes the array', () => {
  const { shuffled } = loadApp();
  const source = Array.from({ length: 8 }, (_, i) => i);
  const seen = new Set();
  for (let i = 0; i < 400; i++) seen.add(shuffled(source).join(','));
  assert.ok(seen.size > 20, `expected many distinct permutations, got ${seen.size}`);
});

test('shuffled does not mutate its input and keeps every element', () => {
  const { shuffled } = loadApp();
  const source = Array.from({ length: 20 }, (_, i) => i);
  const copy = [...source];
  const result = shuffled(source);
  assert.deepEqual(source, copy, 'input untouched');
  assert.deepEqual([...result].sort((a, b) => a - b), copy, 'same multiset');
});

test('shuffled handles empty and single-element arrays', () => {
  const { shuffled } = loadApp();
  assert.deepEqual(shuffled([]), []);
  assert.deepEqual(shuffled(['only']), ['only']);
});

test('shuffled reaches both orderings for a two-element array', () => {
  const { shuffled } = loadApp();
  const two = ['a', 'b'];
  const results = new Set();
  for (let i = 0; i < 200; i++) results.add(shuffled(two).join(''));
  assert.equal(results.size, 2, `both orders should occur, saw ${[...results].join(' ')}`);
});

// ── Overlay scroll locking ─────────────────────────────────────────────────

test('scroll stays locked while any overlay is open', () => {
  const app = loadApp({
    provide: ['cmd-modal', 'detail-modal', 'detail-modal-content'],
  });
  const body = app.document.body;

  app.openCmdPalette();
  assert.equal(body.style.overflow, 'hidden');

  app.openDetailModal({ title: 'Berserk', type: 'Manga' });
  app.closeCmdPalette();
  // Regression: closing the palette used to clear the lock even though the
  // detail modal was still open, letting the page scroll behind it.
  assert.equal(body.style.overflow, 'hidden');

  app.closeDetailModal();
  assert.equal(body.style.overflow, '', 'the lock is released only when nothing is open');
});

test('the reader overlay takes part in the scroll lock', () => {
  const app = loadApp();
  const body = app.document.body;
  app.pushOverlay('reader');
  assert.equal(body.style.overflow, 'hidden');
  app.popOverlay('reader');
  assert.equal(body.style.overflow, '');
});

test('closing an overlay that was never opened does not unlock scrolling', () => {
  const app = loadApp();
  const body = app.document.body;
  app.pushOverlay('detail');
  app.popOverlay('reader');
  assert.equal(body.style.overflow, 'hidden');
});

// ── Misc helpers ───────────────────────────────────────────────────────────

test('toArray always returns an array', () => {
  const { toArray } = loadApp();
  assert.deepEqual(toArray([1, 2]), [1, 2]);
  assert.deepEqual(toArray(null), []);
  assert.deepEqual(toArray(undefined), []);
  assert.deepEqual(toArray('nope'), []);
  assert.deepEqual(toArray(0), []);
  assert.deepEqual(toArray({ length: 2 }), [], 'array-likes are not silently coerced');
});

test('createCardElement rejects records with no title instead of rendering a blank card', () => {
  const app = loadApp();
  assert.equal(app.createCardElement({}), null);
  assert.equal(app.createCardElement({ title: '' }), null);
  assert.equal(app.createCardElement(null), null);
});

// ── Command palette filtering ──────────────────────────────────────────────

/**
 * Minimal stand-ins for the command palette's item list. `kindoku.js` binds
 * these at load time, so they must be registered before the script runs.
 */
function makeClassList() {
  const set = new Set();
  return {
    toggle: (name, on) => (on ? set.add(name) : set.delete(name)),
    contains: name => set.has(name),
    add: name => set.add(name),
    remove: name => set.delete(name),
  };
}

function makeCmdItem({ search, cmd }) {
  return {
    hidden: false,
    classList: makeClassList(),
    dataset: { search, cmd },
    textContent: search || cmd,
    clicked: 0,
    click() {
      this.clicked++;
    },
    scrollIntoView() {},
  };
}

function makeCmdList(labels) {
  const items = labels.map(makeCmdItem);
  return {
    items,
    querySelectorAll: () => items,
    querySelector: () => items.find(item => !item.hidden) ?? null,
  };
}

/** Loads the app with a palette wired to a stub list. */
function loadAppWithCmdList(labels) {
  const list = makeCmdList(labels);
  const emptyState = { hidden: true };
  const app = loadApp({
    provide: ['cmd-modal', 'cmd-input'],
    elements: {
      'cmd-results-list': list,
      'cmd-empty-state': emptyState,
    },
  });
  return { app, list, emptyState };
}

test('filterCmdItems narrows the palette and highlights the first match', () => {
  const { app, list, emptyState } = loadAppWithCmdList([
    { cmd: 'discover' },
    { cmd: 'library' },
    { search: 'Berserk' },
    { search: 'Solo Leveling' },
  ]);

  app.filterCmdItems('leveling');
  assert.deepEqual(list.items.map(i => i.hidden), [true, true, true, false]);
  assert.equal(list.items[3].classList.contains('highlighted'), true);
  assert.equal(emptyState.hidden, true);
});

test('filterCmdItems shows the empty state when nothing matches', () => {
  const { app, list, emptyState } = loadAppWithCmdList([{ search: 'Berserk' }]);

  app.filterCmdItems('zzzzz');
  assert.equal(list.items[0].hidden, true);
  assert.equal(emptyState.hidden, false, 'the user is told nothing matched');
});

test('filterCmdItems with an empty query restores every item', () => {
  const { app, list } = loadAppWithCmdList([
    { search: 'Berserk' },
    { search: 'Solo Leveling' },
  ]);

  app.filterCmdItems('ber');
  app.filterCmdItems('');
  assert.deepEqual(list.items.map(i => i.hidden), [false, false]);
  assert.equal(list.items[0].classList.contains('highlighted'), true);
});

test('filterCmdItems is case-insensitive', () => {
  const { app, list } = loadAppWithCmdList([
    { search: 'Berserk' },
    { search: 'Solo Leveling' },
  ]);

  app.filterCmdItems('BERSERK');
  assert.deepEqual(list.items.map(i => i.hidden), [false, true]);
});

test('filterCmdItems only ever highlights one item', () => {
  const { app, list } = loadAppWithCmdList([
    { search: 'A One' },
    { search: 'A Two' },
    { search: 'A Three' },
  ]);

  app.filterCmdItems('a');
  const highlighted = list.items.filter(i => i.classList.contains('highlighted'));
  assert.equal(highlighted.length, 1);
});

test('moveCmdHighlight cycles through the visible items and wraps', () => {
  const { app, list } = loadAppWithCmdList([
    { search: 'A' },
    { search: 'B' },
    { search: 'C' },
  ]);

  app.filterCmdItems('');
  assert.equal(list.items[0].classList.contains('highlighted'), true);

  app.moveCmdHighlight(1);
  assert.equal(list.items[1].classList.contains('highlighted'), true);
  app.moveCmdHighlight(1);
  assert.equal(list.items[2].classList.contains('highlighted'), true);

  app.moveCmdHighlight(1);
  assert.equal(list.items[0].classList.contains('highlighted'), true, 'wraps forward');

  app.moveCmdHighlight(-1);
  assert.equal(list.items[2].classList.contains('highlighted'), true, 'wraps backward');
});

test('moveCmdHighlight skips items hidden by the current filter', () => {
  const { app, list } = loadAppWithCmdList([
    { search: 'Berserk' },
    { search: 'Solo Leveling' },
    { search: 'Berserk 2' },
  ]);

  app.filterCmdItems('berserk');
  assert.deepEqual(list.items.map(i => i.hidden), [false, true, false]);

  app.moveCmdHighlight(1);
  assert.equal(
    list.items[2].classList.contains('highlighted'),
    true,
    'the hidden item is skipped'
  );
});

test('moveCmdHighlight is a no-op when nothing is visible', () => {
  const { app } = loadAppWithCmdList([{ search: 'A' }]);

  app.filterCmdItems('nomatch');
  assert.doesNotThrow(() => app.moveCmdHighlight(1));
  assert.doesNotThrow(() => app.moveCmdHighlight(-1));
});

test('cmdResultsList is actually used, not just declared', () => {
  const uses = (jsSource.match(/cmdResultsList/g) || []).length;
  assert.ok(
    uses >= 3,
    `cmdResultsList is referenced ${uses} time(s); the palette filter must use it, not just declare it`
  );
});

test('isAbortError recognises both DOMException and numeric codes', () => {
  const { isAbortError } = loadApp();
  assert.equal(isAbortError({ name: 'AbortError' }), true);
  assert.equal(isAbortError({ code: 20 }), true);
  assert.equal(isAbortError({ name: 'TypeError', message: 'Failed to fetch' }), false);
  assert.equal(isAbortError(null), false);
  assert.equal(isAbortError(undefined), false);
});

// ── Library caching & filter states ────────────────────────────────────────

test('the library is parsed from storage once, not once per card', () => {
  // `isBookmarked` runs for every rendered card. Without memoisation a screen
  // of 25 results meant 25 JSON.parse calls of the whole library.
  const app = loadApp();
  app.saveLibraryBookmarks([{ title: 'Berserk' }]);

  let reads = 0;
  const originalGetItem = app.localStorage.getItem.bind(app.localStorage);
  app.localStorage.getItem = key => {
    if (key === 'kindoku_library') reads++;
    return originalGetItem(key);
  };

  for (let i = 0; i < 20; i++) app.isBookmarked('berserk');
  assert.equal(reads, 0, 'the parsed library is reused across calls');

  // A first call after a cold start does read storage exactly once.
  const cold = loadApp({
    localStorage: storageWith({
      kindoku_library: JSON.stringify([{ title: 'Berserk' }]),
    }),
  });
  let coldReads = 0;
  const coldGetItem = cold.localStorage.getItem.bind(cold.localStorage);
  cold.localStorage.getItem = key => {
    if (key === 'kindoku_library') coldReads++;
    return coldGetItem(key);
  };
  for (let i = 0; i < 20; i++) cold.isBookmarked('berserk');
  assert.equal(coldReads, 1, 'parsed once, then memoised');
  assert.equal(cold.isBookmarked('berserk'), true);
});

test('saving invalidates the cached library so new titles are seen immediately', () => {
  const app = loadApp();
  assert.equal(app.isBookmarked('Berserk'), false);
  app.saveLibraryBookmarks([{ title: 'Berserk' }]);
  assert.equal(app.isBookmarked('Berserk'), true, 'no stale cache after a save');
  app.saveLibraryBookmarks([]);
  assert.equal(app.isBookmarked('Berserk'), false);
});

test('toggleBookmark is visible to isBookmarked straight away', () => {
  const app = loadApp();
  app.toggleBookmark({ title: 'Vagabond' });
  assert.equal(app.isBookmarked('Vagabond'), true);
  app.toggleBookmark({ title: 'Vagabond' });
  assert.equal(app.isBookmarked('Vagabond'), false);
});

// ── Reset / preset helpers ────────────────────────────────────────────────

test('resetDiscoverMatrix accepts a silent mode so presets show one toast', () => {
  const { resetDiscoverMatrix } = loadApp();
  // Every preset and the randomizer start with a reset; without `silent` the
  // user saw two toasts stacked for a single click.
  assert.doesNotThrow(() => resetDiscoverMatrix({ silent: true }));
  assert.doesNotThrow(() => resetDiscoverMatrix());
});

test('applyPreset rejects an unknown preset key without changing state', () => {
  const app = loadApp();
  app.selectedGenres.add('Action');
  app.applyPreset('does-not-exist');
  assert.ok(app.selectedGenres.has('Action'), 'state untouched');
});

test('randomizeDiscoverMatrix only ever selects real formats, genres and tags', () => {
  const app = loadApp();
  const validFormats = new Set(['Manga', 'Manhwa', 'Manhua', 'Light Novel']);
  const validGenres = new Set(app.GENRES.map(g => g.label));
  const validTags = new Set(app.TAGS);

  for (let i = 0; i < 40; i++) {
    app.randomizeDiscoverMatrix();
    for (const f of app.selectedFormats) assert.ok(validFormats.has(f), f);
    for (const g of app.selectedGenres) assert.ok(validGenres.has(g), g);
    for (const t of app.selectedTags) assert.ok(validTags.has(t), t);
    assert.ok(app.selectedFormats.size >= 1 && app.selectedFormats.size <= 2);
    assert.equal(app.selectedGenres.size, 2);
    assert.equal(app.selectedTags.size, 3);
  }
});

test('randomizeDiscoverMatrix replaces the previous selection, not merges it', () => {
  const app = loadApp();
  // Start with a full matrix; after randomizing, the counts must be exactly the
  // randomizer's, which can only happen if the old selection was cleared first.
  ['Horror', 'Action', 'Drama', 'Comedy'].forEach(g => app.selectedGenres.add(g));
  ['Magic', 'System', 'Dungeon', 'Murim', 'Revenge'].forEach(t => app.selectedTags.add(t));
  ['Manga', 'Manhwa', 'Manhua', 'Light Novel'].forEach(f => app.selectedFormats.add(f));

  app.randomizeDiscoverMatrix();

  assert.equal(app.selectedGenres.size, 2);
  assert.equal(app.selectedTags.size, 3);
  assert.ok(app.selectedFormats.size <= 2);
});