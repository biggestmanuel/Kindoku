/**
 * Minimal DOM + browser-API stubs, just enough to execute `kindoku.js` under
 * Node. `kindoku.js` is a classic (non-module) browser script whose top-level
 * `function` declarations become properties of the global object, so running it
 * inside a vm context exposes its pure helpers to the test suite.
 *
 * Anything the script touches during load must exist here, otherwise the load
 * itself throws and every test reports the same misleading failure.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..');

class ClassList {
  constructor(...initial) {
    this.set = new Set(initial);
  }
  add(...names) {
    names.forEach(n => n && this.set.add(n));
  }
  remove(...names) {
    names.forEach(n => this.set.delete(n));
  }
  toggle(name, force) {
    const next = force === undefined ? !this.set.has(name) : Boolean(force);
    if (next) this.set.add(name);
    else this.set.delete(name);
    return next;
  }
  contains(name) {
    return this.set.has(name);
  }
}

class FakeElement {
  constructor(tag = 'div', doc = null) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.classList = new ClassList();
    this._innerHTML = '';
    this._textContent = '';
    this.listeners = new Map();
    this.hidden = false;
    this.value = '';
    this.disabled = false;
    this.href = '';
    this.title = '';
    this.id = '';
    this.className = '';
  }

  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(html) {
    this._innerHTML = String(html);
    // Only the handful of selectors the script actually queries after an
    // innerHTML write. Anything else resolves to an empty list, which is what
    // a real browser would do for a selector it cannot match.
    const found = [];
    for (const re of [
      /<button[^>]*class="[^"]*card-bookmark-btn[^"]*"[^>]*data-title="([^"]*)"/g,
      /<button[^>]*data-title="([^"]*)"[^>]*class="[^"]*card-bookmark-btn[^"]*"/g,
    ]) {
      let m;
      while ((m = re.exec(this._innerHTML))) found.push(m[1]);
    }
    this._matches = found.map(encoded => {
      const btn = new FakeElement('button', this.ownerDocument);
      btn.classList.add('card-bookmark-btn');
      try {
        btn.dataset.title = decodeURIComponent(encoded);
      } catch {
        btn.dataset.title = encoded;
      }
      return btn;
    });
  }

  get textContent() {
    return this._textContent;
  }
  set textContent(value) {
    this._textContent = String(value);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }
  insertAdjacentElement(position, element) {
    this.children.push(element);
    return element;
  }
  remove() {
    /* no-op */
  }
  focus() {
    /* no-op */
  }
  click() {
    this.dispatchEvent({ type: 'click' });
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') this.id = String(value);
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  removeEventListener(type, handler) {
    const list = this.listeners.get(type);
    if (list) this.listeners.set(type, list.filter(h => h !== handler));
  }
  dispatchEvent(event) {
    event.target = event.target || this;
    event.currentTarget = this;
    event.stopPropagation = event.stopPropagation || (() => {});
    event.preventDefault = event.preventDefault || (() => {});
    for (const handler of this.listeners.get(event.type) || []) handler(event);
    return true;
  }
  querySelector() {
    return null;
  }
  querySelectorAll(selector) {
    if (selector === '.card-bookmark-btn') return this._matches || [];
    return [];
  }
  closest() {
    return null;
  }
  getContext() {
    return {
      clearRect() {},
      save() {},
      restore() {},
      beginPath() {},
      arc() {},
      fill() {},
      set fillStyle(_v) {},
      set globalAlpha(_v) {},
      set shadowBlur(_v) {},
      set shadowColor(_v) {},
    };
  }
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement('body', this);
    this.documentElement = new FakeElement('html', this);
    this.listeners = new Map();
    this.head = new FakeElement('head', this);
    this.readyState = 'complete';
    // Registered stand-ins for the real page's elements. `kindoku.js` looks
    // every one of them up by id at load time and skips the ones that are
    // missing, so a test that exercises an overlay must register it.
    this.byId = new Map();
  }
  createElement(tag) {
    return new FakeElement(tag, this);
  }
  getElementById(id) {
    return this.byId.get(id) ?? null;
  }
  /** Create and register an element the app can then find by id. */
  provide(id, tag = 'div') {
    const element = new FakeElement(tag, this);
    element.id = id;
    this.byId.set(id, element);
    return element;
  }
  /** Register a caller-built stand-in for an element the app looks up by id. */
  provideCustom(id, element) {
    element.id = id;
    this.byId.set(id, element);
    return element;
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  removeEventListener() {}
  dispatchEvent(event) {
    for (const handler of this.listeners.get(event.type) || []) handler(event);
    return true;
  }
  execCommand() {
    return true;
  }
}

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

function createSandbox({ localStorage: seedStorage, provide = [], elements = {} } = {}) {
  const document = new FakeDocument();
  // `kindoku.js` captures its element references at load time, so anything a
  // test needs must exist before the script runs.
  for (const id of provide) document.provide(id);
  // Caller-built stand-ins, for elements whose internals the test asserts on.
  for (const [id, element] of Object.entries(elements)) {
    document.provideCustom(id, element);
  }
  const localStorage = seedStorage || new MemoryStorage();
  const navigator = { userAgent: 'node-test', clipboard: undefined };
  const location = { href: 'https://example.test/' };

  const win = {
    document,
    localStorage,
    navigator,
    location,
    innerWidth: 1280,
    innerHeight: 800,
    scrollTo() {},
    open() {
      return null;
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
  };
  win.window = win;
  win.self = win;

  return {
    document,
    localStorage,
    navigator,
    location,
    window: win,
    innerWidth: win.innerWidth,
    innerHeight: win.innerHeight,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    fetch: async () => {
      throw new Error('fetch is not available in the sandbox');
    },
    Blob: class {},
    FileReader: class {},
    URL: { createObjectURL: () => 'blob:', revokeObjectURL() {} },
  };
}

/**
 * Executes kindoku.js and returns the browser globals it defined.
 *
 * The source is compiled with `vm.compileFunction` rather than run in a separate
 * context so that the script shares this realm's intrinsics. Without that, every
 * array the script produced had a *different* `Array.prototype` than the test
 * file's, and `assert.deepEqual` reported "same structure but not reference-equal"
 * on values that were in fact correct.
 */
export function loadApp(options) {
  const globals = createSandbox(options);
  const source = readFileSync(resolve(REPO_ROOT, 'kindoku.js'), 'utf8');

  // `kindoku.js` is a classic script, not a module: its top-level declarations
  // are supposed to land on the global object. Compiling it as a function body
  // keeps them local instead, so the script's own top-level names are collected
  // and returned explicitly. Only column-0 declarations are top-level, which is
  // exactly the convention this file follows.
  const exported = [
    ...source.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm),
    ...source.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm),
    ...source.matchAll(/^class\s+([A-Za-z_$][\w$]*)/gm),
  ].map(match => match[1]);
  const names = [...new Set(exported)];

  const factory = vm.compileFunction(
    `${source}\n;return { ${names.join(', ')} };`,
    [
      'document', 'localStorage', 'navigator', 'location', 'window',
      'innerWidth', 'innerHeight', 'requestAnimationFrame', 'cancelAnimationFrame',
      'fetch', 'Blob', 'FileReader', 'URL',
    ],
    { filename: 'kindoku.js' }
  );

  const app = factory(
    globals.document,
    globals.localStorage,
    globals.navigator,
    globals.location,
    globals.window,
    globals.innerWidth,
    globals.innerHeight,
    globals.requestAnimationFrame,
    globals.cancelAnimationFrame,
    globals.fetch,
    globals.Blob,
    globals.FileReader,
    globals.URL
  );

  return { ...app, ...globals };
}

export { FakeElement, MemoryStorage };