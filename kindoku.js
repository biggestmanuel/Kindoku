/* ==========================================================================
   KINDOKU (金 · 흑 · 読) — MAIN APPLICATION SCRIPT
   Architecture: High-Performance Vanilla ES6+ State & UI Controller
   ========================================================================== */

// ── HTML Escaping ──────────────────────────────────────────────────────────
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Toast Notification Engine ──────────────────────────────────────────────
const toastContainer = document.getElementById('toast-container');
function showToast(message, icon = '✦', duration = 3200) {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  // The icon is a caller-supplied string, so it gets escaped like the message.
  toast.innerHTML = `<span class="toast-icon">${escapeHtml(icon)}</span><span>${escapeHtml(message)}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px) scale(0.9)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Theme Engine ───────────────────────────────────────────────────────────
const THEMES = ['gold', 'crimson', 'jade', 'amethyst', 'azure'];
const THEME_NAMES = {
  gold: 'Imperial Gold',
  crimson: 'Crimson Ronin',
  jade: 'Jade Sovereign',
  amethyst: 'Amethyst Void',
  azure: 'Cyber Azure',
};

const themeMenuBtn = document.getElementById('theme-menu-btn');
const themeMenu = document.getElementById('theme-menu');
const themeCurrentName = document.querySelector('.theme-current-name');

function applyTheme(themeName) {
  if (!THEMES.includes(themeName)) themeName = 'gold';
  document.documentElement.setAttribute('data-theme', themeName);
  localStorage.setItem('kindoku_theme', themeName);
  if (themeCurrentName) {
    // Use the display name from the menu ("Imperial Gold"), not the raw key
    // ("Gold") — the menu entry and the toast already showed the full name.
    themeCurrentName.textContent = THEME_NAMES[themeName] || themeName;
  }
}

const savedTheme = localStorage.getItem('kindoku_theme') || 'gold';
applyTheme(savedTheme);

if (themeMenuBtn && themeMenu) {
  themeMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    themeMenu.classList.toggle('show');
  });

  document.addEventListener('click', (e) => {
    if (!themeMenu.contains(e.target) && e.target !== themeMenuBtn) {
      themeMenu.classList.remove('show');
    }
  });

  themeMenu.querySelectorAll('.theme-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      applyTheme(theme);
      themeMenu.classList.remove('show');
      showToast(`Theme switched to ${THEME_NAMES[theme]}`, '🎨');
    });
  });
}

// ── Interactive Particle Canvas ────────────────────────────────────────────
const canvas = document.getElementById('particle-canvas');
const ctx = canvas ? canvas.getContext('2d') : null;
let particles = [];
let mouseX = -1000;
let mouseY = -1000;

function resizeCanvas() {
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

class Particle {
  constructor() { this.reset(true); }
  reset(initial = false) {
    if (!canvas) return;
    this.x = Math.random() * canvas.width;
    this.y = initial ? Math.random() * canvas.height : canvas.height + 10;
    this.size = Math.random() * 2.2 + 0.4;
    this.baseSpeedY = -(Math.random() * 0.45 + 0.15);
    this.speedY = this.baseSpeedY;
    this.speedX = (Math.random() - 0.5) * 0.35;
    this.opacity = Math.random() * 0.65 + 0.15;
    this.opacitySpeed = (Math.random() * 0.006 + 0.002) * (Math.random() > 0.5 ? 1 : -1);
    this.twinkle = Math.random() > 0.5;
    this.twinkleSpeed = Math.random() * 0.03 + 0.01;
    this.twinkleOffset = Math.random() * Math.PI * 2;

    // Color distribution based on active theme
    const theme = document.documentElement.getAttribute('data-theme') || 'gold';
    if (theme === 'crimson') {
      this.color = Math.random() > 0.3 ? `rgb(${230 + Math.random()*25}, ${70 + Math.random()*40}, ${60 + Math.random()*30})` : 'rgb(240, 180, 100)';
    } else if (theme === 'jade') {
      this.color = Math.random() > 0.3 ? `rgb(${26 + Math.random()*40}, ${188 + Math.random()*40}, ${156 + Math.random()*40})` : 'rgb(100, 240, 200)';
    } else if (theme === 'amethyst') {
      this.color = Math.random() > 0.3 ? `rgb(${187 + Math.random()*40}, ${134 + Math.random()*40}, ${252})` : 'rgb(220, 180, 255)';
    } else if (theme === 'azure') {
      this.color = Math.random() > 0.3 ? `rgb(${100 + Math.random()*40}, ${210 + Math.random()*40}, ${255})` : 'rgb(180, 235, 255)';
    } else {
      this.color = Math.random() > 0.25 ? `rgb(${200 + Math.random()*55}, ${160 + Math.random()*50}, ${40 + Math.random()*40})` : 'rgb(255, 120, 80)';
    }
  }

  update() {
    // Mouse interaction repulsion/swirl
    const dx = this.x - mouseX;
    const dy = this.y - mouseY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // `dist` is exactly 0 whenever a particle is spawned under (or drifts onto)
    // the cursor. Dividing by it yields NaN, which permanently poisons this
    // particle's coordinates and silently deletes it from the canvas.
    if (dist > 0 && dist < 120) {
      const force = (120 - dist) / 120;
      this.x += (dx / dist) * force * 2.5;
      this.y += (dy / dist) * force * 2.5;
    }

    this.x += this.speedX;
    this.y += this.speedY;
    this.opacity += this.opacitySpeed;
    if (this.opacity > 0.85 || this.opacity < 0.05) this.opacitySpeed *= -1;
    if (this.y < -10 || this.x < -10 || this.x > (canvas ? canvas.width + 10 : 2000)) this.reset();
  }

  draw(t) {
    if (!ctx) return;
    let op = this.opacity;
    if (this.twinkle) op *= (0.5 + 0.5 * Math.sin(t * this.twinkleSpeed + this.twinkleOffset));
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, op));
    ctx.fillStyle = this.color;
    if (this.size > 1.4) {
      ctx.shadowBlur = 8;
      ctx.shadowColor = this.color;
    }
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function initParticles() {
  if (!canvas) return;
  particles = [];
  const count = Math.min(Math.floor((canvas.width * canvas.height) / 7500), 160);
  for (let i = 0; i < count; i++) particles.push(new Particle());
}

// ── Reduced motion ──────────────────────────────────────────────────────────
// The landing page has three continuously floating orbs, a pulsing logo and up to
// 160 particles repainting every frame. Someone who has asked the operating
// system for reduced motion gets none of that.
//
// Checked live rather than once at load, because the preference can be toggled
// while the page is open. When reduced: the particle field is drawn once as a
// static field and the animation loop never starts, which also stops 60fps
// repainting of a full-viewport canvas. Flipping the preference back starts it.
//
// Declared above the load-time canvas setup below: that code runs during
// evaluation and reads these, so a `const` further down the file would be in
// its temporal dead zone and throw on every page load.
const reduceMotionQuery = window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false, addEventListener() { }, removeEventListener() { }, addListener() { }, removeListener() { } };

let particleFrame = null;

function prefersReducedMotion() {
  return reduceMotionQuery.matches === true;
}

function drawParticlesOnce() {
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles.forEach(p => p.draw(0));
}

function startParticles() {
  if (particleFrame || prefersReducedMotion()) return;
  particleFrame = requestAnimationFrame(function step(t) {
    if (!ctx || !canvas) { particleFrame = null; return; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => { p.update(); p.draw(t); });
    particleFrame = requestAnimationFrame(step);
  });
}

function stopParticles() {
  if (!particleFrame) return;
  cancelAnimationFrame(particleFrame);
  particleFrame = null;
}

function syncParticlesWithMotionPreference() {
  if (prefersReducedMotion()) {
    stopParticles();
    drawParticlesOnce();
  } else {
    startParticles();
  }
}
// Debounced so a drag-resize doesn't rebuild the whole particle field on every
// single resize event.
let resizeFrame = null;
if (canvas) {
  window.addEventListener('resize', () => {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      resizeCanvas();
      initParticles();
    });
  });
  window.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });
  // `mouseleave` never fires on `window` — it is an element-level event that
  // only bubbles *down*. Listening on the document is what actually reports
  // "the pointer left the page"; without it the last cursor position keeps
  // repelling particles after the pointer is gone.
  document.addEventListener('mouseleave', () => { mouseX = -1000; mouseY = -1000; });
  // `blur` covers the pointer leaving the window while it keeps focus.
  window.addEventListener('blur', () => { mouseX = -1000; mouseY = -1000; });
  resizeCanvas();
  initParticles();
  syncParticlesWithMotionPreference();

  // Safari below 14 only has the deprecated addListener API.
  if (typeof reduceMotionQuery.addEventListener === 'function') {
    reduceMotionQuery.addEventListener('change', syncParticlesWithMotionPreference);
  } else if (typeof reduceMotionQuery.addListener === 'function') {
    reduceMotionQuery.addListener(syncParticlesWithMotionPreference);
  }
}

// ── Master Constants & Discovery Data ──────────────────────────────────────
const GENRES = [
  { label: 'Action', icon: '⚔️' }, { label: 'Adventure', icon: '🗺️' },
  { label: 'Fantasy', icon: '🌌' }, { label: 'Romance', icon: '🌸' },
  { label: 'Comedy', icon: '😂' }, { label: 'Drama', icon: '🎭' },
  { label: 'Slice of Life', icon: '☕' }, { label: 'Horror', icon: '👁️' },
  { label: 'Mystery', icon: '🔍' }, { label: 'Psychological', icon: '🧠' },
  { label: 'Sci-Fi', icon: '🚀' }, { label: 'Historical', icon: '📜' },
  { label: 'Sports', icon: '⚽' }, { label: 'Martial Arts', icon: '🥋' },
  { label: 'Supernatural', icon: '👻' },
];

const TAGS = [
  'Isekai', 'Regression', 'System', 'Dungeon', 'Hunter',
  'Murim', 'Cultivation', 'Reincarnation', 'Villainess', 'Magic',
  'School Life', 'Survival', 'Time Travel', 'Revenge', 'OP MC',
  'Kingdom Building', 'Academy', 'Demons', 'Necromancer', 'Tower Climbing',
  'Modern Day', 'Monsters', 'Crafting', 'Beast Taming', 'Female Protagonist',
  'Gods', 'Virtual Reality', 'Nobility', 'Politics', 'Slow Burn'
];

const PRESETS = {
  tower: {
    formats: ['Manhwa'],
    genres: ['Action', 'Fantasy'],
    tags: ['Tower Climbing', 'System', 'Hunter', 'Necromancer', 'OP MC'],
    prompt: 'Tower climbing with unique awakening and system quests',
  },
  murim: {
    formats: ['Manhwa', 'Manhua'],
    genres: ['Action', 'Martial Arts', 'Historical'],
    tags: ['Murim', 'Cultivation', 'Revenge', 'Regression'],
    prompt: 'Heavenly Demon lineage, intense sword martial arts and sects',
  },
  villainess: {
    formats: ['Manga', 'Manhwa'],
    genres: ['Fantasy', 'Romance', 'Drama'],
    tags: ['Villainess', 'Reincarnation', 'Nobility', 'Time Travel'],
    prompt: 'Reincarnated as a doomed otome villainess changing destiny with wit',
  },
  grimdark: {
    formats: ['Manga'],
    genres: ['Horror', 'Psychological', 'Action', 'Drama'],
    tags: ['Survival', 'Revenge', 'Demons'],
    prompt: 'Brutal dark fantasy with high stakes and psychological depth like Berserk',
  },
  academy: {
    formats: ['Manga', 'Manhwa', 'Light Novel'],
    genres: ['Fantasy', 'Action', 'Adventure'],
    tags: ['Academy', 'Magic', 'School Life', 'OP MC'],
    prompt: 'Magic academy prodigy hiding true supreme power',
  },
  cozy: {
    formats: ['Manga', 'Light Novel'],
    genres: ['Slice of Life', 'Comedy', 'Fantasy'],
    tags: ['Crafting', 'Beast Taming', 'Slow Burn'],
    prompt: 'Relaxing wholesome fantasy with cooking, crafting, and friendly beasts',
  }
};

// ── Application State ──────────────────────────────────────────────────────
let selectedGenres = new Set();
let selectedTags = new Set();
let selectedFormats = new Set();
let currentQuery = { mode: 'discover', genres: [], tags: [], formats: [], customInput: '', searchInput: '' };
let allRecommendations = [];
let filteredRecommendations = [];
let previousView = 'landing';
let currentView = 'landing';
let searchMode = 'all';
let viewLayout = 'grid';
let currentSort = 'default';
// Which AniList results page "Load More" is asking for next.
let currentPage = 1;
// Set once the server reports it has nothing more; hides the button.
let loadMoreExhausted = false;

// ── DOM References ─────────────────────────────────────────────────────────
const views = {
  landing: document.getElementById('view-landing'),
  search: document.getElementById('view-search'),
  discover: document.getElementById('view-discover'),
  results: document.getElementById('view-results'),
  library: document.getElementById('view-library'),
};

const genreGrid = document.getElementById('genre-grid');
const tagsGrid = document.getElementById('tags-grid');
const tagFilterInput = document.getElementById('tag-filter-input');
const formatCards = document.querySelectorAll('.format-card');
const customInput = document.getElementById('custom-input');
const discoverBtn = document.getElementById('discover-btn');
const genreSelectedCount = document.getElementById('genre-selected-count');
const formatSelectedCount = document.getElementById('format-selected-count');

// Search View DOM
const searchInput = document.getElementById('search-input');
const searchSubmitBtn = document.getElementById('search-submit-btn');
const searchClearBtn = document.getElementById('search-clear-btn');
const searchInlineMsg = document.getElementById('search-inline-msg');
const discoverInlineMsg = document.getElementById('discover-inline-msg');
const searchModeTabs = document.querySelectorAll('.mode-tab');
const recentSearchesBox = document.getElementById('recent-searches-box');
const recentChips = document.getElementById('recent-chips');
const recentClearBtn = document.getElementById('recent-clear-btn');

// Results View DOM
const resultsContent = document.getElementById('results-content');
const resultsTitle = document.getElementById('results-title');
const resultsMeta = document.getElementById('results-meta');
const resultsQueryTags = document.getElementById('results-query-tags');
const cardsGrid = document.getElementById('cards-grid');
const loadingEl = document.getElementById('loading');
const errorMsg = document.getElementById('error-msg');
const resultsEmpty = document.getElementById('results-empty');
const loadMoreWrapper = document.getElementById('load-more-wrapper');
const loadMoreBtn = document.getElementById('load-more-btn');
const loadMoreText = document.getElementById('load-more-text');
const resultsFilterInput = document.getElementById('results-filter-input');
const resultsSortSelect = document.getElementById('results-sort-select');
const viewModeBtns = document.querySelectorAll('.view-mode-btn');

// Library DOM
const libraryCardsGrid = document.getElementById('library-cards-grid');
const libraryEmpty = document.getElementById('library-empty');
const libraryNoMatches = document.getElementById('library-no-matches');
const libraryNoMatchesText = document.getElementById('library-no-matches-text');
const librarySearchInput = document.getElementById('library-search-input');
const libraryFormatFilters = document.getElementById('library-format-filters');
const navLibraryCount = document.getElementById('nav-library-count');
const libraryExportBtn = document.getElementById('library-export-btn');
const libraryImportBtn = document.getElementById('library-import-btn');
const libraryFileInput = document.getElementById('library-file-input');

// Modals DOM
const detailModal = document.getElementById('detail-modal');
const detailModalContent = document.getElementById('detail-modal-content');
const detailModalClose = document.getElementById('detail-modal-close');
const cmdModal = document.getElementById('cmd-modal');
const cmdTriggerBtn = document.getElementById('cmd-trigger-btn');
const cmdInput = document.getElementById('cmd-input');
const cmdResultsList = document.getElementById('cmd-results-list');
const cmdEmptyState = document.getElementById('cmd-empty-state');

// Reader DOM
const readerOverlay = document.getElementById('reader-overlay');
const readerCloseBtn = document.getElementById('reader-close-btn');
const readerTitle = document.getElementById('reader-title');
const readerExternalBtn = document.getElementById('reader-external-btn');
const readerCopyLinkBtn = document.getElementById('reader-copy-link-btn');
const readerIframe = document.getElementById('reader-iframe');
const readerLoading = document.getElementById('reader-loading');
const readerBlocked = document.getElementById('reader-blocked');
const readerBlockedExternalBtn = document.getElementById('reader-blocked-external-btn');
const readerAltChips = document.getElementById('reader-alt-chips');

// The reader, the detail modal and the command palette each used to set and
// clear `body.style.overflow` independently, so closing one while another was
// still open re-enabled scrolling behind a visible overlay. A stack makes the
// lock owned by "is anything open" rather than by any single overlay.
const openOverlays = new Set();
let bodyScrollLocked = false;

function syncBodyScrollLock() {
  const shouldLock = openOverlays.size > 0;
  if (shouldLock === bodyScrollLocked) return;
  bodyScrollLocked = shouldLock;
  document.body.style.overflow = shouldLock ? 'hidden' : '';
}

function pushOverlay(name) {
  openOverlays.add(name);
  syncBodyScrollLock();
}

function popOverlay(name) {
  openOverlays.delete(name);
  syncBodyScrollLock();
}

// Translate buttons aren't in the static HTML — they're created once on first
// use and reused after that (see openReader).
let readerTranslateBtn = document.getElementById('reader-translate-btn');
let readerBlockedTranslateBtn = document.getElementById('reader-blocked-translate-btn');

// ── Bookmarks / Library Manager ────────────────────────────────────────────
// `isBookmarked` runs once per card on every render. Without a cache that meant
// re-parsing the entire localStorage array dozens of times to draw one screen of
// results. `saveLibraryBookmarks` drops the cache, so it cannot go stale.
let libraryCache = null;

function normalizeTitle(value) {
  return String(value ?? '').trim().toLowerCase();
}

// A stored bookmark, or null if the record is unusable. Library data comes from
// localStorage *and* from user-supplied JSON files, so every record has to be
// shape-checked before it can touch `title.toLowerCase()`.
function normalizeBookmark(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  if (!title) return null;
  return {
    ...record,
    title,
    type: typeof record.type === 'string' && record.type ? record.type : 'Manga',
    genre: Array.isArray(record.genre)
      ? record.genre.filter(g => typeof g === 'string')
      : [],
    synopsis: typeof record.synopsis === 'string' ? record.synopsis : '',
    status: typeof record.status === 'string' && record.status ? record.status : 'Ongoing',
    rating: typeof record.rating === 'string' || typeof record.rating === 'number'
      ? String(record.rating)
      : '',
    savedAt: Number.isFinite(record.savedAt) ? record.savedAt : Date.now(),
  };
}

// Imports win over existing entries (they carry the user's newest metadata),
// first occurrence of a given title wins, and the result is capped so a
// pathological file can't grow localStorage without bound.
function mergeLibraryBookmarks(imported, current, limit = 500) {
  const seen = new Set();
  const merged = [];
  for (const record of [...toArray(imported), ...toArray(current)]) {
    const bookmark = normalizeBookmark(record);
    if (!bookmark) continue;
    const key = normalizeTitle(bookmark.title);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(bookmark);
    if (merged.length >= limit) break;
  }
  return merged;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function getLibraryBookmarks() {
  if (libraryCache) return libraryCache;
  try {
    const parsed = JSON.parse(localStorage.getItem('kindoku_library') || '[]');
    libraryCache = Array.isArray(parsed)
      ? parsed.map(normalizeBookmark).filter(Boolean)
      : [];
  } catch {
    // A previously-stored but malformed entry (from an older buggy import)
    // must not crash every render.
    libraryCache = [];
  }
  return libraryCache;
}

function invalidateLibraryCache() {
  libraryCache = null;
}

function saveLibraryBookmarks(items) {
  localStorage.setItem('kindoku_library', JSON.stringify(toArray(items)));
  invalidateLibraryCache();
  updateLibraryBadge();
}

function isBookmarked(title) {
  const key = normalizeTitle(title);
  if (!key) return false;
  return getLibraryBookmarks().some(item => normalizeTitle(item.title) === key);
}

function toggleBookmark(rec) {
  const bookmark = normalizeBookmark(rec);
  if (!bookmark) {
    showToast('Could not save this title — it has no title.', '⚠');
    return;
  }
  const key = normalizeTitle(bookmark.title);
  const list = getLibraryBookmarks();
  const exists = list.some(item => normalizeTitle(item.title) === key);
  if (exists) {
    saveLibraryBookmarks(list.filter(item => normalizeTitle(item.title) !== key));
    showToast(`Removed "${bookmark.title}" from Library`, '🗑️');
  } else {
    saveLibraryBookmarks([{ ...bookmark, savedAt: Date.now() }, ...list]);
    showToast(`Saved "${bookmark.title}" to Library!`, '🔖');
  }
  updateBookmarkButtons(bookmark.title);
  if (currentView === 'library') renderLibrary();
}

function updateLibraryBadge() {
  const list = getLibraryBookmarks();
  if (navLibraryCount) navLibraryCount.textContent = list.length;
  const countAll = document.getElementById('lib-count-all');
  const countManga = document.getElementById('lib-count-manga');
  const countManhwa = document.getElementById('lib-count-manhwa');
  const countManhua = document.getElementById('lib-count-manhua');
  const countLn = document.getElementById('lib-count-ln');
  const typeOf = item => String(item.type || '').toLowerCase();

  if (countAll) countAll.textContent = list.length;
  if (countManga) countManga.textContent = list.filter(i => typeOf(i) === 'manga').length;
  if (countManhwa) countManhwa.textContent = list.filter(i => typeOf(i) === 'manhwa').length;
  if (countManhua) countManhua.textContent = list.filter(i => typeOf(i) === 'manhua').length;
  if (countLn) countLn.textContent = list.filter(i => typeOf(i).includes('novel')).length;
}

function updateBookmarkButtons(title) {
  const saved = isBookmarked(title);
  document.querySelectorAll(`.card-bookmark-btn[data-title="${encodeURIComponent(title)}"]`).forEach(btn => {
    btn.classList.toggle('saved', saved);
    btn.title = saved ? 'Remove from Library' : 'Save to Library';
    btn.setAttribute('aria-pressed', saved ? 'true' : 'false');
    btn.innerHTML = saved
      ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>`
      : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>`;
  });
}

// ── Search History Manager ─────────────────────────────────────────────────
function getSearchHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem('kindoku_history') || '[]');
    return Array.isArray(parsed) ? parsed.filter(q => typeof q === 'string' && q.trim()) : [];
  } catch {
    return [];
  }
}

// Newest first, case-insensitively de-duplicated, capped.
function addSearchHistory(query) {
  const entry = typeof query === 'string' ? query.trim() : '';
  if (entry.length < 2) return;
  const key = normalizeTitle(entry);
  const history = [
    entry,
    ...getSearchHistory().filter(q => normalizeTitle(q) !== key),
  ].slice(0, 10);
  localStorage.setItem('kindoku_history', JSON.stringify(history));
  renderSearchHistory();
}

function renderSearchHistory() {
  if (!recentSearchesBox || !recentChips) return;
  const history = getSearchHistory();
  if (!history.length) {
    recentSearchesBox.style.display = 'none';
    return;
  }
  recentSearchesBox.style.display = 'block';
  recentChips.innerHTML = history
    .map(q => `<button type="button" class="recent-chip" data-search="${escapeHtml(q)}">${escapeHtml(q)}</button>`)
    .join('');

  recentChips.querySelectorAll('.recent-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      if (searchInput) searchInput.value = btn.dataset.search;
      submitSearch();
    });
  });
}

if (recentClearBtn) {
  recentClearBtn.addEventListener('click', () => {
    localStorage.removeItem('kindoku_history');
    renderSearchHistory();
    showToast('Search history cleared', '🧹');
  });
}

// ── View Switching & Nav Routing ───────────────────────────────────────────
function switchView(targetName) {
  if (!views[targetName]) return;
  previousView = currentView !== targetName ? currentView : previousView;
  currentView = targetName;

  Object.values(views).forEach(v => {
    if (v) {
      v.classList.remove('view-active', 'view-enter');
      v.style.display = 'none';
    }
  });

  const activeViewEl = views[targetName];
  activeViewEl.style.display = 'block';
  activeViewEl.classList.add('view-active', 'view-enter');

  // Update navbar active link
  document.querySelectorAll('.nav-link-btn, .mob-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.nav === targetName);
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (targetName === 'search' && searchInput) {
    // Deferred so the view's enter animation has settled. Guarded because the
    // user can navigate away inside that window, and focusing an input in a
    // hidden view scrolls the page back to it.
    setTimeout(() => {
      if (currentView === 'search') searchInput.focus();
    }, 400);
    renderSearchHistory();
  }

  if (targetName === 'library') {
    renderLibrary();
  }
}

// Nav link buttons
document.querySelectorAll('[data-nav]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    switchView(btn.dataset.nav);
  });
});

document.getElementById('nav-logo-btn')?.addEventListener('click', (e) => {
  e.preventDefault();
  switchView('landing');
});

// Back buttons
document.getElementById('search-back-btn')?.addEventListener('click', () => switchView(previousView));
document.getElementById('discover-back-btn')?.addEventListener('click', () => switchView(previousView));
document.getElementById('library-back-btn')?.addEventListener('click', () => switchView(previousView));
document.getElementById('back-btn')?.addEventListener('click', () => switchView(previousView === 'results' ? 'landing' : previousView));

// Hero Action buttons
document.getElementById('btn-hero-discover')?.addEventListener('click', () => switchView('discover'));
document.getElementById('btn-hero-search')?.addEventListener('click', () => switchView('search'));
document.getElementById('btn-hero-random')?.addEventListener('click', () => triggerRandomDiscover());

// ── Build Discover Matrix (Genres, Tags, Formats) ──────────────────────────
// The tag list currently rendered. Presets and "Randomize" rebuild the grid from
// the full list, which silently discarded whatever the user had typed into the
// filter box (the box kept its text, the grid stopped matching it).
let visibleTags = TAGS.slice();

function initDiscoverMatrix() {
  // Build Genre Grid
  if (genreGrid) {
    genreGrid.innerHTML = '';
    GENRES.forEach(g => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'genre-btn';
      btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML = `<span class="genre-icon" aria-hidden="true">${escapeHtml(g.icon)}</span><span class="genre-label">${escapeHtml(g.label)}</span>`;
      btn.addEventListener('click', () => {
        const nowSelected = !selectedGenres.has(g.label);
        selectedGenres[nowSelected ? 'add' : 'delete'](g.label);
        btn.classList.toggle('active', nowSelected);
        btn.setAttribute('aria-pressed', nowSelected ? 'true' : 'false');
        updateMatrixCounters();
      });
      genreGrid.appendChild(btn);
    });
  }

  // Build Tags Grid
  renderTagsGrid();

  // Tag filter search
  if (tagFilterInput) {
    tagFilterInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      visibleTags = TAGS.filter(t => t.toLowerCase().includes(query));
      renderTagsGrid();
    });
  }

  // Format Cards
  formatCards.forEach(card => {
    card.addEventListener('click', () => {
      const fmt = card.dataset.format;
      const nowSelected = !selectedFormats.has(fmt);
      selectedFormats[nowSelected ? 'add' : 'delete'](fmt);
      card.classList.toggle('active', nowSelected);
      card.setAttribute('aria-pressed', nowSelected ? 'true' : 'false');
      updateMatrixCounters();
    });
  });

  // Presets
  document.querySelectorAll('.preset-card').forEach(card => {
    card.addEventListener('click', () => applyPreset(card.dataset.preset));
  });

  // Reset & Randomize Discover Matrix
  document.getElementById('discover-reset-all-btn')?.addEventListener('click', resetDiscoverMatrix);
  document.getElementById('discover-preset-random-btn')?.addEventListener('click', randomizeDiscoverMatrix);
}

// Re-renders `visibleTags`, preserving selection state.
function renderTagsGrid() {
  if (!tagsGrid) return;
  tagsGrid.innerHTML = '';
  visibleTags.forEach(tag => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag-btn';
    btn.textContent = tag;
    const selected = selectedTags.has(tag);
    btn.classList.toggle('active', selected);
    btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
    btn.addEventListener('click', () => {
      const nowSelected = !selectedTags.has(tag);
      selectedTags[nowSelected ? 'add' : 'delete'](tag);
      btn.classList.toggle('active', nowSelected);
      btn.setAttribute('aria-pressed', nowSelected ? 'true' : 'false');
    });
    tagsGrid.appendChild(btn);
  });
}

// `Array#sort(() => 0.5 - Math.random())` is not a shuffle — it is biased and
// can leave adjacent items in place. Fisher–Yates actually randomises.
function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function syncDiscoverUiFromState() {
  document.querySelectorAll('.genre-btn').forEach(btn => {
    const label = btn.querySelector('.genre-label')?.textContent;
    const selected = selectedGenres.has(label);
    btn.classList.toggle('active', selected);
    btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  document.querySelectorAll('.format-card').forEach(card => {
    const selected = selectedFormats.has(card.dataset.format);
    card.classList.toggle('active', selected);
    card.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  updateMatrixCounters();
}

function updateMatrixCounters() {
  if (genreSelectedCount) {
    genreSelectedCount.textContent = `${selectedGenres.size} selected`;
  }
  if (formatSelectedCount) {
    formatSelectedCount.textContent = selectedFormats.size === 0
      ? 'All formats included'
      : `${[...selectedFormats].join(', ')}`;
  }
}

function resetDiscoverMatrix({ silent = false } = {}) {
  selectedGenres.clear();
  selectedTags.clear();
  selectedFormats.clear();
  if (customInput) customInput.value = '';
  if (tagFilterInput) tagFilterInput.value = '';
  visibleTags = TAGS.slice();
  document.querySelectorAll('.preset-card.active').forEach(el => el.classList.remove('active'));
  renderTagsGrid();
  syncDiscoverUiFromState();
  if (!silent) showToast('Discovery matrix reset', '🔄');
}

function applyPreset(presetKey) {
  const p = PRESETS[presetKey];
  if (!p) return;

  // Silent: the preset's own toast is the only one the user should see.
  resetDiscoverMatrix({ silent: true });

  // Highlight active preset card
  document.querySelectorAll('.preset-card').forEach(c => {
    c.classList.toggle('active', c.dataset.preset === presetKey);
  });

  p.formats.forEach(fmt => selectedFormats.add(fmt));
  p.genres.forEach(g => selectedGenres.add(g));
  p.tags.forEach(t => selectedTags.add(t));

  // Prompt
  if (customInput) customInput.value = p.prompt;

  renderTagsGrid();
  syncDiscoverUiFromState();

  const label = p.prompt.length > 30 ? `${p.prompt.slice(0, 30)}…` : p.prompt;
  showToast(`Loaded "${label}" preset`, '⚡');
}

function randomizeDiscoverMatrix() {
  resetDiscoverMatrix({ silent: true });

  // Pick 1-2 random formats
  const allFormats = ['Manga', 'Manhwa', 'Manhua', 'Light Novel'];
  shuffled(allFormats).slice(0, Math.floor(Math.random() * 2) + 1)
    .forEach(fmt => selectedFormats.add(fmt));

  // Pick 2 random genres
  shuffled(GENRES).slice(0, 2).forEach(g => selectedGenres.add(g.label));

  // Pick 3 random tags
  shuffled(TAGS).slice(0, 3).forEach(t => selectedTags.add(t));

  renderTagsGrid();
  syncDiscoverUiFromState();

  showToast('Randomized taste matrix! Roll again or unleash recommendations.', '🎲');
}

function triggerRandomDiscover() {
  randomizeDiscoverMatrix();
  submitDiscover();
}

// Prompt suggestions click
document.querySelectorAll('.prompt-sugg-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    if (customInput) {
      customInput.value = chip.textContent.replace(/^"|"$/g, '');
      customInput.focus();
    }
  });
});

// Quick Vibe Chips on Hero
document.querySelectorAll('.vibe-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const vibe = chip.dataset.vibe;
    if (searchInput) searchInput.value = vibe;
    submitSearch(vibe);
  });
});

// Showcase cards click
document.querySelectorAll('.showcase-card').forEach(card => {
  card.addEventListener('click', () => {
    const search = card.dataset.search;
    if (searchInput) searchInput.value = search;
    submitSearch(search);
  });
});

// ── Search Mode Switcher ───────────────────────────────────────────────────
function selectSearchMode(mode) {
  if (!['all', 'exact', 'similar'].includes(mode)) return;
  searchMode = mode;
  searchModeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
}

searchModeTabs.forEach(tab => {
  tab.addEventListener('click', () => selectSearchMode(tab.dataset.mode));
});

// Search input clears & triggers
if (searchInput) {
  searchInput.addEventListener('input', () => {
    if (searchClearBtn) searchClearBtn.style.display = searchInput.value ? 'flex' : 'none';
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitSearch();
  });
}
if (searchClearBtn) {
  searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchClearBtn.style.display = 'none';
    searchInput.focus();
  });
}
if (searchSubmitBtn) searchSubmitBtn.addEventListener('click', () => submitSearch());

// Suggestion chips click
document.querySelectorAll('.suggestion-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    if (searchInput) searchInput.value = chip.textContent;
    submitSearch();
  });
});

// ── Search & Discover Submission ───────────────────────────────────────────
// Two requests could be in flight at once (fast double-tap, a search started
// right after a discover). Whichever response landed *last* won, so a slow
// first query could overwrite the results of the newer one. Every submission
// now aborts the previous request and carries a sequence number that
// `isCurrentRequest` checks before touching the DOM.
let requestSequence = 0;
let activeController = null;

function beginRequest() {
  if (activeController) activeController.abort();
  activeController = new AbortController();
  const sequence = ++requestSequence;
  return {
    sequence,
    signal: activeController.signal,
    isCurrent: () => sequence === requestSequence,
  };
}

function isAbortError(err) {
  return Boolean(err) && (err.name === 'AbortError' || err.code === 20);
}

// POSTs to the recommendation endpoint and normalises transport, HTTP and
// payload errors into a single thrown Error.
async function requestRecommendations(payload, request) {
  const res = await fetch('./api/recommend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: request.signal,
  });

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(
      res.ok
        ? 'The server sent a malformed response.'
        : `Request failed (HTTP ${res.status}).`
    );
  }

  if (!res.ok || !Array.isArray(data?.recommendations)) {
    throw new Error(data?.error || `Request failed (HTTP ${res.status}).`);
  }
  return data;
}

async function submitSearch(overrideQuery = null) {
  const query = overrideQuery || (searchInput ? searchInput.value.trim() : '');
  if (!query) {
    if (searchInput) searchInput.focus();
    setInlineMessage(searchInlineMsg, 'Please enter a title or describe a vibe first.');
    return;
  }

  setInlineMessage(searchInlineMsg, '');
  addSearchHistory(query);

  const request = beginRequest();
  currentQuery = { mode: 'search', searchInput: query, searchMode, genres: [], tags: [], formats: [], customInput: '' };
  allRecommendations = [];
  filteredRecommendations = [];
  currentPage = 1;

  prepResultsView([query]);

  try {
    // The mode tabs were purely cosmetic: `searchMode` was captured into
    // `currentQuery` and never sent, so "Exact Title" and "Similar To..." both
    // behaved identically. The server now honours the explicit choice.
    const data = await requestRecommendations(
      { mode: 'search', searchInput: query, searchMode },
      request
    );
    if (!request.isCurrent()) return;

    if (!data.recommendations.length) {
      showEmptyResults(data.degraded
        ? 'Could not reach the manga catalogue. Please try again in a moment.'
        : `No titles matched "${query}". Try searching for another keyword.`);
      return;
    }

    allRecommendations = data.recommendations;
    applyResultsFilterAndSort();
  } catch (err) {
    if (isAbortError(err) || !request.isCurrent()) return;
    showErrorResults(err.message || 'Network error occurred while contacting recommendation server.');
  } finally {
    if (request.isCurrent() && loadingEl) loadingEl.style.display = 'none';
  }
}

if (discoverBtn) discoverBtn.addEventListener('click', submitDiscover);
if (customInput) {
  customInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitDiscover();
  });
}

async function submitDiscover() {
  const genres = [...selectedGenres];
  const tags = [...selectedTags];
  const formats = [...selectedFormats];
  const custom = customInput ? customInput.value.trim() : '';

  if (!genres.length && !tags.length && !custom && !formats.length) {
    setInlineMessage(discoverInlineMsg, 'Select at least one genre, trope, format, or describe your mood.');
    return;
  }

  setInlineMessage(discoverInlineMsg, '');
  const request = beginRequest();
  currentQuery = { mode: 'discover', genres, tags, formats, customInput: custom, searchInput: '' };
  allRecommendations = [];
  filteredRecommendations = [];
  currentPage = 1;
  loadMoreExhausted = false;

  const queryParts = [...formats, ...genres, ...tags, custom].filter(Boolean);
  prepResultsView(queryParts);

  try {
    const data = await requestRecommendations(
      { mode: 'discover', genres, tags, formats, customInput: custom, exclude: [], page: 1 },
      request
    );
    if (!request.isCurrent()) return;

    if (!data.recommendations.length) {
      // "Nothing matched" and "the catalogue was unreachable" are different
      // answers and need different advice. Telling someone their criteria are
      // wrong when the upstream simply never answered sends them off loosening
      // filters that were fine.
      showEmptyResults(data.degraded
        ? 'Could not reach the manga catalogue. Please try again in a moment.'
        : 'No titles matched this specific criteria mix. Try adjusting or expanding tags.');
      return;
    }

    allRecommendations = data.recommendations;
    applyResultsFilterAndSort();
  } catch (err) {
    if (isAbortError(err) || !request.isCurrent()) return;
    showErrorResults(err.message || 'Network error occurred while contacting recommendation server.');
  } finally {
    if (request.isCurrent() && loadingEl) loadingEl.style.display = 'none';
  }
}

function prepResultsView(queryParts) {
  if (resultsContent) resultsContent.style.display = 'none';
  if (resultsEmpty) resultsEmpty.hidden = true;
  if (errorMsg) {
    errorMsg.style.display = 'none';
    errorMsg.innerHTML = '';
  }
  if (loadingEl) loadingEl.style.display = 'block';

  // A stale in-results filter from the previous query would hide the whole
  // new result set behind an empty state.
  if (resultsFilterInput) resultsFilterInput.value = '';
  if (loadMoreBtn) loadMoreBtn.disabled = false;
  if (loadMoreText) loadMoreText.textContent = 'Discover 10 More';
  loadMoreExhausted = false;

  if (resultsQueryTags) {
    resultsQueryTags.innerHTML = queryParts.map(q => `<span class="query-tag">${escapeHtml(q)}</span>`).join('');
  }

  switchView('results');
}

function setInlineMessage(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

function showEmptyResults(msg) {
  if (loadingEl) loadingEl.style.display = 'none';
  if (resultsContent) resultsContent.style.display = 'none';
  if (resultsEmpty) {
    resultsEmpty.hidden = false;
    const textEl = resultsEmpty.querySelector('.results-empty-text');
    if (textEl) textEl.textContent = msg;
  }
}

function showErrorResults(msg) {
  if (loadingEl) loadingEl.style.display = 'none';
  if (resultsContent) resultsContent.style.display = 'none';
  if (errorMsg) {
    errorMsg.innerHTML = `<div class="empty-icon">⚠</div><h3>Archive Query Interrupted</h3><p>${escapeHtml(msg)}</p>`;
    errorMsg.style.display = 'block';
  }
}

// ── Results Filtering, Sorting & Rendering ─────────────────────────────────
// Ratings arrive as strings ("8.4") from AniList and as numbers from the model,
// so the sort has to coerce rather than subtract directly.
function ratingValue(rec) {
  const value = parseFloat(rec?.rating);
  return Number.isFinite(value) ? value : 0;
}

function compareRecommendations(a, b, sort) {
  if (sort === 'rating') {
    const delta = ratingValue(b) - ratingValue(a);
    // Stable tiebreak so equal ratings don't reshuffle on every re-render.
    return delta !== 0 ? delta : String(a.title || '').localeCompare(b.title || '');
  }
  if (sort === 'title') {
    return String(a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
  }
  if (sort === 'type') {
    const delta = String(a.type || '').localeCompare(b.type || '');
    return delta !== 0 ? delta : String(a.title || '').localeCompare(b.title || '');
  }
  return 0;
}

function matchesResultsFilter(rec, filterText) {
  if (!rec) return false;
  if (!filterText) return true;
  const needle = String(filterText).toLowerCase();
  return (
    String(rec.title || '').toLowerCase().includes(needle) ||
    toArray(rec.genre).some(g => String(g).toLowerCase().includes(needle)) ||
    String(rec.synopsis || '').toLowerCase().includes(needle) ||
    String(rec.type || '').toLowerCase().includes(needle)
  );
}

function applyResultsFilterAndSort() {
  const filterText = resultsFilterInput ? resultsFilterInput.value.toLowerCase().trim() : '';

  // Filter in-memory results
  filteredRecommendations = allRecommendations.filter(rec =>
    matchesResultsFilter(rec, filterText)
  );

  if (currentSort !== 'default') {
    // `toSorted`/spread-then-sort keeps `allRecommendations` in server order.
    filteredRecommendations = filteredRecommendations
      .slice()
      .sort((a, b) => compareRecommendations(a, b, currentSort));
  }

  renderResultsCards();
}

if (resultsFilterInput) {
  resultsFilterInput.addEventListener('input', applyResultsFilterAndSort);
}

if (resultsSortSelect) {
  resultsSortSelect.addEventListener('change', (e) => {
    currentSort = e.target.value;
    applyResultsFilterAndSort();
  });
}

// View Layout Switcher (Grid vs List)
viewModeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    viewModeBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    viewLayout = btn.dataset.view;
    if (cardsGrid) {
      cardsGrid.classList.toggle('list-view', viewLayout === 'list');
    }
  });
});

// Creates and appends a card, skipping records that cannot be rendered.
function appendCard(grid, rec) {
  if (!grid) return;
  const card = createCardElement(rec);
  if (card) grid.appendChild(card);
}

function renderResultsCards() {
  if (!cardsGrid) return;
  cardsGrid.innerHTML = '';
  if (resultsEmpty) resultsEmpty.hidden = true;

  if (resultsTitle) {
    resultsTitle.textContent = currentQuery.mode === 'search'
      ? `Results for "${currentQuery.searchInput}"`
      : 'Curated Recommendations';
  }
  if (resultsMeta) {
    resultsMeta.textContent = `${filteredRecommendations.length} title${filteredRecommendations.length !== 1 ? 's' : ''} found`;
  }

  if (filteredRecommendations.length === 0) {
    showEmptyResults('No titles matched your in-results filter.');
    return;
  }

  filteredRecommendations.forEach(r => appendCard(cardsGrid, r));

  if (resultsContent) resultsContent.style.display = 'block';
  if (loadMoreWrapper) {
    const canLoadMore = currentQuery.mode === 'discover' && !loadMoreExhausted;
    loadMoreWrapper.style.display = canLoadMore ? 'block' : 'none';
    // The in-results filter can hide everything the user has; offering
    // "load more" on top of an empty grid is just noise.
    if (canLoadMore && resultsFilterInput?.value.trim()) {
      loadMoreWrapper.style.display = 'none';
    }
  }
}

// ── Card Builder Component ─────────────────────────────────────────────────
function createCardElement(r) {
  if (!r || typeof r.title !== 'string' || !r.title.trim()) return null;
  const rec = normalizeBookmark(r);
  const typeLower = (rec.type || 'Manga').toLowerCase();
  let badgeClass = 'badge-manga';
  if (typeLower === 'manhwa') badgeClass = 'badge-manhwa';
  else if (typeLower === 'manhua') badgeClass = 'badge-manhua';
  else if (typeLower.includes('novel')) badgeClass = 'badge-ln';

  const isCompleted = String(rec.status || '').toLowerCase() === 'completed';
  const saved = isBookmarked(rec.title);

  const card = document.createElement('article');
  card.className = 'card';

  // Cover markup
  const coverMarkup = rec.coverImage
    ? `<img src="${escapeHtml(rec.coverImage)}" alt="${escapeHtml(rec.title)}" class="card-cover-img" loading="lazy" decoding="async" />`
    : `<div class="card-cover-placeholder"><span class="placeholder-symbol">読</span></div>`;

  // The API returns AniList's full canonical genre list; the card only has room
  // for three, but the detail modal shows all of them.
  const genresMarkup = toArray(rec.genre).slice(0, 3)
    .map(g => `<span class="genre-tag-sm">${escapeHtml(g)}</span>`)
    .join('');

  card.innerHTML = `
    <div class="card-cover-wrap" data-action="detail">
      ${coverMarkup}
      <div class="card-cover-overlay"></div>
      <div class="card-cover-top-actions">
        <div class="card-badges-row">
          <span class="card-badge ${badgeClass}">${escapeHtml(rec.type || 'Manga')}</span>
          <span class="card-badge badge-status ${isCompleted ? 'completed' : ''}">${escapeHtml(rec.status || 'Ongoing')}</span>
        </div>
        <button type="button" class="card-bookmark-btn ${saved ? 'saved' : ''}" data-title="${encodeURIComponent(rec.title)}" title="${saved ? 'Remove from Library' : 'Save to Library'}" aria-label="${saved ? 'Remove from Library' : 'Save to Library'}" aria-pressed="${saved}">
          ${saved ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>' : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>'}
        </button>
      </div>
    </div>

    <div class="card-body">
      <div class="card-title-row">
        <h3 class="card-title" data-action="detail">${escapeHtml(rec.title)}</h3>
        ${rec.rating ? `<span class="card-rating-chip">★ ${escapeHtml(rec.rating)}</span>` : ''}
      </div>

      <div class="card-genres">${genresMarkup}</div>
      <p class="card-synopsis">${escapeHtml(rec.synopsis || 'No synopsis provided.')}</p>
    </div>

    <div class="card-footer">
      <button type="button" class="card-read-btn" data-action="read">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        <span>Read Now</span>
      </button>
      <button type="button" class="card-similar-btn" data-action="similar" title="Find titles similar to this" aria-label="Find titles similar to ${escapeHtml(rec.title)}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      </button>
    </div>
  `;

  // Attach Event Listeners
  card.querySelector('.card-bookmark-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleBookmark(rec);
  });

  card.querySelectorAll('[data-action="detail"]').forEach(el => {
    el.addEventListener('click', () => openDetailModal(rec));
  });

  card.querySelector('[data-action="read"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    handleReadAction(rec);
  });

  card.querySelector('[data-action="similar"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const similarQuery = `something like ${rec.title}`;
    if (searchInput) searchInput.value = similarQuery;
    // Switching the tab too, so the UI agrees with what is actually requested.
    selectSearchMode('similar');
    submitSearch(similarQuery);
  });

  return card;
}

// ── Read Action & In-App Reader Controller ──────────────────────────────────

// Chrome's built-in "Translate this page" prompt only fires for top-level
// navigations — it never appears for content loaded inside our reader
// iframe, and installed-PWA link opens can also skip it. Wrapping the URL
// in Google's translate proxy gets a translated version regardless.
function toTranslatedUrl(url) {
  return `https://translate.google.com/translate?sl=auto&tl=en&u=${encodeURIComponent(url)}`;
}

function handleReadAction(rec) {
  if (!rec) return;
  const title = String(rec.title || '').trim();
  // `readUrl` is always populated by the API — when AniList has no direct
  // reading link it is a Google `site:` search. `isDirectLink` is the only
  // reliable signal that the URL is an actual reader page, and it is what
  // decides between the in-app iframe and a normal tab.
  if (rec.isDirectLink && rec.readUrl) {
    openReader(rec.readUrl, title, rec.type);
    return;
  }
  const target = rec.readUrl || `https://www.google.com/search?q=read+${encodeURIComponent(title)}`;
  window.open(target, '_blank', 'noopener,noreferrer');
  if (!rec.readUrl) {
    showToast(`No direct reader found for "${title}" — opened a web search.`, '🔍');
  } else {
    showToast('Tip: use the Translate to English button if the page loads in another language', '🌐');
  }
}

const READER_BLOCKED_THRESHOLD_MS = 380;
const READER_MAX_WAIT_MS = 5500;
let readerResolved = false;
let readerWaitTimer = null;
let readerLoadStart = 0;
let currentReaderUrl = '';

// Keeps the iframe in the layout and merely hides it. `display: none` iframes
// are not guaranteed to run their load event in every engine, and that event is
// exactly what the blocked-vs-loaded heuristic below depends on.
function setReaderIframeVisible(visible) {
  if (!readerIframe) return;
  readerIframe.style.display = 'block';
  readerIframe.style.visibility = visible ? 'visible' : 'hidden';
}

// `navigator.clipboard` is undefined outside a secure context (plain http://
// LAN testing, some in-app webviews). Fall back to a hidden textarea.
async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path.
    }
  }
  try {
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', '');
    scratch.style.position = 'fixed';
    scratch.style.opacity = '0';
    document.body.appendChild(scratch);
    scratch.select();
    const ok = document.execCommand('copy');
    scratch.remove();
    return ok;
  } catch {
    return false;
  }
}

function openReader(url, title, type = 'Manga') {
  if (!readerOverlay || !url) return;
  currentReaderUrl = url;
  if (readerTitle) readerTitle.textContent = `${title} (${type})`;
  if (readerExternalBtn) readerExternalBtn.href = url;
  if (readerBlockedExternalBtn) readerBlockedExternalBtn.href = url;

  // Translate to English — create the buttons once, next to their
  // corresponding "open externally" buttons, then just update the href
  // on every subsequent openReader() call.
  const translatedUrl = toTranslatedUrl(url);

  if (!readerTranslateBtn && readerExternalBtn) {
    readerTranslateBtn = document.createElement('a');
    readerTranslateBtn.id = 'reader-translate-btn';
    readerTranslateBtn.target = '_blank';
    readerTranslateBtn.rel = 'noopener noreferrer';
    readerTranslateBtn.className = readerExternalBtn.className;
    readerTranslateBtn.textContent = 'Translate to English';
    readerExternalBtn.insertAdjacentElement('afterend', readerTranslateBtn);
  }
  if (readerTranslateBtn) readerTranslateBtn.href = translatedUrl;

  if (!readerBlockedTranslateBtn && readerBlockedExternalBtn) {
    readerBlockedTranslateBtn = document.createElement('a');
    readerBlockedTranslateBtn.id = 'reader-blocked-translate-btn';
    readerBlockedTranslateBtn.target = '_blank';
    readerBlockedTranslateBtn.rel = 'noopener noreferrer';
    readerBlockedTranslateBtn.className = readerBlockedExternalBtn.className;
    readerBlockedTranslateBtn.textContent = 'Translate to English';
    readerBlockedExternalBtn.insertAdjacentElement('afterend', readerBlockedTranslateBtn);
  }
  if (readerBlockedTranslateBtn) readerBlockedTranslateBtn.href = translatedUrl;

  if (readerCopyLinkBtn) {
    readerCopyLinkBtn.onclick = () => {
      navigator.clipboard.writeText(url);
      showToast('Reader link copied to clipboard', '📋');
    };
  }

  // Populate alternative search chips. `q` is percent-encoded, which is safe to
  // place inside a double-quoted attribute; `escapeHtml` is applied on top so
  // the value is correct under any quoting.
  if (readerAltChips) {
    const q = escapeHtml(encodeURIComponent(title));
    readerAltChips.innerHTML = `
      <a class="alt-source-btn" href="https://www.google.com/search?q=site:mangabuddy.com+${q}" target="_blank" rel="noopener noreferrer">MangaBuddy</a>
      <a class="alt-source-btn" href="https://mangadex.org/search?keyword=${q}" target="_blank" rel="noopener noreferrer">MangaDex</a>
      <a class="alt-source-btn" href="https://www.webtoons.com/en/search?keyword=${q}" target="_blank" rel="noopener noreferrer">Webtoon</a>
      <a class="alt-source-btn" href="https://freewebnovel.com/search?searchkey=${q}" target="_blank" rel="noopener noreferrer">FreeWebNovel</a>
      <a class="alt-source-btn" href="https://www.google.com/search?q=read+${q}" target="_blank" rel="noopener noreferrer">Google</a>
    `;
  }

  if (readerLoading) readerLoading.style.display = 'flex';
  if (readerBlocked) readerBlocked.classList.remove('visible');
  setReaderIframeVisible(false);

  readerOverlay.classList.add('open');
  readerOverlay.setAttribute('aria-hidden', 'false');
  pushOverlay('reader');

  readerResolved = false;
  readerLoadStart = Date.now();
  clearTimeout(readerWaitTimer);
  readerWaitTimer = setTimeout(() => {
    if (readerResolved) return;
    readerResolved = true;
    showReaderBlocked();
  }, READER_MAX_WAIT_MS);

  if (readerIframe) {
    readerIframe.onload = handleReaderLoad;
    readerIframe.src = url;
  }
}

function handleReaderLoad() {
  if (readerResolved) return;
  readerResolved = true;
  clearTimeout(readerWaitTimer);
  const elapsed = Date.now() - readerLoadStart;
  if (elapsed < READER_BLOCKED_THRESHOLD_MS) {
    showReaderBlocked();
  } else {
    showReaderLoaded();
  }
}

function showReaderBlocked() {
  if (readerLoading) readerLoading.style.display = 'none';
  setReaderIframeVisible(false);
  if (readerBlocked) readerBlocked.classList.add('visible');
}

function showReaderLoaded() {
  if (readerLoading) readerLoading.style.display = 'none';
  if (readerBlocked) readerBlocked.classList.remove('visible');
  setReaderIframeVisible(true);
}

function closeReader() {
  if (!readerOverlay) return;
  readerOverlay.classList.remove('open');
  readerOverlay.setAttribute('aria-hidden', 'true');
  popOverlay('reader');
  clearTimeout(readerWaitTimer);
  readerWaitTimer = null;
  if (readerIframe) {
    readerIframe.onload = null;
    setReaderIframeVisible(false);
    // about:blank tears down the framed document; without it the embedded
    // reader keeps running (and playing audio) in the background.
    readerIframe.src = 'about:blank';
  }
}

if (readerCloseBtn) readerCloseBtn.addEventListener('click', closeReader);

if (readerCopyLinkBtn) {
  readerCopyLinkBtn.addEventListener('click', async () => {
    const ok = await copyText(currentReaderUrl);
    showToast(
      ok ? 'Reader link copied to clipboard' : 'Could not copy — long-press the address bar instead.',
      ok ? '📋' : '⚠'
    );
  });
}

// ── Detail Modal Controller ────────────────────────────────────────────────
function closeDetailModal() {
  if (!detailModal) return;
  detailModal.classList.remove('open');
  detailModal.setAttribute('aria-hidden', 'true');
  popOverlay('detail');
}

function openDetailModal(rec) {
  if (!detailModal || !detailModalContent || !rec) return;
  const saved = isBookmarked(rec.title);

  const coverMarkup = rec.coverImage
    ? `<img src="${escapeHtml(rec.coverImage)}" alt="${escapeHtml(rec.title)}" class="detail-cover-img" loading="lazy" />`
    : `<div class="card-cover-placeholder card-cover-placeholder-tall"><span class="placeholder-symbol">読</span></div>`;

  const genresMarkup = toArray(rec.genre)
    .map(g => `<span class="genre-tag-sm">${escapeHtml(g)}</span>`).join('');

  detailModalContent.innerHTML = `
    <div class="detail-grid">
      <div class="detail-cover-box">
        ${coverMarkup}
      </div>

      <div class="detail-info-box">
        <h2 class="detail-title">${escapeHtml(rec.title)}</h2>

        <div class="detail-meta-row">
          <span class="card-badge badge-manga">${escapeHtml(rec.type || 'Manga')}</span>
          <span class="card-badge badge-status">${escapeHtml(rec.status || 'Ongoing')}</span>
          ${rec.rating ? `<span class="card-rating-chip">★ ${escapeHtml(rec.rating)} Score</span>` : ''}
        </div>

        <div class="card-genres card-genres-spaced">${genresMarkup}</div>

        <div class="detail-synopsis">
          ${escapeHtml(rec.synopsis || 'No detailed synopsis available.')}
        </div>

        <div class="detail-actions-row">
          <button class="btn btn-primary" id="detail-read-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
            <span>Read Title</span>
          </button>

          <button class="btn btn-secondary" id="detail-bookmark-btn">
            ${saved ? '<span>Saved in Library ✓</span>' : '<span>Save to Library</span>'}
          </button>

          <button class="btn btn-ghost" id="detail-similar-btn" title="Find titles similar to this">
            <span>Find Similar 🔮</span>
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('detail-read-btn')?.addEventListener('click', () => {
    closeDetailModal();
    handleReadAction(rec);
  });

  document.getElementById('detail-bookmark-btn')?.addEventListener('click', (e) => {
    toggleBookmark(rec);
    const nowSaved = isBookmarked(rec.title);
    e.currentTarget.innerHTML = nowSaved ? '<span>Saved in Library ✓</span>' : '<span>Save to Library</span>';
    e.currentTarget.setAttribute('aria-pressed', nowSaved ? 'true' : 'false');
  });

  document.getElementById('detail-similar-btn')?.addEventListener('click', () => {
    closeDetailModal();
    const similarQuery = `something like ${rec.title}`;
    if (searchInput) searchInput.value = similarQuery;
    submitSearch(similarQuery);
  });

  detailModal.classList.add('open');
  detailModal.setAttribute('aria-hidden', 'false');
  pushOverlay('detail');
}

// Clicking the dimmed backdrop closes the modal. Without this the only exits
// were the ✕ button and Escape.
if (detailModal) {
  detailModal.addEventListener('click', (e) => {
    if (e.target === detailModal) closeDetailModal();
  });
}

if (detailModalClose) {
  detailModalClose.addEventListener('click', closeDetailModal);
}

// ── Command Palette (Cmd + K) ──────────────────────────────────────────────
function openCmdPalette() {
  if (!cmdModal) return;
  cmdModal.classList.add('open');
  cmdModal.setAttribute('aria-hidden', 'false');
  pushOverlay('cmd');
  if (cmdInput) {
    cmdInput.value = '';
    setTimeout(() => cmdInput.focus(), 100);
  }
  // Reopening must show the full list, not last query's filtered subset.
  filterCmdItems('');
}

function closeCmdPalette() {
  if (!cmdModal) return;
  cmdModal.classList.remove('open');
  cmdModal.setAttribute('aria-hidden', 'true');
  popOverlay('cmd');
}

if (cmdTriggerBtn) cmdTriggerBtn.addEventListener('click', openCmdPalette);

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (cmdModal && cmdModal.classList.contains('open')) closeCmdPalette();
    else openCmdPalette();
  } else if (e.key === 'Escape') {
    // Close everything, innermost last. Each close releases only its own scroll
    // lock, so a still-open overlay keeps the page frozen.
    closeCmdPalette();
    if (detailModal && detailModal.classList.contains('open')) closeDetailModal();
    if (readerOverlay && readerOverlay.classList.contains('open')) closeReader();
  }
});

if (cmdModal) {
  cmdModal.addEventListener('click', (e) => {
    if (e.target === cmdModal) closeCmdPalette();
  });
}

if (cmdInput) {
  cmdInput.addEventListener('input', () => filterCmdItems(cmdInput.value));

  cmdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = cmdInput.value.trim();
      if (!q) {
        // No typed query: Enter runs whichever item is highlighted.
        const highlighted = cmdResultsList?.querySelector('.cmd-item:not([hidden])');
        highlighted?.click();
        return;
      }
      closeCmdPalette();
      if (searchInput) searchInput.value = q;
      submitSearch(q);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveCmdHighlight(e.key === 'ArrowDown' ? 1 : -1);
    }
  });
}

// The palette listed every command and suggestion regardless of what had been
// typed, and `cmdResultsList` was fetched but never used. Typing now narrows the
// list, and the first surviving item is highlighted so Enter has something to run.
function filterCmdItems(query) {
  if (!cmdResultsList) return;
  const needle = String(query || '').toLowerCase().trim();
  const items = [...cmdResultsList.querySelectorAll('.cmd-item')];

  let firstVisible = null;
  for (const item of items) {
    const label = item.dataset.search || item.textContent || '';
    const visible = !needle || label.toLowerCase().includes(needle);
    item.hidden = !visible;
    item.classList.toggle('highlighted', visible && !firstVisible);
    if (visible && !firstVisible) firstVisible = item;
  }

  if (cmdEmptyState) cmdEmptyState.hidden = items.length > 0 && Boolean(firstVisible);
}

function moveCmdHighlight(direction) {
  if (!cmdResultsList) return;
  const visible = [...cmdResultsList.querySelectorAll('.cmd-item')].filter(
    item => !item.hidden
  );
  if (!visible.length) return;

  const current = visible.findIndex(item => item.classList.contains('highlighted'));
  const next = visible[(current + direction + visible.length) % visible.length];
  for (const item of visible) item.classList.remove('highlighted');
  next.classList.add('highlighted');
  next.scrollIntoView({ block: 'nearest' });
}

document.querySelectorAll('.cmd-item').forEach(item => {
  item.addEventListener('click', () => {
    closeCmdPalette();
    if (item.dataset.cmd === 'discover') switchView('discover');
    else if (item.dataset.cmd === 'random') triggerRandomDiscover();
    else if (item.dataset.cmd === 'library') switchView('library');
    else if (item.dataset.search) {
      if (searchInput) searchInput.value = item.dataset.search;
      submitSearch(item.dataset.search);
    }
  });
});

// ── Library / Bookmarks Rendering & I/O ────────────────────────────────────
let libraryFilter = 'all';

function renderLibrary() {
  if (!libraryCardsGrid) return;
  libraryCardsGrid.innerHTML = '';
  const bookmarks = getLibraryBookmarks();
  updateLibraryBadge();

  const searchQuery = librarySearchInput ? librarySearchInput.value.toLowerCase().trim() : '';

  const filtered = bookmarks.filter(item => {
    if (libraryFilter !== 'all') {
      const t = String(item.type || '').toLowerCase();
      if (libraryFilter === 'Light Novel' && !t.includes('novel')) return false;
      if (libraryFilter !== 'Light Novel' && t !== libraryFilter.toLowerCase()) return false;
    }
    if (searchQuery) {
      return String(item.title || '').toLowerCase().includes(searchQuery) ||
             String(item.synopsis || '').toLowerCase().includes(searchQuery);
    }
    return true;
  });

  filtered.forEach(rec => appendCard(libraryCardsGrid, rec));

  // Two distinct empty states: the library has nothing saved at all, versus the
  // current filter/search matching none of what is saved. They used to collapse
  // into one, so filtering down to zero titles showed "your library is empty".
  const hasAny = bookmarks.length > 0;
  if (libraryEmpty) libraryEmpty.style.display = hasAny ? 'none' : 'block';
  if (libraryNoMatches) libraryNoMatches.style.display = hasAny && !filtered.length ? 'block' : 'none';
  if (libraryNoMatchesText && hasAny && !filtered.length) {
    const scope = [];
    if (libraryFilter !== 'all') scope.push(`the "${libraryFilter}" tab`);
    if (searchQuery) scope.push(`"${searchQuery}"`);
    libraryNoMatchesText.textContent = scope.length
      ? `No saved title matches ${scope.join(' and ')}. Try another tab or clear the search box.`
      : 'Try another format tab or clear the search box.';
  }
}

if (librarySearchInput) librarySearchInput.addEventListener('input', renderLibrary);
if (libraryFormatFilters) {
  libraryFormatFilters.querySelectorAll('.lib-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      libraryFormatFilters.querySelectorAll('.lib-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      libraryFilter = tab.dataset.format;
      renderLibrary();
    });
  });
}

document.getElementById('library-explore-btn')?.addEventListener('click', () => switchView('discover'));
document.getElementById('empty-reset-btn')?.addEventListener('click', () => switchView('discover'));
document.getElementById('empty-random-btn')?.addEventListener('click', triggerRandomDiscover);

// Export / Import Bookmarks JSON
if (libraryExportBtn) {
  libraryExportBtn.addEventListener('click', () => {
    const list = getLibraryBookmarks();
    if (!list.length) {
      showToast('Your Library is empty — nothing to export.', '💾');
      return;
    }
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kindoku-library-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Library exported to JSON', '💾');
  });
}

if (libraryImportBtn && libraryFileInput) {
  libraryImportBtn.addEventListener('click', () => libraryFileInput.click());
  libraryFileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    // Clear the value first: without this, re-picking the *same* file fires no
    // `change` event and the import silently does nothing.
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      let imported;
      try {
        imported = JSON.parse(event.target.result);
      } catch {
        showToast('Invalid JSON backup file format.', '❌');
        return;
      }

      if (!Array.isArray(imported)) {
        showToast('Backup must be a JSON array of bookmarks.', '❌');
        return;
      }

      const validCount = imported.filter(record => normalizeBookmark(record)).length;
      const merged = mergeLibraryBookmarks(imported, getLibraryBookmarks());
      if (!merged.length) {
        showToast('No valid bookmarks found in that file.', '❌');
        return;
      }

      saveLibraryBookmarks(merged);
      renderLibrary();
      showToast(
        validCount === imported.length
          ? `Imported ${validCount} bookmarks successfully!`
          : `Imported ${validCount} of ${imported.length} entries (invalid rows skipped).`,
        '📥'
      );
    };
    reader.onerror = () => showToast('Could not read that file.', '❌');
    reader.readAsText(file);
  });
}

// ── Load More Discovery ────────────────────────────────────────────────────
// Appends only titles that aren't already on screen. The server used to treat
// `exclude` as a prompt hint only, so a second "Load More" re-served titles the
// user was already looking at as duplicate cards.
function mergeRecommendations(existing, incoming) {
  const seen = new Set(toArray(existing).map(rec => normalizeTitle(rec?.title)));
  const fresh = [];
  for (const rec of toArray(incoming)) {
    const title = typeof rec?.title === 'string' ? rec.title.trim() : '';
    if (!title) continue;
    const key = normalizeTitle(title);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(rec);
  }
  return fresh;
}

if (loadMoreBtn) {
  loadMoreBtn.addEventListener('click', async () => {
    if (currentQuery.mode !== 'discover' || loadMoreExhausted) return;
    loadMoreBtn.disabled = true;
    const originalLabel = loadMoreText ? loadMoreText.textContent : '';
    if (loadMoreText) loadMoreText.textContent = 'Consulting Archives...';

    const request = beginRequest();
    const nextPage = currentPage + 1;

    try {
      const data = await requestRecommendations(
        {
          mode: 'discover',
          genres: currentQuery.genres,
          tags: currentQuery.tags,
          formats: currentQuery.formats,
          customInput: currentQuery.customInput,
          exclude: allRecommendations.map(r => r.title),
          page: nextPage,
        },
        request
      );
      if (!request.isCurrent()) return;

      currentPage = nextPage;
      const fresh = mergeRecommendations(allRecommendations, data.recommendations);
      allRecommendations = allRecommendations.concat(fresh);

      if (!data.recommendations.length || !fresh.length) {
        // Nothing new left. `fresh.length === 0` while the server did return
        // rows means they were all duplicates — either way there is no point
        // offering the button again.
        loadMoreExhausted = true;
        if (loadMoreWrapper) loadMoreWrapper.style.display = 'none';
        showToast('You have reached the end of these archives.', '📚');
        return;
      }

      applyResultsFilterAndSort();
      showToast(`Loaded ${fresh.length} new recommendations!`, '✨');
    } catch (err) {
      if (!isAbortError(err) && request.isCurrent()) {
        showToast(err.message || 'Error loading more titles', '⚠');
      }
    } finally {
      if (request.isCurrent()) {
        loadMoreBtn.disabled = false;
        if (loadMoreText) loadMoreText.textContent = originalLabel;
      }
    }
  });
}

// ── PWA & Service Worker ───────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW registration:', err));
  });
}

let deferredInstallPrompt = null;
const installBtn = document.getElementById('install-btn');
const installTooltip = document.getElementById('install-tooltip');

const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
if (isStandalone && installBtn) {
  installBtn.style.display = 'none';
} else if (installBtn) {
  installBtn.style.display = 'flex';
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (installBtn) installBtn.style.display = 'flex';
});

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') installBtn.style.display = 'none';
      deferredInstallPrompt = null;
      return;
    }
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    const msg = isIOS
      ? 'Tap Share (⬆) → "Add to Home Screen"'
      : 'Click install in your browser address bar or menu.';
    if (installTooltip) {
      installTooltip.textContent = msg;
      installTooltip.classList.add('visible');
      setTimeout(() => installTooltip.classList.remove('visible'), 5000);
    }
  });
}

// ── App Initialization ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initDiscoverMatrix();
  updateLibraryBadge();
  switchView('landing');
});