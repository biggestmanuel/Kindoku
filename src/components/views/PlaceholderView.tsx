interface PlaceholderViewProps {
  title: string;
  onBack: () => void;
}

// Temporary stand-in for Search / Discover / Results while those views
// are converted from the original vanilla JS. Keeps the app runnable
// end-to-end during the incremental migration instead of leaving broken
// routes.
export default function PlaceholderView({ title, onBack }: PlaceholderViewProps) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        textAlign: 'center',
        padding: '24px',
      }}
    >
      <p className="section-label">Coming Up Next</p>
      <h2 className="section-title" style={{ marginBottom: '8px' }}>{title}</h2>
      <p style={{ color: 'var(--text-muted)', maxWidth: '380px' }}>
        This view hasn't been converted to React yet — it's next in line.
      </p>
      <button className="back-top-btn" style={{ position: 'static', marginTop: '12px' }} onClick={onBack}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Back
      </button>
    </div>
  );
}
