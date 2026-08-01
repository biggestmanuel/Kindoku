interface LandingViewProps {
  onGoSearch: () => void;
  onGoDiscover: () => void;
}

export default function LandingView({ onGoSearch, onGoDiscover }: LandingViewProps) {
  return (
    <div id="view-landing" className="view-active view-enter">
      <section id="hero">
        <p className="hero-kana">近 · 흑 · 読 · きんどく</p>
        <h1 className="hero-title">
          <span className="gold-text">Kindoku</span>
          <span className="red-text">Your Next Obsession Starts Here</span>
        </h1>
        <p className="hero-subtitle">
          Discover Manga, Manhwa, Manhua &amp; Light Novels across every genre, every mood.
        </p>
        <div className="hero-languages">
          <span className="hero-lang-tag"><span>近</span> Near · Japanese</span>
          <span className="hero-lang-tag"><span>흑</span> Black · Korean</span>
          <span className="hero-lang-tag"><span>読</span> Read · Chinese</span>
        </div>
        <div className="hero-actions">
          <button className="hero-btn hero-btn-search" onClick={onGoSearch}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            Search
          </button>
          <button className="hero-btn hero-btn-discover" onClick={onGoDiscover}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            Discover
          </button>
        </div>
      </section>
    </div>
  );
}
