import { useCallback, useState } from "react";

export type PosUiTheme = "light" | "dark";

const STORAGE_KEY = "pos_ui_theme";

export function usePosTheme(): { theme: PosUiTheme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<PosUiTheme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "dark" ? "dark" : "light";
  });

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
