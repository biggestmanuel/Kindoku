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
const viewLanding   = document.getElementById('view-landing');
const viewSearch    = document.getElementById('view-search');
const viewDiscover  = document.getElementById('view-discover');
const viewResults   = document.getElementById('view-results');
const genreGrid     = document.getElementById('genre-grid');
const tagsGrid      = document.getElementById('tags-grid');
const customInput   = document.getElementById('custom-input');
const discoverBtn   = document.getElementById('discover-btn');
const backBtn       = document.getElementById('back-btn');
const loadingEl     = document.getElementById('loading');
const resultsContent= document.getElementById('results-content');
const cardsGrid     = document.getElementById('cards-grid');
const resultsTitle  = document.getElementById('results-title');
const resultsMeta   = document.getElementById('results-meta');
const errorMsg      = document.getElementById('error-msg');
const resultsQueryTags = document.getElementById('results-query-tags');
const loadMoreBtn   = document.getElementById('load-more-btn');
const loadMoreText  = document.getElementById('load-more-text');
const searchInput   = document.getElementById('search-input');
const searchSubmitBtn = document.getElementById('search-submit-btn');
const navLogoBtn    = document.getElementById('nav-logo-btn');

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

  switchView('results');

  setTimeout(async () => {
    loadingEl.style.display = 'block';
    resultsContent.style.display = 'none';
    errorMsg.style.display = 'none';
    cardsGrid.innerHTML = '';
    loadMoreBtn.parentElement.style.display = 'none';

    resultsQueryTags.innerHTML = `<span class="query-tag">${query}</span>`;

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
  switchView('results');

  setTimeout(async () => {
    loadingEl.style.display = 'block';
    resultsContent.style.display = 'none';
    errorMsg.style.display = 'none';
    cardsGrid.innerHTML = '';
    loadMoreBtn.parentElement.style.display = 'block';

    resultsQueryTags.innerHTML = queryParts.map(q => `<span class="query-tag">${q}</span>`).join('');

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
  const genreTags = (r.genre || []).map(g => `<span class="genre-tag">${g}</span>`).join('');

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="card-top">
      <div class="card-badges">
        <span class="badge badge-type ${typeClass}">${r.type || 'Manga'}</span>
        <span class="badge badge-status ${statusClass}">${r.status || 'Ongoing'}</span>
      </div>
      <div class="card-rating">${r.rating || '—'}</div>
    </div>
    <div class="card-body">
      <h3 class="card-title">${r.title}</h3>
      <div class="card-genres">${genreTags}</div>
      <p class="card-synopsis">${r.synopsis}</p>
      ${r.coverHint ? `<p class="card-cover-hint">${r.coverHint}</p>` : ''}
    </div>
    <div class="card-footer">
      <a class="read-btn" href="${r.readUrl}" target="_blank" rel="noopener noreferrer">読む · Read Now</a>
    </div>
  `;
  cardsGrid.appendChild(card);
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
        exclude: allTitles,
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