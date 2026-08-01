// ── Particle System ──
const canvas = document.getElementById('particle-canvas');
const ctx = canvas.getContext('2d');
let particles = [];

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

class Particle {
  constructor() { this.reset(true); }
  reset(initial = false) {
    this.x = Math.random() * canvas.width;
    this.y = initial ? Math.random() * canvas.height : canvas.height + 10;
    this.size = Math.random() * 2 + 0.3;
    this.speedY = -(Math.random() * 0.4 + 0.1);
    this.speedX = (Math.random() - 0.5) * 0.3;
    this.opacity = Math.random() * 0.6 + 0.1;
    this.opacitySpeed = (Math.random() * 0.005 + 0.002) * (Math.random() > 0.5 ? 1 : -1);
    this.twinkle = Math.random() > 0.6;
    this.twinkleSpeed = Math.random() * 0.03 + 0.01;
    this.twinkleOffset = Math.random() * Math.PI * 2;
    const gold = Math.random() > 0.25;
    if (gold) {
      const r = Math.floor(180 + Math.random() * 71);
      const g = Math.floor(130 + Math.random() * 60);
      const b = Math.floor(20 + Math.random() * 40);
      this.color = `rgb(${r},${g},${b})`;
    } else {
      this.color = `rgb(${Math.floor(120 + Math.random() * 60)},${Math.floor(20 + Math.random() * 30)},20)`;
    }
  }
  update() {
    this.x += this.speedX; this.y += this.speedY;
    this.opacity += this.opacitySpeed;
    if (this.opacity > 0.8 || this.opacity < 0.05) this.opacitySpeed *= -1;
    if (this.y < -10) this.reset();
  }
  draw(t) {
    let op = this.opacity;
    if (this.twinkle) op *= (0.5 + 0.5 * Math.sin(t * this.twinkleSpeed + this.twinkleOffset));
    ctx.save(); ctx.globalAlpha = op; ctx.fillStyle = this.color;
    if (this.size > 1.5) { ctx.shadowBlur = 6; ctx.shadowColor = this.color; }
    ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
}

function initParticles() {
  particles = [];
  const count = Math.min(Math.floor((canvas.width * canvas.height) / 6000), 180);
  for (let i = 0; i < count; i++) particles.push(new Particle());
}
function animateParticles(t = 0) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles.forEach(p => { p.update(); p.draw(t); });
  requestAnimationFrame(animateParticles);
}
window.addEventListener('resize', () => { resizeCanvas(); initParticles(); });
resizeCanvas(); initParticles(); animateParticles();

// ── HTML Escaping ──────────────────────────────────────────────────────────
// Recommendation content (title, synopsis, genres, etc.) comes from an LLM,
// and search/custom input come straight from the user and get echoed back
// into the prompt. Neither is trusted, so anything going into innerHTML
// must be escaped to prevent stray markup/script injection.
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Data ──
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
  'Isekai','Regression','System','Dungeon','Hunter',
  'Murim','Cultivation','Reincarnation','Villainess','Magic',
  'School Life','Survival','Time Travel','Revenge','OP MC',
  'Kingdom Building','Academy','Demons','Necromancer','Tower Climbing',
];

// ── State ──
let selectedGenres = new Set();
let selectedTags = new Set();
let selectedFormats = new Set();
let currentQuery = { genres: [], tags: [], formats: [], customInput: '', searchInput: '', mode: 'discover' };
let allTitles = [];
let previousView = 'landing';

// ── DOM ──
const viewLanding    = document.getElementById('view-landing');
const viewSearch     = document.getElementById('view-search');
const viewDiscover   = document.getElementById('view-discover');
const viewResults    = document.getElementById('view-results');
const genreGrid      = document.getElementById('genre-grid');
const tagsGrid       = document.getElementById('tags-grid');
const customInput    = document.getElementById('custom-input');
const discoverBtn    = document.getElementById('discover-btn');
const backBtn        = document.getElementById('back-btn');
const loadingEl      = document.getElementById('loading');
const resultsContent = document.getElementById('results-content');
const cardsGrid      = document.getElementById('cards-grid');
const resultsTitle   = document.getElementById('results-title');
const resultsMeta    = document.getElementById('results-meta');
const errorMsg       = document.getElementById('error-msg');
const resultsQueryTags = document.getElementById('results-query-tags');
const loadMoreBtn    = document.getElementById('load-more-btn');
const loadMoreText   = document.getElementById('load-more-text');
const searchInput    = document.getElementById('search-input');
const searchSubmitBtn = document.getElementById('search-submit-btn');
const navLogoBtn     = document.getElementById('nav-logo-btn');

// ── Reader Overlay DOM ──
const readerOverlay        = document.getElementById('reader-overlay');
const readerCloseBtn       = document.getElementById('reader-close-btn');
const readerTitleEl        = document.getElementById('reader-title');
const readerExternalBtn    = document.getElementById('reader-external-btn');
const readerIframe         = document.getElementById('reader-iframe');
const readerLoading        = document.getElementById('reader-loading');
const readerBlocked        = document.getElementById('reader-blocked');
const readerBlockedExternalBtn = document.getElementById('reader-blocked-external-btn');

// ── Build Genre Grid ──
GENRES.forEach(g => {
  const btn = document.createElement('button');
  btn.className = 'genre-btn';
  btn.innerHTML = `<span class="genre-icon">${g.icon}</span>${g.label}`;
  btn.addEventListener('click', () => {
    btn.classList.toggle('active');
    selectedGenres.has(g.label) ? selectedGenres.delete(g.label) : selectedGenres.add(g.label);
  });
  genreGrid.appendChild(btn);
});

// ── Build Tags Grid ──
TAGS.forEach(tag => {
  const btn = document.createElement('button');
  btn.className = 'tag-btn';
  btn.textContent = tag;
  btn.addEventListener('click', () => {
    btn.classList.toggle('active');
    selectedTags.has(tag) ? selectedTags.delete(tag) : selectedTags.add(tag);
  });
  tagsGrid.appendChild(btn);
});

// ── Format buttons ──
document.querySelectorAll('.format-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.classList.toggle('active');
    const fmt = btn.dataset.format;
    selectedFormats.has(fmt) ? selectedFormats.delete(fmt) : selectedFormats.add(fmt);
  });
});

// ── In-App Reader ────────────────────────────────────────────────────────
// Only ever called for links flagged isDirectLink: true — Google
// site-search fallback links always open in a normal new tab instead
// (see buildCard), since Google refuses to be embedded outright.
//
// Even "real" direct links (Webtoon, MangaDex, etc.) may still set
// X-Frame-Options and block embedding — there's no way to know for a
// given site without trying. Detecting a block from JS is unreliable
// too: cross-origin iframes fire `load` even when the browser shows its
// own "refused to connect" page, and we can't read the frame's content
// to check. The best available heuristic: a real page load takes at
// least a little network round-trip time, while a browser-generated
// block page tends to resolve almost instantly. So — if `load` fires
// suspiciously fast, treat it as likely blocked and show the fallback.
// It's not perfect, but it beats always showing a blank frame.
const READER_BLOCKED_THRESHOLD_MS = 350;
const READER_MAX_WAIT_MS = 6000;

let readerResolved = false;
let readerMaxWaitTimer = null;
let readerLoadStart = 0;

function showReaderBlocked() {
  readerLoading.style.display = 'none';
  readerIframe.style.display = 'none';
  readerBlocked.classList.add('visible');
}

function showReaderLoaded() {
  readerLoading.style.display = 'none';
  readerBlocked.classList.remove('visible');
  readerIframe.style.display = 'block';
}

function handleReaderLoad() {
  if (readerResolved) return;
  readerResolved = true;
  clearTimeout(readerMaxWaitTimer);

  const elapsed = Date.now() - readerLoadStart;
  if (elapsed < READER_BLOCKED_THRESHOLD_MS) {
    showReaderBlocked();
  } else {
    showReaderLoaded();
  }
}

function openReader(url, title) {
  readerTitleEl.textContent = title;
  readerExternalBtn.href = url;
  readerBlockedExternalBtn.href = url;

  readerLoading.style.display = 'flex';
  readerBlocked.classList.remove('visible');
  readerIframe.style.display = 'none';

  readerOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';

  readerResolved = false;
  readerLoadStart = Date.now();
  clearTimeout(readerMaxWaitTimer);
  readerMaxWaitTimer = setTimeout(() => {
    if (readerResolved) return;
    readerResolved = true;
    showReaderBlocked();
  }, READER_MAX_WAIT_MS);

  readerIframe.onload = handleReaderLoad;
  readerIframe.src = url;
}

function closeReader() {
  readerOverlay.classList.remove('open');
  document.body.style.overflow = '';
  clearTimeout(readerMaxWaitTimer);
  readerIframe.onload = null;
  readerIframe.src = 'about:blank';
}

readerCloseBtn.addEventListener('click', closeReader);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && readerOverlay.classList.contains('open')) closeReader();
});

// ── View Management ──
const VIEWS = { landing: viewLanding, search: viewSearch, discover: viewDiscover, results: viewResults };

function switchView(to) {
  Object.values(VIEWS).forEach(v => {
    v.classList.remove('view-active', 'view-enter', 'view-exit');
    v.style.display = 'none';
  });
  const target = VIEWS[to];
  target.style.display = 'block';
  target.classList.add('view-active', 'view-enter');
  setTimeout(() => target.classList.remove('view-enter'), 600);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Landing buttons ──
document.getElementById('btn-go-search').addEventListener('click', () => {
  previousView = 'landing';
  switchView('search');
  setTimeout(() => searchInput.focus(), 500);
});

document.getElementById('btn-go-discover').addEventListener('click', () => {
  previousView = 'landing';
  switchView('discover');
});

// ── Back buttons ──
document.getElementById('search-back-btn').addEventListener('click', () => switchView('landing'));
document.getElementById('discover-back-btn').addEventListener('click', () => switchView('landing'));
backBtn.addEventListener('click', () => switchView(previousView === 'search' ? 'search' : 'discover'));
navLogoBtn.addEventListener('click', e => { e.preventDefault(); switchView('landing'); });

// ── Search Submit ──
searchSubmitBtn.addEventListener('click', submitSearch);
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitSearch(); });

async function submitSearch() {
  const query = searchInput.value.trim();
  if (!query) { searchInput.focus(); return; }

  previousView = 'search';
  currentQuery = { mode: 'search', searchInput: query, genres: [], tags: [], formats: [], customInput: '' };
  allTitles = [];

  // Reset the results view immediately — before switching to it — so the
  // previous search's cards never get a chance to flash on screen while
  // the view-enter animation plays.
  loadingEl.style.display = 'block';
  resultsContent.style.display = 'none';
  errorMsg.style.display = 'none';
  cardsGrid.innerHTML = '';
  loadMoreBtn.parentElement.style.display = 'none';
  resultsQueryTags.innerHTML = `<span class="query-tag">${escapeHtml(query)}</span>`;

  switchView('results');

  setTimeout(async () => {
    try {
      const res = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'search', searchInput: query }),
      });
      const data = await res.json();
      if (!res.ok || !data.recommendations) throw new Error(data.error || 'Something went wrong');
      allTitles = data.recommendations.map(r => r.title);
      renderCards(data.recommendations, [query], data.isExact);
    } catch (err) {
      errorMsg.textContent = `⚠ ${err.message}`;
      errorMsg.style.display = 'block';
    } finally {
      loadingEl.style.display = 'none';
    }
  }, 450);
}

// ── Discover Submit ──
discoverBtn.addEventListener('click', submitDiscover);
customInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitDiscover(); });

async function submitDiscover() {
  const genres = [...selectedGenres];
  const tags = [...selectedTags];
  const formats = [...selectedFormats];
  const custom = customInput.value.trim();

  if (!genres.length && !tags.length && !custom) { shakeBtn(discoverBtn); return; }

  previousView = 'discover';
  currentQuery = { mode: 'discover', genres, tags, formats, customInput: custom, searchInput: '' };
  allTitles = [];

  const queryParts = [...genres, ...tags, ...formats, custom].filter(Boolean);

  // Reset the results view immediately — before switching to it — so the
  // previous search's cards never get a chance to flash on screen while
  // the view-enter animation plays.
  loadingEl.style.display = 'block';
  resultsContent.style.display = 'none';
  errorMsg.style.display = 'none';
  cardsGrid.innerHTML = '';
  loadMoreBtn.parentElement.style.display = 'block';
  resultsQueryTags.innerHTML = queryParts.map(q => `<span class="query-tag">${escapeHtml(q)}</span>`).join('');

  switchView('results');

  setTimeout(async () => {
    try {
      const res = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'discover', genres, tags, formats, customInput: custom, exclude: [] }),
      });
      const data = await res.json();
      if (!res.ok || !data.recommendations) throw new Error(data.error || 'Something went wrong');
      allTitles = data.recommendations.map(r => r.title);
      renderCards(data.recommendations, queryParts, false);
    } catch (err) {
      errorMsg.textContent = `⚠ ${err.message}`;
      errorMsg.style.display = 'block';
    } finally {
      loadingEl.style.display = 'none';
    }
  }, 450);
}

// ── Render Cards ──
function renderCards(recs, queryParts, isExact = false) {
  cardsGrid.innerHTML = '';
  const label = queryParts.slice(0, 3).join(' · ') + (queryParts.length > 3 ? ' · ...' : '');
  resultsTitle.textContent = isExact ? queryParts[0] : `Results for "${label}"`;
  resultsMeta.textContent = `${recs.length} title${recs.length !== 1 ? 's' : ''} found`;
  recs.forEach(r => buildCard(r));
  resultsContent.style.display = 'block';
}

// ── Build Card ──
function buildCard(r) {
  const typeClass = r.type?.toLowerCase() === 'light novel' ? 'ln'
    : r.type?.toLowerCase() === 'manhwa' ? 'manhwa'
    : r.type?.toLowerCase() === 'manhua' ? 'manhua' : '';
  const statusClass = r.status?.toLowerCase() === 'completed' ? 'completed' : '';
  const genreTags = (r.genre || []).map(g => `<span class="genre-tag">${escapeHtml(g)}</span>`).join('');

  // Cover: real AniList image OR styled placeholder
  const coverHTML = r.coverImage
    ? `<div class="card-cover">
         <img src="${escapeHtml(r.coverImage)}" alt="${escapeHtml(r.title)} cover" loading="lazy" />
         <div class="card-cover-overlay"></div>
       </div>`
    : `<div class="card-cover card-cover--placeholder">
         <div class="card-cover-placeholder-inner">
           <span class="placeholder-kanji">読</span>
           ${r.coverHint ? `<p class="placeholder-hint">${escapeHtml(r.coverHint)}</p>` : ''}
         </div>
       </div>`;

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    ${coverHTML}
    <div class="card-top">
      <div class="card-badges">
        <span class="badge badge-type ${typeClass}">${escapeHtml(r.type || 'Manga')}</span>
        <span class="badge badge-status ${statusClass}">${escapeHtml(r.status || 'Ongoing')}</span>
      </div>
      ${r.rating ? `<div class="card-rating">${escapeHtml(r.rating)}</div>` : ''}
    </div>
    <div class="card-body">
      <h3 class="card-title">${escapeHtml(r.title)}</h3>
      <div class="card-genres">${genreTags}</div>
      <p class="card-synopsis">${escapeHtml(r.synopsis)}</p>
    </div>
    <div class="card-footer">
      <a class="read-btn" href="${escapeHtml(r.readUrl)}" target="_blank" rel="noopener noreferrer">読む · Read Now</a>
    </div>
  `;
  cardsGrid.appendChild(card);

  // Only route through the in-app reader for real direct links (from
  // AniList's externalLinks). Google search fallback links always block
  // embedding, so those keep opening in a normal new tab.
  if (r.isDirectLink) {
    const readBtn = card.querySelector('.read-btn');
    readBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openReader(r.readUrl, r.title);
    });
  }
}

// ── Load More ──
loadMoreBtn.addEventListener('click', async () => {
  if (currentQuery.mode === 'search') return;
  loadMoreBtn.disabled = true;
  loadMoreBtn.classList.add('loading-more');
  loadMoreText.textContent = 'Loading...';

  try {
    const res = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'discover',
        genres: currentQuery.genres,
        tags: currentQuery.tags,
        formats: currentQuery.formats,
        customInput: currentQuery.customInput,
        exclude: allTitles.slice(-20),
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.recommendations) throw new Error(data.error || 'Something went wrong');
    data.recommendations.forEach(r => { allTitles.push(r.title); buildCard(r); });
    resultsMeta.textContent = `${allTitles.length} titles found`;
  } catch (err) {
    console.error('Load more failed:', err.message);
  } finally {
    loadMoreBtn.disabled = false;
    loadMoreBtn.classList.remove('loading-more');
    loadMoreText.textContent = 'Load More';
  }
});

// ── Shake ──
function shakeBtn(btn) {
  btn.style.animation = 'none'; btn.offsetHeight;
  btn.style.animation = 'shake 0.4s ease';
  setTimeout(() => btn.style.animation = '', 400);
}

const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
  @keyframes shake {
    0%,100%{transform:translateX(0)} 20%{transform:translateX(-8px)}
    40%{transform:translateX(8px)} 60%{transform:translateX(-5px)} 80%{transform:translateX(5px)}
  }
`;
document.head.appendChild(shakeStyle);

// Init — show landing
switchView('landing');

// ── PWA: Service Worker Registration ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

// ── PWA: Install Prompt ──
let deferredInstallPrompt = null;
const installBtn = document.getElementById('install-btn');
const installTooltip = document.getElementById('install-tooltip');

// Check if already running as an installed app (standalone mode)
const isStandalone = window.matchMedia('(display-mode: standalone)').matches
  || window.navigator.standalone === true;

if (isStandalone && installBtn) {
  installBtn.style.display = 'none';
} else if (installBtn) {
  installBtn.style.display = 'flex';
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
});

function detectPlatform() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isAndroid = /Android/.test(ua);
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
  return { isIOS, isAndroid, isSafari };
}

function showInstallTooltip(message) {
  if (!installTooltip) return;
  installTooltip.textContent = message;
  installTooltip.classList.add('visible');
  setTimeout(() => installTooltip.classList.remove('visible'), 5000);
}

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    // Case 1: Chrome/Edge/Android — native prompt is ready
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') installBtn.style.display = 'none';
      deferredInstallPrompt = null;
      return;
    }

    // Case 2: Manual instructions based on platform
    const { isIOS, isAndroid, isSafari } = detectPlatform();

    if (isIOS) {
      showInstallTooltip('Tap the Share icon (⬆) below, then "Add to Home Screen"');
    } else if (isAndroid) {
      showInstallTooltip('Tap the ⋮ menu (top right), then "Install app" or "Add to Home screen"');
    } else if (isSafari) {
      showInstallTooltip('Open File menu → "Add to Dock" (or use Chrome for one-tap install)');
    } else {
      showInstallTooltip('Look for an install icon in your address bar, or check your browser menu');
    }
  });
}

// Hide install button once the app is installed
window.addEventListener('appinstalled', () => {
  if (installBtn) installBtn.style.display = 'none';
  deferredInstallPrompt = null;
});