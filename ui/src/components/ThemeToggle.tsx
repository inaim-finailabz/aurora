import { useEffect, useState } from "react";

const THEME_KEY = "aurora_theme";

export default function ThemeToggle({ defaultTheme = "dark" }: { defaultTheme?: "dark" | "light" | "system" }) {
  const [theme, setTheme] = useState<string>(defaultTheme);

  useEffect(() => {
    // initialize theme from localStorage or default
    const stored = localStorage.getItem(THEME_KEY) as string | null;
    const initial = stored || defaultTheme;
    applyTheme(initial);
    setTheme(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // if system theme is selected, listen for changes
    let mql: MediaQueryList | null = null;
    const handleChange = (ev: MediaQueryListEvent) => {
      if (theme === "system") {
        applyTheme("system");
      }
    };
    if (window.matchMedia) {
      mql = window.matchMedia("(prefers-color-scheme: dark)");
      try {
        mql.addEventListener("change", handleChange as any);
      } catch {
        mql.addListener(handleChange as any);
      }
    }
    return () => {
      if (!mql) return;
      try {
        mql.removeEventListener("change", handleChange as any);
      } catch {
        mql.removeListener(handleChange as any);
      }
    };
  }, [theme]);

  function applyTheme(next: string) {
    const root = document.documentElement;
    root.classList.remove("theme-light", "theme-dark");
    if (next === "system") {
      const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.classList.add(prefersDark ? "theme-dark" : "theme-light");
    } else if (next === "dark") {
      root.classList.add("theme-dark");
    } else {
      root.classList.add("theme-light");
    }
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
  }

  function cycle() {
    const next = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
    setTheme(next);
    applyTheme(next);
  }

  const systemLabel = () => {
    if (theme !== "system") return null;
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    return prefersDark ? "System: Dark" : "System: Light";
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button
        className="icon-btn theme-toggle"
        onClick={cycle}
        title={`Theme: ${theme} (click to cycle: dark → light → system)`}
        aria-label={`Theme: ${theme}`}
      >
        {theme === "dark" ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : theme === "light" ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
            <path d="M12 3v2M12 19v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
            <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8 20h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      {theme === "system" && <span className="theme-label">{systemLabel()}</span>}
    </div>
  );
}
