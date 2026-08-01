import { useEffect, useRef, useState } from 'react';

// Minimal typing for the non-standard BeforeInstallPromptEvent — not in
// the DOM lib, browsers that support it (Chrome/Edge/Android) attach
// these extra members to the event.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function detectPlatform() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
  const isAndroid = /Android/.test(ua);
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
  return { isIOS, isAndroid, isSafari };
}

export function useInstallPrompt() {
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [tooltipMessage, setTooltipMessage] = useState<string | null>(null);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;

    if (isStandalone) {
      setCanInstall(false);
      return;
    }
    setCanInstall(true);

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
    };

    const handleInstalled = () => {
      setCanInstall(false);
      deferredPromptRef.current = null;
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (!tooltipMessage) return;
    const timer = setTimeout(() => setTooltipMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [tooltipMessage]);

  async function promptInstall() {
    if (deferredPromptRef.current) {
      const prompt = deferredPromptRef.current;
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === 'accepted') setCanInstall(false);
      deferredPromptRef.current = null;
      return;
    }

    const { isIOS, isAndroid, isSafari } = detectPlatform();
    if (isIOS) {
      setTooltipMessage('Tap the Share icon (⬆) below, then "Add to Home Screen"');
    } else if (isAndroid) {
      setTooltipMessage('Tap the ⋮ menu (top right), then "Install app" or "Add to Home screen"');
    } else if (isSafari) {
      setTooltipMessage('Open File menu → "Add to Dock" (or use Chrome for one-tap install)');
    } else {
      setTooltipMessage('Look for an install icon in your address bar, or check your browser menu');
    }
  }

  return { canInstall, tooltipMessage, promptInstall };
}
