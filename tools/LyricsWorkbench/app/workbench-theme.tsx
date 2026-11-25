import { useId, useLayoutEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

const storageKey = 'tinytune.workbench.theme';
const themes = {
  system: { label: '跟随系统', icon: Monitor, next: 'light' },
  light: { label: '浅色主题', icon: Sun, next: 'dark' },
  dark: { label: '深色主题', icon: Moon, next: 'system' },
} as const;
type Theme = keyof typeof themes;

function initialTheme(): Theme {
  if (typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch { /* Storage may be disabled; the switch still works on this page. */ }
  }
  return 'system';
}

export function WorkbenchThemeToggle() {
  const [theme, setTheme] = useState(initialTheme);
  const [dismissed, setDismissed] = useState(false);
  const tooltipId = useId();
  const { label, icon: ThemeIcon, next } = themes[theme];

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (theme !== 'system') {
      root.dataset.wbTheme = theme;
      return;
    }
    const preference = window.matchMedia('(prefers-color-scheme: dark)');
    const syncSystemTheme = () => { root.dataset.wbTheme = preference.matches ? 'dark' : 'light'; };
    syncSystemTheme();
    preference.addEventListener('change', syncSystemTheme);
    return () => preference.removeEventListener('change', syncSystemTheme);
  }, [theme]);

  function cycleTheme() {
    setTheme(next);
    setDismissed(false);
    try { window.localStorage.setItem(storageKey, next); }
    catch { /* Keep the selected theme for the current page. */ }
  }

  return <div className="wb-theme" onPointerEnter={() => setDismissed(false)}>
    <button type="button" className="wb-theme-button" aria-label="切换主题" aria-describedby={tooltipId}
      onClick={cycleTheme} onFocus={() => setDismissed(false)}
      onKeyDown={event => { if (event.key === 'Escape') setDismissed(true); }}>
      <ThemeIcon size={18} aria-hidden="true" />
    </button>
    <span className="wb-theme-tooltip" id={tooltipId} role="tooltip" hidden={dismissed}><span>{label}</span></span>
  </div>;
}
