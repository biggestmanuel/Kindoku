/**
 * Documentation drift.
 *
 * The README claimed "307 tests" when the suite had 318, and nothing noticed
 * for the same reason nothing notices a stale test count: it is trivia, so it is
 * not worth a test. That reasoning is how it rotted.
 *
 * What is worth guarding is structure. A test file nobody documented is
 * coverage nobody knows exists, an npm script nobody documented is a command
 * nobody runs, and a CI job nobody documented is a check whose failure nobody
 * can explain. Those do not rot silently, because they change the repository
 * when they break rather than only changing a sentence.
 *
 * The count itself is deliberately not asserted: it is regenerated from the
 * files, so writing it down guarantees staleness.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(resolve(REPO_ROOT, ...parts), 'utf8');

const README = read('README.md');
const pkg = JSON.parse(read('package.json'));
const workflow = read('.github', 'workflows', 'ci.yml');

/** The suites `npm test` runs, and therefore the ones the README must cover. */
const OFFLINE_SUITES = readdirSync(resolve(REPO_ROOT, 'tests'))
  .filter(name => name.endsWith('.test.mjs'))
  .filter(name => !['deployed.test.mjs', 'live.test.mjs', 'groq-live.test.mjs'].includes(name))
  .sort();

const NETWORK_SUITES = ['deployed.test.mjs', 'live.test.mjs', 'groq-live.test.mjs'];

test('every test file on disk is documented in the README', () => {
  for (const file of [...OFFLINE_SUITES, ...NETWORK_SUITES]) {
    assert.ok(
      README.includes(file),
      `tests/${file} is not mentioned in the README. Either document what it ` +
      'covers or delete it; undocumented coverage is coverage nobody runs.'
    );
  }
});

test('every test file on disk is actually run by npm test', () => {
  // `npm test` uses an extglob that names the network suites to exclude, so the
  // assertion is on that list: a suite silently dropped from it would never fail
  // CI, and one wrongly added would break every offline run.
  const script = pkg.scripts.test;
  const excluded = /!\(([^)]*)\)/.exec(script);
  assert.ok(excluded, `npm test has no exclusion glob: "${script}"`);

  const stems = excluded[1].split('|').map(s => s.trim()).filter(Boolean);
  for (const file of NETWORK_SUITES) {
    assert.ok(
      stems.includes(file.replace(/\.test\.mjs$/, '')),
      `npm test does not exclude ${file}, which needs the network`
    );
  }
  for (const file of OFFLINE_SUITES) {
    const stem = file.replace(/\.test\.mjs$/, '');
    assert.ok(!stems.includes(stem),
      `npm test excludes ${file} even though it needs no network; it will ` +
      'never run and can silently rot');
    assert.ok(!script.includes(stem),
      `npm test names ${file} in its glob, so its inclusion is ambiguous`);
  }
});

test('every npm script is documented in the README', () => {
  for (const name of Object.keys(pkg.scripts)) {
    assert.ok(
      README.includes(`npm run ${name}`),
      `the "${name}" script is not documented. A script nobody knows about is ` +
      'a script nobody runs.'
    );
  }
});

test('every CI job is documented in the README', () => {
  // Only the keys under `jobs:`, not the `on:` triggers, which are also two-space
  // indented map keys and read exactly the same. `jobs:` is the last top-level
  // key, so the block runs to the end of the file. Note there is no `\Z` in
  // JavaScript regex — it would match a literal "Z".
  const jobsBlock = /^jobs:\n([\s\S]*)$/m.exec(workflow);
  assert.ok(jobsBlock, 'no jobs: block in the workflow');
  const jobs = [...jobsBlock[1].matchAll(/^ {2}([a-z][a-z0-9_-]*):\s*$/gm)].map(m => m[1]);
  assert.ok(jobs.length >= 3, `expected several jobs, found ${jobs.length}`);

  for (const job of jobs) {
    assert.ok(
      README.includes(`\`${job}\``),
      `the CI job "${job}" is not mentioned in the README, so its failures ` +
      'would be unexplainable.'
    );
  }
});

test('the README does not restate a test count', () => {
  // Guarding the absence rather than the value. The count is regenerated from
  // the files on every run, so writing it down in prose guarantees it goes
  // stale, and a stale count reads as authoritative. It already said 307 when
  // the suite had 318.
  assert.doesNotMatch(
    README,
    /\b\d{2,4}\s+tests?\b/i,
    'the README states a test count, which will be wrong the next time a test ' +
    'is added. Point at what `npm test` prints instead.'
  );
});

test('no npm script uses a POSIX-only environment prefix', () => {
  // `FOO=bar cmd` is a shell feature of bash and zsh. npm runs scripts through
  // cmd.exe on Windows, where it is not an assignment but a command name, so
  // the script fails with "'FOO' is not recognized as an internal or external
  // command". That is how `npm run test:live` was broken on the platform this
  // was written on, silently, because CI runs Linux.
  //
  // The fix used here was to drop the flag rather than add a dependency, which
  // is why this asserts the shape instead of suggesting cross-env.
  for (const [name, command] of Object.entries(pkg.scripts)) {
    assert.doesNotMatch(
      command,
      /^\s*[A-Za-z_][A-Za-z0-9_]*\s*=/,
      `the "${name}" script starts with an environment assignment, which cmd.exe ` +
      `cannot parse: "${command}"`
    );
  }
});

test('the README does not claim coverage a removed file provided', () => {
  // A renamed or deleted suite leaves its row behind otherwise.
  const documented = [...README.matchAll(/`([a-z-]+\.test\.mjs)`/g)].map(m => m[1]);
  const onDisk = new Set([...OFFLINE_SUITES, ...NETWORK_SUITES]);
  for (const name of documented) {
    assert.ok(onDisk.has(name),
      `the README documents ${name}, which no longer exists`);
  }
});