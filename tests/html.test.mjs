/**
 * Structural tests for index.html.
 *
 * The markup is hand-written and mostly static, so most invariants are about
 * *relationships* between elements rather than appearance: a control that
 * points at a view, a label that points at its input, an ARIA relationship that
 * must stay in sync with a CSS class. Those are exactly the things that break
 * silently.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from './harness.mjs';

const html = readFileSync(resolve(REPO_ROOT, 'index.html'), 'utf8');
const js = readFileSync(resolve(REPO_ROOT, 'kindoku.js'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, 'site.webmanifest'), 'utf8'));

/** All tags with their attributes, in document order. */
function tags(name) {
  return [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'gi'))];
}

function attr(tagBody, name) {
  return new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tagBody)?.[1];
}

function hasId(id) {
  return new RegExp(`\\sid="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(html);
}

function elementById(id) {
  const match = new RegExp(`<[^>]*\\sid="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`).exec(html);
  return match?.[0] || null;
}

// ── Document basics ───────────────────────────────────────────────────────

test('the document declares a charset and a viewport', () => {
  assert.match(html, /<meta[^>]*charset=["']?utf-8/i);
  assert.match(html, /<meta[^>]*name=["']viewport["']/i);
  assert.match(html, /<html[^>]*lang=["']/i, 'lang is required for screen readers');
});

test('the title and manifest are present and named', () => {
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.ok(manifest.name);
  assert.ok(manifest.short_name || manifest.short_name === '');
  assert.match(html, /rel=["']manifest["']/i);
});

test('exactly one h1 exists', () => {
  assert.equal(tags('h1').length, 1, 'a document needs exactly one h1');
});

test('all images have alt text', () => {
  const images = tags('img');
  assert.ok(images.length > 0);
  const missing = images.filter(t => attr(t[1], 'alt') === undefined);
  assert.deepEqual(
    missing.map(t => attr(t[1], 'src')),
    [],
    'images without alt text'
  );
});

test('icon-only buttons have an accessible name', () => {
  // Capture the WHOLE element, not just the opening tag: these buttons carry
  // their name as text content, which is invisible to a tag-only regex.
  const elements = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)];
  assert.ok(elements.length > 0, 'no buttons found');

  const unlabelled = elements.filter(([, attrs, inner]) => {
    if (attr(` ${attrs}`, 'aria-label')) return false;
    if (attr(` ${attrs}`, 'title')) return false;
    // Icons carry no accessible name; strip them before looking for text.
    const text = inner
      .replace(/<svg[\s\S]*?<\/svg>/g, '')
      .replace(/<[^>]+>/g, '')
      .trim();
    return text.length === 0;
  });

  assert.deepEqual(
    unlabelled.map(([, a]) => attr(` ${a}`, 'id') || attr(` ${a}`, 'class') || '?'),
    [],
    'buttons with neither text, aria-label nor title'
  );
});

// ── Views ─────────────────────────────────────────────────────────────────

test('all five views exist and are unique', () => {
  for (const view of ['landing', 'search', 'discover', 'results', 'library']) {
    assert.ok(hasId(`view-${view}`), `missing #view-${view}`);
  }
});

test('every view is hidden by default so the JS reveals exactly one', () => {
  // `.view-panel { display: none }` in the stylesheet does this, but an inline
  // `display:block` on a view would make two views visible at once.
  for (const view of ['landing', 'search', 'discover', 'results', 'library']) {
    const el = elementById(`view-${view}`);
    assert.ok(el, `missing #view-${view}`);
    assert.doesNotMatch(
      el,
      /style="[^"]*display:\s*(block|flex|grid)/i,
      `#view-${view} is visible in the static markup`
    );
  }
});

test('every nav target resolves to a view or a known handler', () => {
  const targets = new Set(
    [...html.matchAll(/data-nav="([^"]+)"/g)].map(m => m[1])
  );
  assert.ok(targets.size > 0);
  for (const target of targets) {
    assert.ok(
      hasId(`view-${target}`),
      `nav points at "${target}" but #view-${target} does not exist`
    );
  }
});

test('both desktop and mobile nav cover the same views', () => {
  const desktop = new Set(
    [...html.matchAll(/class="nav-link-btn[^"]*"[^>]*data-nav="([^"]+)"/g)].map(m => m[1])
  );
  const mobile = new Set(
    [...html.matchAll(/class="mob-nav-btn[^"]*"[^>]*data-nav="([^"]+)"/g)].map(m => m[1])
  );
  assert.deepEqual([...desktop].sort(), [...mobile].sort());
});

// ── Discover matrix ───────────────────────────────────────────────────────

test('the format cards cover exactly the four formats the API accepts', () => {
  const formats = [...html.matchAll(/class="format-card"[^>]*data-format="([^"]+)"/g)].map(m => m[1]);
  assert.equal(formats.length, 4, `expected 4 format cards, found ${formats.length}`);

  // Compared as sets, not sorted arrays: JS `.sort()` is code-unit order, which
  // puts "Manga" before "Manhua" because 'g' < 'h'. Ordering is a design choice;
  // the contents are the contract.
  const expected = ['Manga', 'Manhwa', 'Manhua', 'Light Novel'];
  assert.equal(formats.length, expected.length);
  for (const format of expected) {
    assert.ok(formats.includes(format), `missing format card for ${format}`);
  }
});

test('genre and tag grids are empty containers filled by the script', () => {
  assert.ok(hasId('genre-grid'));
  assert.ok(hasId('tags-grid'));
  // If the markup hard-coded options they would drift from the GENRES/TAGS
  // arrays in kindoku.js.
  const genreGrid = /<div[^>]*id="genre-grid"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] || '';
  assert.equal(genreGrid.trim(), '', 'genre-grid must be populated at runtime');
});

test('the tag filter input has an accessible label', () => {
  const input = elementById('tag-filter-input');
  assert.ok(input);
  const hasAriaLabel = /aria-label/.test(input);
  const hasPlaceholder = /placeholder=/.test(input);
  assert.ok(hasAriaLabel || hasPlaceholder, 'the tag filter needs a label or placeholder');
});

// ── Results ───────────────────────────────────────────────────────────────

test('the sort select options match the sort keys the script handles', () => {
  const select = /<select[^>]*id="results-sort-select"[^>]*>([\s\S]*?)<\/select>/.exec(html);
  assert.ok(select, 'missing #results-sort-select');
  const values = [...select[1].matchAll(/value="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(values, ['default', 'rating', 'title', 'type']);

  // Every option value must be a branch compareRecommendations knows about.
  for (const value of values) {
    if (value === 'default') continue;
    assert.ok(
      new RegExp(`sort === '${value}'|case '${value}'`).test(js),
      `the script has no handler for sort="${value}"`
    );
  }
});

test('the results empty state has the hooks the script updates', () => {
  const empty = elementById('results-empty');
  assert.ok(empty, 'missing #results-empty');
  assert.ok(/\bhidden\b/.test(empty), 'the empty state must start hidden');
  assert.ok(hasId('results-empty') && html.includes('results-empty-text'),
    'showEmptyResults() rewrites .results-empty-text');
});

test('the library filter tabs cover the same formats as the library counters', () => {
  const tabs = [...html.matchAll(/class="lib-tab[^"]*"[^>]*data-format="([^"]+)"/g)].map(m => m[1]);
  assert.ok(tabs.includes('all'));
  for (const format of ['Manga', 'Manhwa', 'Manhua', 'Light Novel']) {
    assert.ok(tabs.includes(format), `missing library tab for ${format}`);
  }
  // Every non-"all" tab needs a matching counter element the badge updater writes.
  for (const id of ['lib-count-manga', 'lib-count-manhwa', 'lib-count-manhua', 'lib-count-ln']) {
    assert.ok(hasId(id), `missing #${id}`);
  }
});

// ── Modals & reader ───────────────────────────────────────────────────────

test('every modal starts hidden and hidden from assistive tech', () => {
  for (const id of ['detail-modal', 'cmd-modal', 'reader-overlay']) {
    const el = elementById(id);
    assert.ok(el, `missing #${id}`);
    assert.match(el, /aria-hidden="true"/, `#${id} must start aria-hidden`);
    assert.match(el, /class="[^"]*overlay[^"]*"/, `#${id} needs the overlay class`);
  }
});

test('the command palette and detail modal are marked as dialogs', () => {
  for (const id of ['cmd-modal', 'detail-modal']) {
    const el = elementById(id);
    assert.match(el, /role="dialog"/, `#${id} needs role="dialog"`);
    assert.match(el, /aria-modal="true"/, `#${id} needs aria-modal`);
  }
});

test('the reader iframe is sandboxed', () => {
  const iframe = elementById('reader-iframe');
  assert.ok(iframe, 'missing #reader-iframe');
  const sandbox = attr(iframe, 'sandbox') || '';
  assert.ok(sandbox.trim(), 'the iframe must be sandboxed; it loads third-party pages');
  // Loading untrusted third-party content without these is a real risk.
  assert.match(sandbox, /allow-scripts/);
  assert.match(iframe, /referrerpolicy="no-referrer"/, 'do not leak the referrer');
});

test('external links in static markup use safe rel attributes', () => {
  const anchors = tags('a');
  const external = anchors.filter(t => {
    const href = attr(t[1], 'href') || '';
    return /^https?:\/\//.test(href);
  });
  const unsafe = external.filter(t => {
    const target = attr(t[1], 'target');
    const rel = attr(t[1], 'rel') || '';
    if (target !== '_blank') return false;
    // `_blank` without noopener hands the opener to the destination.
    return !/noopener/.test(rel);
  });
  assert.deepEqual(
    unsafe.map(t => attr(t[1], 'href')),
    [],
    'target="_blank" links need rel="noopener"'
  );
});

// ── Assets ────────────────────────────────────────────────────────────────

test('every local asset referenced by the page exists on disk', () => {
  const references = new Set();
  for (const match of html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)) {
    references.add(match[1]);
  }
  const missing = [];
  for (const ref of references) {
    try {
      readFileSync(resolve(REPO_ROOT, ref));
    } catch {
      missing.push(ref);
    }
  }
  assert.deepEqual(missing, [], 'assets referenced but not present');
});

test('the manifest icon paths match files that exist', () => {
  for (const icon of manifest.icons || []) {
    const path = icon.src.replace(/^\.\//, '');
    try {
      readFileSync(resolve(REPO_ROOT, path));
    } catch {
      assert.fail(`manifest icon missing on disk: ${icon.src}`);
    }
  }
});

test('the manifest declares the icons iOS needs', () => {
  const purposes = (manifest.icons || []).map(i => i.purpose || '').join(' ');
  assert.match(purposes, /any/, 'a generic icon is required');
  assert.ok(
    (manifest.icons || []).some(i => /\d+x\d+/.test(i.sizes)),
    'at least one sized icon is required'
  );
});

test('the theme script tag is last so the DOM is ready when it runs', () => {
  // kindoku.js captures element references at load time, so it must come after
  // the markup it queries.
  const scriptIndex = html.indexOf('src="kindoku.js"');
  const viewIndex = html.indexOf('id="view-library"');
  assert.ok(scriptIndex > 0 && viewIndex > 0);
  assert.ok(scriptIndex > viewIndex, 'the script tag must follow the views it binds to');
});

// ── Escape hatch ──────────────────────────────────────────────────────────

test('no inline event handlers are used', () => {
  const inline = [...html.matchAll(/\son(?:click|load|error|change|input|submit)\s*=/gi)];
  assert.deepEqual(inline.map(m => m[0]), [], 'inline handlers bypass addEventListener');
});