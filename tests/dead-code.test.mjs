/**
 * Dead-code and drift checks.
 *
 * I audited these by hand; this file makes the audit repeatable so a future
 * refactor cannot quietly reintroduce the same class of problem.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from './harness.mjs';

const read = name => readFileSync(resolve(REPO_ROOT, name), 'utf8');
const js = read('kindoku.js');
const api = read('api/recommend.js');
const sw = read('sw.js');
const css = read('kindoku.css');
const html = read('index.html');

const sourceFiles = ['kindoku.js', 'kindoku.css', 'api/recommend.js', 'index.html', 'sw.js'];

function countOccurrences(needle, haystack) {
  return (haystack.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
}

// ── Unused declarations in kindoku.js ─────────────────────────────────────

test('every top-level function in kindoku.js is called somewhere', () => {
  const declared = [
    ...js.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm),
  ].map(m => m[1]);

  assert.ok(declared.length > 30, `expected many functions, parsed ${declared.length}`);

  const unused = declared.filter(name => countOccurrences(name, js) < 2);
  assert.deepEqual(unused, [], `declared but never referenced: ${unused.join(', ')}`);
});

test('every top-level const/let in kindoku.js is used', () => {
  const declared = [
    ...js.matchAll(/^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/gm),
  ].map(m => m[1]);

  const unused = declared.filter(name => countOccurrences(name, js) < 2);
  assert.deepEqual(unused, [], `declared but never read: ${unused.join(', ')}`);
});

test('every top-level DOM reference in kindoku.js is used', () => {
  const declared = [
    ...js.matchAll(/^const\s+([A-Za-z_$][\w$]*)\s*=\s*document\./gm),
  ].map(m => m[1]);

  assert.ok(declared.length > 20, `expected many DOM refs, parsed ${declared.length}`);
  const unused = declared.filter(name => countOccurrences(name, js) < 2);
  assert.deepEqual(unused, [], `fetched from the DOM but never used: ${unused.join(', ')}`);
});

// ── Unused CSS ────────────────────────────────────────────────────────────

test('no CSS class is defined that nothing in the project references', () => {
  const defined = new Set(
    [...css.matchAll(/\.([a-z][a-z0-9-]+)/gi)].map(m => m[1])
  );
  assert.ok(defined.size > 100, `expected many classes, parsed ${defined.size}`);

  // A selector fragment may legitimately be unused (e.g. a state only reachable
  // from JS that has since been removed), which is exactly what this catches.
  const haystack = html + js + sw;
  const unused = [...defined].filter(
    name => !new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(haystack)
  );

  assert.deepEqual(
    unused,
    [],
    `CSS classes defined but never used: ${unused.slice(0, 25).join(', ')}`
  );
});

test('every class the stylesheet styles for a JS-toggled state is one the JS toggles', () => {
  // `classList.toggle('x')` and `classList.add('x')` must correspond to a rule.
  const toggled = new Set(
    [...js.matchAll(/classList\.(?:toggle|add|remove)\(\s*'([^']+)'/g)].map(m => m[1])
  );
  assert.ok(toggled.size > 0, 'no classList calls found');

  const unstyled = [...toggled].filter(
    name => !new RegExp(`\\.${name}(?![\\w-])`).test(css)
  );
  assert.deepEqual(unstyled, [], `JS toggles classes with no CSS rule: ${unstyled.join(', ')}`);
});

// ── Unused exports ────────────────────────────────────────────────────────

test('every named export from api/recommend.js is used or tested', () => {
  const exportBlock = /export \{([\s\S]*?)\};/.exec(api);
  assert.ok(exportBlock, 'no named export block found');
  const names = exportBlock[1]
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  assert.ok(names.length > 10, `expected the pure helpers to be exported, got ${names.length}`);

  const testSources = ['api-recommend', 'api-handler', 'budget', 'timing', 'smoke']
    .map(file => read(`tests/${file}.test.mjs`))
    .join('\n');

  const unreferenced = names.filter(name => {
    const usedInApi = countOccurrences(name, api) > 1;
    const usedInTests = countOccurrences(name, testSources) > 0;
    return !usedInApi && !usedInTests;
  });
  assert.deepEqual(
    unreferenced,
    [],
    `exported but neither used internally nor tested: ${unreferenced.join(', ')}`
  );
});

// ── Source hygiene ────────────────────────────────────────────────────────

test('no stray console.log outside the API diagnostics', () => {
  // kindoku.js and sw.js are user-facing; an accidental log is a code smell.
  for (const [name, source] of [['kindoku.js', js], ['sw.js', sw]]) {
    const offenders = [...source.matchAll(/console\.log\([^)]*\)/g)].map(m => m[0]);
    assert.deepEqual(offenders, [], `${name} contains console.log`);
  }
  // api/recommend.js keeps two, both of which are operational diagnostics.
  const apiLogs = [...api.matchAll(/console\.log\(/g)];
  assert.ok(apiLogs.length <= 2, `expected at most 2 diagnostic logs, found ${apiLogs.length}`);
});

test('no TODO or FIXME markers are left behind', () => {
  for (const [name, source] of [
    ['kindoku.js', js],
    ['api/recommend.js', api],
    ['sw.js', sw],
    ['index.html', html],
    ['kindoku.css', css],
  ]) {
    const markers = [...source.matchAll(/\b(?:TODO|FIXME|XXX|HACK)\b/g)].map(m => m[0]);
    assert.deepEqual(markers, [], `${name} contains ${markers.join(', ')}`);
  }
});

test('no debugger statements', () => {
  for (const [name, source] of [['kindoku.js', js], ['api/recommend.js', api], ['sw.js', sw]]) {
    assert.doesNotMatch(source, /\bdebugger\b/, `${name} contains a debugger statement`);
  }
});

test('no raw control characters in any source file', () => {
  // A literal NUL makes a file unreadable to diff tooling and to the read tool,
  // and silently changes the meaning of any test that contains one.
  //
  // CR is included: .gitattributes pins every text file to LF, so a CR is always
  // a defect here. The separate CR check below reports it more clearly.
  for (const name of [...sourceFiles, 'package.json', '.gitattributes']) {
    const bytes = readFileSync(resolve(REPO_ROOT, name));
    const bad = [];
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b === 0x00 || b === 0x0d || (b < 0x09) || (b > 0x0a && b < 0x20) || b === 0x7f) {
        bad.push(`${i}:0x${b.toString(16)}`);
      }
    }
    assert.deepEqual(bad, [], `${name} contains raw control bytes: ${bad.join(', ')}`);
  }
});

test('every source file is valid UTF-8', () => {
  // A file that decodes with replacement characters has been corrupted by a
  // tool that wrote it in the wrong encoding. The damage is invisible in most
  // diffs because the replacement char is a legal byte sequence.
  for (const name of [...sourceFiles, 'package.json', 'README.md']) {
    const bytes = readFileSync(resolve(REPO_ROOT, name));
    assert.doesNotThrow(
      () => new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      `${name} is not valid UTF-8`
    );
  }
});

test('no Unicode replacement characters survived an encoding round-trip', () => {
  // U+FFFD means some byte sequence could not be decoded. The box-drawing
  // comment separators in this codebase are U+2500, not U+FFFD.
  for (const name of [...sourceFiles, 'README.md']) {
    const text = readFileSync(resolve(REPO_ROOT, name), 'utf8');
    const offenders = [...text.matchAll(/\uFFFD/g)];
    assert.deepEqual(
      offenders.map(m => m.index),
      [],
      `${name} contains U+FFFD at ${offenders.map(m => m.index).join(', ')} — the file was written in the wrong encoding`
    );
  }
});

test('line endings are normalised by .gitattributes, not by the checkout', () => {
  // `core.autocrlf=true` on Windows used to write CRLF into the blobs, so the
  // same commit checked out with different bytes on Linux. Two things break:
  // the control-byte check above cannot tell a CRLF from a stray CR, and any
  // test that splits source on "\n" sees a trailing "\r" on one platform only.
  //
  // Asserted on the rule rather than on the working tree, because the working
  // tree's endings depend on the checkout that is running the test.
  const gitattributes = readFileSync(resolve(REPO_ROOT, '.gitattributes'), 'utf8');
  assert.match(gitattributes, /^\*\s+text=auto\s+eol=lf$/m,
    '.gitattributes must pin text files to LF in the repository');
  for (const ext of ['js', 'mjs', 'css', 'html', 'json', 'md', 'yml']) {
    assert.match(
      gitattributes,
      new RegExp(`^\\*\\.${ext}\\s+text\\s+eol=lf$`, 'm'),
      `.gitattributes must pin *.${ext} to LF`
    );
  }
  assert.match(gitattributes, /^\*\.png\s+binary$/m, 'PNGs must be marked binary');
});

test('the shipped files contain no CR at all', () => {
  // With .gitattributes pinning eol=lf, a CR anywhere in a source file is a
  // genuine defect rather than a line ending, so this can be strict.
  for (const name of [...sourceFiles, 'package.json', 'README.md', '.gitattributes']) {
    const text = readFileSync(resolve(REPO_ROOT, name), 'utf8');
    const crs = (text.match(/\r/g) || []).length;
    assert.equal(crs, 0, `${name} contains ${crs} CR characters`);
  }
});

test('the box-drawing comment separators are intact', () => {
  // These separators are the file's section markers. If they have degraded to
  // mojibake the structure is still readable but the damage is real.
  for (const name of ['kindoku.js', 'api/recommend.js', 'sw.js', 'kindoku.css']) {
    const text = readFileSync(resolve(REPO_ROOT, name), 'utf8');
    const separators = (text.match(/\u2500/g) || []).length;
    assert.ok(
      separators >= 5,
      `${name} has only ${separators} intact section separators; expected several`
    );
    // A mojibake banner is broken up by replacement characters, which the
    // U+FFFD check above already catches. This guards the total count so a
    // wholesale rewrite is still visible.
    assert.ok(separators <= 4000, `${name} has ${separators} separator characters, which is implausible`);
  }
});

test('no swallowed errors in the browser code', () => {
  // An empty catch hides real failures. Every catch in kindoku.js must either
  // report to the user or fall back deliberately.
  const emptyCatches = [...js.matchAll(/catch\s*(\([^)]*\))?\s*\{\s*\}/g)];
  assert.deepEqual(
    emptyCatches.map(m => m[0]),
    [],
    'kindoku.js has catch blocks with no body'
  );
});

test('every catch in the API either recovers or explains itself', () => {
  // api/recommend.js deliberately swallows upstream failures so a dead Groq or
  // AniList degrades instead of 500ing. Each catch must therefore contain a
  // recovery statement, or carry a comment saying why nothing is needed.
  const lines = api.split('\n');
  const suspicious = [];

  lines.forEach((line, index) => {
    const match = /^\s*}\s*catch\s*(\([^)]*\))?\s*\{\s*$/.exec(line);
    if (!match) return;

    // Collect the catch body by brace balance.
    const body = [];
    let depth = 1;
    for (let i = index + 1; i < lines.length && depth > 0; i++) {
      depth += (lines[i].match(/\{/g) || []).length;
      depth -= (lines[i].match(/\}/g) || []).length;
      if (depth > 0 || lines[i].trim() !== '}') body.push(lines[i]);
    }
    const bodyText = body.join('\n');

    // Recovery may be a return/break/continue, an assignment to a fallback
    // value, or a log. An assignment counts: `results[index] = fallback` is
    // exactly the intended recovery.
    const recovers =
      /\b(return|break|continue|throw)\b/.test(bodyText) ||
      /console\./.test(bodyText) ||
      /\w[\w.\[\]]*\s*=\s*\S/.test(bodyText);
    // An empty body is legitimate only when the comment explains the intent.
    const explains = bodyText.trim().length === 0
      ? bodyText.trim() === '' && /^\s*\/\//.test(body.join(''))
      : /\/\/[^\n]*\b(try|attempt|fall ?back|ignore|expected|next|unreachable|skipped)\b/i.test(bodyText);

    if (!recovers && !explains) {
      suspicious.push(`${index + 2}: ${line.trim()}`);
    }
  });

  assert.deepEqual(suspicious, [], `catch blocks with no visible recovery: ${suspicious.join(' | ')}`);
});

// ── Size budget ───────────────────────────────────────────────────────────

test('the shipped bundle stays small enough to be worth precaching', () => {
  // The service worker precaches these on every install. A runaway file would
  // make the app slow to become usable offline.
  const limits = {
    'kindoku.js': 120 * 1024,
    'kindoku.css': 200 * 1024,
    'index.html': 80 * 1024,
    'sw.js': 16 * 1024,
    'api/recommend.js': 64 * 1024,
  };

  for (const [name, limit] of Object.entries(limits)) {
    const size = statSync(resolve(REPO_ROOT, name)).size;
    assert.ok(
      size <= limit,
      `${name} is ${Math.round(size / 1024)}KB, over its ${Math.round(limit / 1024)}KB budget`
    );
  }
});

test('the service worker precache is not bloated', () => {
  const assets = [...sw.matchAll(/'(\.\/[^']*)'/g)]
    .map(m => m[1])
    .filter(a => a !== './' && !a.startsWith('./api'));
  assert.ok(
    assets.length <= 20,
    `${assets.length} precached assets; every one is downloaded on install`
  );
});

// ── Cross-file constant agreement ─────────────────────────────────────────

test('every data-format value in the HTML is one the API accepts', () => {
  const valid = new Set(['Manga', 'Manhwa', 'Manhua', 'Light Novel', 'all']);
  const used = [...html.matchAll(/data-format="([^"]+)"/g)].map(m => m[1]);
  for (const value of used) {
    assert.ok(valid.has(value), `unexpected data-format="${value}"`);
  }
});

test('the service worker precache list matches the files that exist', () => {
  const assets = [...sw.matchAll(/'(\.\/[^']*)'/g)].map(m => m[1]).filter(a => a !== './');
  for (const asset of assets) {
    assert.doesNotThrow(
      () => readFileSync(resolve(REPO_ROOT, asset)),
      `sw.js precaches missing file ${asset}`
    );
  }
});
