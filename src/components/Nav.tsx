import { useInstallPrompt } from '../hooks/useInstallPrompt';

interface NavProps {
  onLogoClick: () => void;
}

export default function Nav({ onLogoClick }: NavProps) {
  const { canInstall, tooltipMessage, promptInstall } = useInstallPrompt();

  return (
    <nav>
      <a
        className="nav-logo"
        href="#"
        onClick={(e) => {
          e.preventDefault();
          onLogoClick();
        }}
      >
        <img src="/icon-192.png" alt="" className="nav-logo-icon" />
        <span className="nav-logo-text">
          Kindoku
          <span className="nav-logo-sub">近 · 흑 · 読</span>
        </span>
      </a>
      <p className="nav-tagline">Manga · Manhwa · Manhua · Light Novels</p>
      <div className="install-wrapper">
        {canInstall && (
          <button className="install-btn" onClick={promptInstall}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M7 10l5 5 5-5" />
              <path d="M12 15V3" />
            </svg>
            <span>Install</span>
          </button>
        )}
        <div className={`install-tooltip${tooltipMessage ? ' visible' : ''}`}>
          {tooltipMessage}
        </div>
      </div>
    </nav>
  );
}
