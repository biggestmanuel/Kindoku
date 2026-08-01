import { useState } from 'react';
import Background from './components/Background';
import Nav from './components/Nav';
import Footer from './components/Footer';
import LandingView from './components/views/LandingView';
import PlaceholderView from './components/views/PlaceholderView';
import { useServiceWorker } from './hooks/useServiceWorker';
import type { ViewName } from './types';

export default function App() {
  useServiceWorker();

  const [view, setView] = useState<ViewName>('landing');
  const [previousView, setPreviousView] = useState<ViewName>('landing');

  function goTo(next: ViewName, from: ViewName = view) {
    setPreviousView(from);
    setView(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div id="app">
      <Background />
      <Nav onLogoClick={() => goTo('landing')} />

      {view === 'landing' && (
        <LandingView
          onGoSearch={() => goTo('search', 'landing')}
          onGoDiscover={() => goTo('discover', 'landing')}
        />
      )}

      {view === 'search' && (
        <PlaceholderView title="Search" onBack={() => goTo('landing')} />
      )}

      {view === 'discover' && (
        <PlaceholderView title="Discover" onBack={() => goTo('landing')} />
      )}

      {view === 'results' && (
        <PlaceholderView
          title="Results"
          onBack={() => goTo(previousView === 'search' ? 'search' : 'discover')}
        />
      )}

      <Footer />
    </div>
  );
}
