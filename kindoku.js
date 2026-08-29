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
  toast.innerHTML = `<span style="color:var(--accent-primary);">${icon}</span><span>${escapeHtml(message)}</span>`;
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
    themeCurrentName.textContent = themeName.charAt(0).toUpperCase() + themeName.slice(1);
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
    if (dist < 120) {
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

function animateParticles(t = 0) {
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles.forEach(p => { p.update(); p.draw(t); });
  requestAnimationFrame(animateParticles);
}

if (canvas) {
  window.addEventListener('resize', () => { resizeCanvas(); initParticles(); });
  window.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });
  window.addEventListener('mouseleave', () => { mouseX = -1000; mouseY = -1000; });
  resizeCanvas();
  initParticles();
  animateParticles();
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

// Translate buttons aren't in the static HTML — they're created once on first
// use and reused after that (see openReader).
let readerTranslateBtn = document.getElementById('reader-translate-btn');
let readerBlockedTranslateBtn = document.getElementById('reader-blocked-translate-btn');

// ── Bookmarks / Library Manager ────────────────────────────────────────────
function getLibraryBookmarks() {
  try {
    return JSON.parse(localStorage.getItem('kindoku_library') || '[]');
  } catch {
    return [];
  }
}

function saveLibraryBookmarks(items) {
  localStorage.setItem('kindoku_library', JSON.stringify(items));
  updateLibraryBadge();
}

function isBookmarked(title) {
  const list = getLibraryBookmarks();
  return list.some(item => item.title.toLowerCase() === title.toLowerCase());
}

function toggleBookmark(rec) {
  let list = getLibraryBookmarks();
  const exists = list.some(item => item.title.toLowerCase() === rec.title.toLowerCase());
  if (exists) {
    list = list.filter(item => item.title.toLowerCase() !== rec.title.toLowerCase());
    saveLibraryBookmarks(list);
    showToast(`Removed "${rec.title}" from Library`, '🗑️');
  } else {
    list.unshift({ ...rec, savedAt: Date.now() });
    saveLibraryBookmarks(list);
    showToast(`Saved "${rec.title}" to Library!`, '🔖');
  }
  updateBookmarkButtons(rec.title);
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

  if (countAll) countAll.textContent = list.length;
  if (countManga) countManga.textContent = list.filter(i => (i.type || '').toLowerCase() === 'manga').length;
  if (countManhwa) countManhwa.textContent = list.filter(i => (i.type || '').toLowerCase() === 'manhwa').length;
  if (countManhua) countManhua.textContent = list.filter(i => (i.type || '').toLowerCase() === 'manhua').length;
  if (countLn) countLn.textContent = list.filter(i => (i.type || '').toLowerCase().includes('novel')).length;
}

function updateBookmarkButtons(title) {
  const saved = isBookmarked(title);
  document.querySelectorAll(`.card-bookmark-btn[data-title="${encodeURIComponent(title)}"]`).forEach(btn => {
    btn.classList.toggle('saved', saved);
    btn.innerHTML = saved
      ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>`
      : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>`;
  });
}

// ── Search History Manager ─────────────────────────────────────────────────
function getSearchHistory() {
  try {
    return JSON.parse(localStorage.getItem('kindoku_history') || '[]');
  } catch {
    return [];
  }
}

function addSearchHistory(query) {
  if (!query || query.length < 2) return;
  let history = getSearchHistory().filter(q => q.toLowerCase() !== query.toLowerCase());
  history.unshift(query);
  history = history.slice(0, 10);
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
    .map(q => `<button class="recent-chip" data-search="${escapeHtml(q)}">${escapeHtml(q)}</button>`)
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
    setTimeout(() => searchInput.focus(), 400);
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
function initDiscoverMatrix() {
  // Build Genre Grid
  if (genreGrid) {
    genreGrid.innerHTML = '';
    GENRES.forEach(g => {
      const btn = document.createElement('button');
      btn.className = 'genre-btn';
      btn.innerHTML = `<span class="genre-icon">${g.icon}</span><span class="genre-label">${g.label}</span>`;
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        selectedGenres.has(g.label) ? selectedGenres.delete(g.label) : selectedGenres.add(g.label);
        updateMatrixCounters();
      });
      genreGrid.appendChild(btn);
    });
  }

  // Build Tags Grid
  renderTagsGrid(TAGS);

  // Tag filter search
  if (tagFilterInput) {
    tagFilterInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      const filtered = TAGS.filter(t => t.toLowerCase().includes(query));
      renderTagsGrid(filtered);
    });
  }

  // Format Cards
  formatCards.forEach(card => {
    card.addEventListener('click', () => {
      card.classList.toggle('active');
      const fmt = card.dataset.format;
      selectedFormats.has(fmt) ? selectedFormats.delete(fmt) : selectedFormats.add(fmt);
      updateMatrixCounters();
    });
  });

  // Presets
  document.querySelectorAll('.preset-card').forEach(card => {
    card.addEventListener('click', () => {
      const presetKey = card.dataset.preset;
      applyPreset(presetKey);
    });
  });

  // Reset & Randomize Discover Matrix
  document.getElementById('discover-reset-all-btn')?.addEventListener('click', resetDiscoverMatrix);
  document.getElementById('discover-preset-random-btn')?.addEventListener('click', randomizeDiscoverMatrix);
}

function renderTagsGrid(tagList) {
  if (!tagsGrid) return;
  tagsGrid.innerHTML = '';
  tagList.forEach(tag => {
    const btn = document.createElement('button');
    btn.className = `tag-btn ${selectedTags.has(tag) ? 'active' : ''}`;
    btn.textContent = tag;
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      selectedTags.has(tag) ? selectedTags.delete(tag) : selectedTags.add(tag);
    });
    tagsGrid.appendChild(btn);
  });
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

function resetDiscoverMatrix() {
  selectedGenres.clear();
  selectedTags.clear();
  selectedFormats.clear();
  if (customInput) customInput.value = '';
  document.querySelectorAll('.genre-btn.active, .tag-btn.active, .format-card.active, .preset-card.active').forEach(el => {
    el.classList.remove('active');
  });
  updateMatrixCounters();
  showToast('Discovery matrix reset', '🔄');
}

function applyPreset(presetKey) {
  const p = PRESETS[presetKey];
  if (!p) return;

  resetDiscoverMatrix();

  // Highlight active preset card
  document.querySelectorAll('.preset-card').forEach(c => {
    c.classList.toggle('active', c.dataset.preset === presetKey);
  });

  // Formats
  p.formats.forEach(fmt => {
    selectedFormats.add(fmt);
    document.querySelector(`.format-card[data-format="${fmt}"]`)?.classList.add('active');
  });

  // Genres
  p.genres.forEach(g => {
    selectedGenres.add(g);
    document.querySelectorAll('.genre-btn').forEach(btn => {
      if (btn.querySelector('.genre-label')?.textContent === g) btn.classList.add('active');
    });
  });

  // Tags
  p.tags.forEach(t => {
    selectedTags.add(t);
  });
  renderTagsGrid(TAGS);

  // Prompt
  if (customInput) customInput.value = p.prompt;

  updateMatrixCounters();
  showToast(`Loaded "${p.prompt.slice(0, 30)}..." preset`, '⚡');
}

function randomizeDiscoverMatrix() {
  resetDiscoverMatrix();

  // Pick 1-2 random formats
  const allFormats = ['Manga', 'Manhwa', 'Manhua', 'Light Novel'];
  const numFormats = Math.floor(Math.random() * 2) + 1;
  const pickedFormats = [...allFormats].sort(() => 0.5 - Math.random()).slice(0, numFormats);
  pickedFormats.forEach(fmt => {
    selectedFormats.add(fmt);
    document.querySelector(`.format-card[data-format="${fmt}"]`)?.classList.add('active');
  });

  // Pick 2 random genres
  const pickedGenres = [...GENRES].sort(() => 0.5 - Math.random()).slice(0, 2);
  pickedGenres.forEach(g => {
    selectedGenres.add(g.label);
    document.querySelectorAll('.genre-btn').forEach(btn => {
      if (btn.querySelector('.genre-label')?.textContent === g.label) btn.classList.add('active');
    });
  });

  // Pick 3 random tags
  const pickedTags = [...TAGS].sort(() => 0.5 - Math.random()).slice(0, 3);
  pickedTags.forEach(t => selectedTags.add(t));
  renderTagsGrid(TAGS);

  updateMatrixCounters();
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
searchModeTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    searchModeTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    searchMode = tab.dataset.mode;
  });
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
async function submitSearch(overrideQuery = null) {
  const query = overrideQuery || (searchInput ? searchInput.value.trim() : '');
  if (!query) {
    if (searchInput) searchInput.focus();
    setInlineMessage(searchInlineMsg, 'Please enter a title or describe a vibe first.');
    return;
  }

  setInlineMessage(searchInlineMsg, '');
  addSearchHistory(query);

  previousView = 'search';
  currentQuery = { mode: 'search', searchInput: query, searchMode, genres: [], tags: [], formats: [], customInput: '' };
  allRecommendations = [];
  filteredRecommendations = [];

  prepResultsView([query]);

  try {
    const res = await fetch('./api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'search', searchInput: query }),
    });

    const data = await res.json();
    if (!res.ok || !data.recommendations) throw new Error(data.error || 'Unable to retrieve recommendations.');

    if (!data.recommendations.length) {
      showEmptyResults(`No titles matched "${query}". Try searching for another keyword.`);
      return;
    }

    allRecommendations = data.recommendations;
    applyResultsFilterAndSort();
  } catch (err) {
    showErrorResults(err.message || 'Network error occurred while contacting recommendation server.');
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
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
  previousView = 'discover';
  currentQuery = { mode: 'discover', genres, tags, formats, customInput: custom, searchInput: '' };
  allRecommendations = [];
  filteredRecommendations = [];

  const queryParts = [...formats, ...genres, ...tags, custom].filter(Boolean);
  prepResultsView(queryParts);

  try {
    const res = await fetch('./api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'discover', genres, tags, formats, customInput: custom, exclude: [] }),
    });

    const data = await res.json();
    if (!res.ok || !data.recommendations) throw new Error(data.error || 'Unable to retrieve recommendations.');

    if (!data.recommendations.length) {
      showEmptyResults('No titles matched this specific criteria mix. Try adjusting or expanding tags.');
      return;
    }

    allRecommendations = data.recommendations;
    applyResultsFilterAndSort();
  } catch (err) {
    showErrorResults(err.message || 'Network error occurred while contacting recommendation server.');
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

function prepResultsView(queryParts) {
  if (resultsContent) resultsContent.style.display = 'none';
  if (resultsEmpty) resultsEmpty.hidden = true;
  if (errorMsg) errorMsg.style.display = 'none';
  if (loadingEl) loadingEl.style.display = 'block';

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
function applyResultsFilterAndSort() {
  const filterText = resultsFilterInput ? resultsFilterInput.value.toLowerCase().trim() : '';

  // Filter in-memory results
  filteredRecommendations = allRecommendations.filter(r => {
    if (!filterText) return true;
    const matchesTitle = (r.title || '').toLowerCase().includes(filterText);
    const matchesGenre = (r.genre || []).some(g => g.toLowerCase().includes(filterText));
    const matchesSynopsis = (r.synopsis || '').toLowerCase().includes(filterText);
    const matchesType = (r.type || '').toLowerCase().includes(filterText);
    return matchesTitle || matchesGenre || matchesSynopsis || matchesType;
  });

  // Sort
  if (currentSort === 'rating') {
    filteredRecommendations.sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0));
  } else if (currentSort === 'title') {
    filteredRecommendations.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  } else if (currentSort === 'type') {
    filteredRecommendations.sort((a, b) => (a.type || '').localeCompare(b.type || ''));
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

  filteredRecommendations.forEach(r => {
    cardsGrid.appendChild(createCardElement(r));
  });

  if (resultsContent) resultsContent.style.display = 'block';
  if (loadMoreWrapper) {
    loadMoreWrapper.style.display = currentQuery.mode === 'discover' ? 'block' : 'none';
  }
}

// ── Card Builder Component ─────────────────────────────────────────────────
function createCardElement(r, isLibraryCard = false) {
  const typeLower = (r.type || 'Manga').toLowerCase();
  let badgeClass = 'badge-manga';
  if (typeLower === 'manhwa') badgeClass = 'badge-manhwa';
  else if (typeLower === 'manhua') badgeClass = 'badge-manhua';
  else if (typeLower.includes('novel')) badgeClass = 'badge-ln';

  const isCompleted = (r.status || '').toLowerCase() === 'completed';
  const saved = isBookmarked(r.title);

  const card = document.createElement('div');
  card.className = 'card';

  // Cover markup
  const coverMarkup = r.coverImage
    ? `<img src="${escapeHtml(r.coverImage)}" alt="${escapeHtml(r.title)}" class="card-cover-img" loading="lazy" />`
    : `<div class="card-cover-placeholder"><span class="placeholder-symbol">読</span></div>`;

  const genresMarkup = (r.genre || []).slice(0, 3)
    .map(g => `<span class="genre-tag-sm">${escapeHtml(g)}</span>`)
    .join('');

  card.innerHTML = `
    <div class="card-cover-wrap" data-action="detail">
      ${coverMarkup}
      <div class="card-cover-overlay"></div>
      <div class="card-cover-top-actions">
        <div class="card-badges-row">
          <span class="card-badge ${badgeClass}">${escapeHtml(r.type || 'Manga')}</span>
          <span class="card-badge badge-status ${isCompleted ? 'completed' : ''}">${escapeHtml(r.status || 'Ongoing')}</span>
        </div>
        <button class="card-bookmark-btn ${saved ? 'saved' : ''}" data-title="${encodeURIComponent(r.title)}" title="${saved ? 'Remove from Library' : 'Save to Library'}">
          ${saved ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>' : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>'}
        </button>
      </div>
    </div>

    <div class="card-body">
      <div class="card-title-row">
        <h3 class="card-title" data-action="detail">${escapeHtml(r.title)}</h3>
        ${r.rating ? `<span class="card-rating-chip">★ ${escapeHtml(r.rating)}</span>` : ''}
      </div>

      <div class="card-genres">${genresMarkup}</div>
      <p class="card-synopsis">${escapeHtml(r.synopsis || 'No synopsis provided.')}</p>
    </div>

    <div class="card-footer">
      <button class="card-read-btn" data-action="read">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        <span>Read Now</span>
      </button>
      <button class="card-similar-btn" data-action="similar" title="Find titles similar to this">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      </button>
    </div>
  `;

  // Attach Event Listeners
  card.querySelector('.card-bookmark-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleBookmark(r);
  });

  card.querySelectorAll('[data-action="detail"]').forEach(el => {
    el.addEventListener('click', () => openDetailModal(r));
  });

  card.querySelector('[data-action="read"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    handleReadAction(r);
  });

  card.querySelector('[data-action="similar"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (searchInput) searchInput.value = `something like ${r.title}`;
    submitSearch(`something like ${r.title}`);
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
  if (rec.isDirectLink && rec.readUrl) {
    openReader(rec.readUrl, rec.title, rec.type);
  } else if (rec.readUrl) {
    window.open(rec.readUrl, '_blank', 'noopener,noreferrer');
    showToast('Tip: use the Translate to English button if the page loads in another language', '🌐');
  } else {
    const fallbackUrl = `https://www.google.com/search?q=read+${encodeURIComponent(rec.title)}`;
    window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
  }
}

const READER_BLOCKED_THRESHOLD_MS = 380;
const READER_MAX_WAIT_MS = 5500;
let readerResolved = false;
let readerWaitTimer = null;
let readerLoadStart = 0;

function openReader(url, title, type = 'Manga') {
  if (!readerOverlay) return;
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

  // Populate alternative search chips
  if (readerAltChips) {
    const q = encodeURIComponent(title);
    readerAltChips.innerHTML = `
      <a class="alt-source-btn" href="https://www.google.com/search?q=site:mangabuddy.com+${q}" target="_blank" rel="noopener">MangaBuddy</a>
      <a class="alt-source-btn" href="https://mangadex.org/search?q=${q}" target="_blank" rel="noopener">MangaDex</a>
      <a class="alt-source-btn" href="https://www.webtoons.com/en/search?keyword=${q}" target="_blank" rel="noopener">Webtoon</a>
      <a class="alt-source-btn" href="https://freewebnovel.com/search?searchkey=${q}" target="_blank" rel="noopener">FreeWebNovel</a>
      <a class="alt-source-btn" href="https://www.google.com/search?q=read+${q}" target="_blank" rel="noopener">Google</a>
    `;
  }

  if (readerLoading) readerLoading.style.display = 'flex';
  if (readerBlocked) readerBlocked.classList.remove('visible');
  if (readerIframe) readerIframe.style.display = 'none';

  readerOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';

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
  if (readerIframe) readerIframe.style.display = 'none';
  if (readerBlocked) readerBlocked.classList.add('visible');
}

function showReaderLoaded() {
  if (readerLoading) readerLoading.style.display = 'none';
  if (readerBlocked) readerBlocked.classList.remove('visible');
  if (readerIframe) readerIframe.style.display = 'block';
}

function closeReader() {
  if (!readerOverlay) return;
  readerOverlay.classList.remove('open');
  document.body.style.overflow = '';
  clearTimeout(readerWaitTimer);
  if (readerIframe) {
    readerIframe.onload = null;
    readerIframe.src = 'about:blank';
  }
}

if (readerCloseBtn) readerCloseBtn.addEventListener('click', closeReader);

// ── Detail Modal Controller ────────────────────────────────────────────────
function openDetailModal(rec) {
  if (!detailModal || !detailModalContent) return;
  const saved = isBookmarked(rec.title);

  const coverMarkup = rec.coverImage
    ? `<img src="${escapeHtml(rec.coverImage)}" alt="${escapeHtml(rec.title)}" class="detail-cover-img" />`
    : `<div class="card-cover-placeholder" style="height:320px;"><span class="placeholder-symbol">読</span></div>`;

  const genresMarkup = (rec.genre || []).map(g => `<span class="genre-tag-sm">${escapeHtml(g)}</span>`).join('');

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

        <div class="card-genres" style="margin-bottom:16px;">${genresMarkup}</div>

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
    detailModal.classList.remove('open');
    handleReadAction(rec);
  });

  document.getElementById('detail-bookmark-btn')?.addEventListener('click', (e) => {
    toggleBookmark(rec);
    const nowSaved = isBookmarked(rec.title);
    e.currentTarget.innerHTML = nowSaved ? '<span>Saved in Library ✓</span>' : '<span>Save to Library</span>';
  });

  document.getElementById('detail-similar-btn')?.addEventListener('click', () => {
    detailModal.classList.remove('open');
    if (searchInput) searchInput.value = `something like ${rec.title}`;
    submitSearch(`something like ${rec.title}`);
  });

  detailModal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

if (detailModalClose) {
  detailModalClose.addEventListener('click', () => {
    detailModal.classList.remove('open');
    document.body.style.overflow = '';
  });
}

// ── Command Palette (Cmd + K) ──────────────────────────────────────────────
function openCmdPalette() {
  if (!cmdModal) return;
  cmdModal.classList.add('open');
  document.body.style.overflow = 'hidden';
  if (cmdInput) {
    cmdInput.value = '';
    setTimeout(() => cmdInput.focus(), 100);
  }
}

function closeCmdPalette() {
  if (!cmdModal) return;
  cmdModal.classList.remove('open');
  document.body.style.overflow = '';
}

if (cmdTriggerBtn) cmdTriggerBtn.addEventListener('click', openCmdPalette);

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    if (cmdModal && cmdModal.classList.contains('open')) closeCmdPalette();
    else openCmdPalette();
  } else if (e.key === 'Escape') {
    closeCmdPalette();
    if (detailModal) {
      detailModal.classList.remove('open');
      document.body.style.overflow = '';
    }
    if (readerOverlay && readerOverlay.classList.contains('open')) closeReader();
  }
});

if (cmdModal) {
  cmdModal.addEventListener('click', (e) => {
    if (e.target === cmdModal) closeCmdPalette();
  });
}

if (cmdInput) {
  cmdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = cmdInput.value.trim();
      if (q) {
        closeCmdPalette();
        if (searchInput) searchInput.value = q;
        submitSearch(q);
      }
    }
  });
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

  if (!bookmarks.length) {
    if (libraryEmpty) libraryEmpty.style.display = 'block';
    return;
  }
  if (libraryEmpty) libraryEmpty.style.display = 'none';

  const searchQuery = librarySearchInput ? librarySearchInput.value.toLowerCase().trim() : '';

  const filtered = bookmarks.filter(item => {
    if (libraryFilter !== 'all') {
      const t = (item.type || '').toLowerCase();
      if (libraryFilter === 'Light Novel' && !t.includes('novel')) return false;
      if (libraryFilter !== 'Light Novel' && t !== libraryFilter.toLowerCase()) return false;
    }
    if (searchQuery) {
      return (item.title || '').toLowerCase().includes(searchQuery) ||
             (item.synopsis || '').toLowerCase().includes(searchQuery);
    }
    return true;
  });

  filtered.forEach(rec => {
    libraryCardsGrid.appendChild(createCardElement(rec, true));
  });
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
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kindoku-library-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Library exported to JSON', '💾');
  });
}

if (libraryImportBtn && libraryFileInput) {
  libraryImportBtn.addEventListener('click', () => libraryFileInput.click());
  libraryFileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (Array.isArray(imported)) {
          const current = getLibraryBookmarks();
          const merged = [...imported, ...current].filter((item, index, self) =>
            index === self.findIndex(t => t.title.toLowerCase() === item.title.toLowerCase())
          );
          saveLibraryBookmarks(merged);
          renderLibrary();
          showToast(`Imported ${imported.length} bookmarks successfully!`, '📥');
        }
      } catch {
        showToast('Invalid JSON backup file format.', '❌');
      }
    };
    reader.readAsText(file);
  });
}

// ── Load More Discovery ────────────────────────────────────────────────────
if (loadMoreBtn) {
  loadMoreBtn.addEventListener('click', async () => {
    if (currentQuery.mode !== 'discover') return;
    loadMoreBtn.disabled = true;
    if (loadMoreText) loadMoreText.textContent = 'Consulting Archives...';

    try {
      const res = await fetch('./api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'discover',
          genres: currentQuery.genres,
          tags: currentQuery.tags,
          formats: currentQuery.formats,
          customInput: currentQuery.customInput,
          exclude: allRecommendations.map(r => r.title).slice(-25),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.recommendations) throw new Error(data.error || 'Failed to fetch more recommendations.');

      data.recommendations.forEach(r => {
        allRecommendations.push(r);
      });

      applyResultsFilterAndSort();
      showToast(`Loaded ${data.recommendations.length} new recommendations!`, '✨');
    } catch (err) {
      showToast(err.message || 'Error loading more titles', '⚠');
    } finally {
      loadMoreBtn.disabled = false;
      if (loadMoreText) loadMoreText.textContent = 'Discover 10 More';
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