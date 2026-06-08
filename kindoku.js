// ── Particle System ──
const canvas = document.getElementById('particle-canvas');
const ctx = canvas.getContext('2d');
let particles = [];
let animFrameId;

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
    this.gold = Math.random() > 0.25;
    // gold or red-gold particle
    if (this.gold) {
      const r = Math.floor(180 + Math.random() * 71);
      const g = Math.floor(130 + Math.random() * 60);
      const b = Math.floor(20 + Math.random() * 40);
      this.color = `rgb(${r},${g},${b})`;
    } else {
      this.color = `rgb(${Math.floor(120 + Math.random() * 60)},${Math.floor(20 + Math.random() * 30)},${Math.floor(20 + Math.random() * 20)})`;
    }
    this.twinkle = Math.random() > 0.6;
    this.twinkleSpeed = Math.random() * 0.03 + 0.01;
    this.twinkleOffset = Math.random() * Math.PI * 2;
  }

  update(t) {
    this.x += this.speedX;
    this.y += this.speedY;
    this.opacity += this.opacitySpeed;
    if (this.opacity > 0.8 || this.opacity < 0.05) this.opacitySpeed *= -1;
    if (this.y < -10) this.reset();
  }

  draw(t) {
    let op = this.opacity;
    if (this.twinkle) op *= (0.5 + 0.5 * Math.sin(t * this.twinkleSpeed + this.twinkleOffset));
    ctx.save();
    ctx.globalAlpha = op;
    ctx.fillStyle = this.color;
    if (this.size > 1.5) {
      // star shape for larger particles
      ctx.shadowBlur = 6;
      ctx.shadowColor = this.color;
    }
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function initParticles() {
  particles = [];
  const count = Math.min(Math.floor((canvas.width * canvas.height) / 6000), 180);
  for (let i = 0; i < count; i++) particles.push(new Particle());
}

let lastT = 0;
function animateParticles(t = 0) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles.forEach(p => { p.update(t); p.draw(t); });
  animFrameId = requestAnimationFrame(animateParticles);
}

window.addEventListener('resize', () => {
  resizeCanvas();
  initParticles();
});

resizeCanvas();
initParticles();
animateParticles();

// ── Genre Data ──
const GENRES = [
  { label: 'Action', icon: '⚔️' },
  { label: 'Adventure', icon: '🗺️' },
  { label: 'Fantasy', icon: '🌌' },
  { label: 'Dark Fantasy', icon: '🖤' },
  { label: 'Romance', icon: '🌸' },
  { label: 'Isekai', icon: '🌀' },
  { label: 'Horror', icon: '👁️' },
  { label: 'Thriller', icon: '🔪' },
  { label: 'Sci-Fi', icon: '🚀' },
  { label: 'Mecha', icon: '🤖' },
  { label: 'Slice of Life', icon: '☕' },
  { label: 'Comedy', icon: '😂' },
  { label: 'Drama', icon: '🎭' },
  { label: 'Mystery', icon: '🔍' },
  { label: 'Sports', icon: '⚽' },
  { label: 'Martial Arts', icon: '🥋' },
  { label: 'Supernatural', icon: '👻' },
  { label: 'Historical', icon: '📜' },
  { label: 'Psychological', icon: '🧠' },
  { label: 'Overpowered MC', icon: '💥' },
  { label: 'Cultivation', icon: '🐉' },
  { label: 'System', icon: '📊' },
  { label: 'Dungeon', icon: '🏚️' },
  { label: 'Harem', icon: '💞' },
];

// ── DOM Refs ──
const genreGrid = document.getElementById('genre-grid');
const customInput = document.getElementById('custom-input');
const searchBtn = document.getElementById('search-btn');
const loadingEl = document.getElementById('loading');
const resultsSection = document.getElementById('results-section');
const cardsGrid = document.getElementById('cards-grid');
const resultsTitle = document.getElementById('results-title');
const resultsMeta = document.getElementById('results-meta');
const errorMsg = document.getElementById('error-msg');

let selectedGenre = null;

// ── Build Genre Grid ──
GENRES.forEach(g => {
  const btn = document.createElement('button');
  btn.className = 'genre-btn';
  btn.innerHTML = `<span class="genre-icon">${g.icon}</span>${g.label}`;
  btn.addEventListener('click', () => {
    document.querySelectorAll('.genre-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedGenre = g.label;
    customInput.value = '';
  });
  genreGrid.appendChild(btn);
});

// ── Custom input clears genre selection ──
customInput.addEventListener('input', () => {
  if (customInput.value.trim()) {
    document.querySelectorAll('.genre-btn').forEach(b => b.classList.remove('active'));
    selectedGenre = null;
  }
});

// ── Search ──
searchBtn.addEventListener('click', fetchRecommendations);

customInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') fetchRecommendations();
});

async function fetchRecommendations() {
  const query = customInput.value.trim() || selectedGenre;
  if (!query) {
    shakeInput();
    return;
  }

  // UI state: loading
  searchBtn.disabled = true;
  loadingEl.style.display = 'block';
  resultsSection.style.display = 'none';
  errorMsg.style.display = 'none';
  cardsGrid.innerHTML = '';

  // Scroll to loading
  loadingEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

  try {
    const res = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        genre: selectedGenre,
        customInput: customInput.value.trim(),
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.recommendations) {
      throw new Error(data.error || 'Something went wrong');
    }

    renderCards(data.recommendations, query);
  } catch (err) {
    console.error(err);
    errorMsg.textContent = `⚠ ${err.message || 'Failed to fetch recommendations. Try again.'}`;
    errorMsg.style.display = 'block';
  } finally {
    loadingEl.style.display = 'none';
    searchBtn.disabled = false;
  }
}

// ── Render Cards ──
function renderCards(recs, query) {
  cardsGrid.innerHTML = '';

  resultsTitle.textContent = `Results for "${query}"`;
  resultsMeta.textContent = `${recs.length} titles found`;

  recs.forEach((r, i) => {
    const typeClass = r.type?.toLowerCase().replace(' ', '') === 'light novel' ? 'ln'
      : r.type?.toLowerCase() === 'manhwa' ? 'manhwa'
      : r.type?.toLowerCase() === 'manhua' ? 'manhua'
      : '';

    const statusClass = r.status?.toLowerCase() === 'completed' ? 'completed' : '';

    const genreTags = (r.genre || []).map(g =>
      `<span class="genre-tag">${g}</span>`
    ).join('');

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
        <a class="read-btn" href="${r.readUrl}" target="_blank" rel="noopener noreferrer">
          読む · Read Now
        </a>
      </div>
    `;
    cardsGrid.appendChild(card);
  });

  resultsSection.style.display = 'block';
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Shake animation for empty input ──
function shakeInput() {
  customInput.style.animation = 'none';
  customInput.offsetHeight; // reflow
  customInput.style.animation = 'shake 0.4s ease';
  customInput.focus();
}

// inject shake keyframes
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
  @keyframes shake {
    0%,100% { transform: translateX(0); }
    20% { transform: translateX(-8px); }
    40% { transform: translateX(8px); }
    60% { transform: translateX(-5px); }
    80% { transform: translateX(5px); }
  }
`;
document.head.appendChild(shakeStyle);