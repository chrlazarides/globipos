import { useState, useEffect } from "react";

export function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

export interface LayoutColumnConfig {
  columns: number;    // 1024–1919 px (laptop / desktop)
  colsTablet: number; // 640–1023 px
  colsMobile: number; // < 640 px
  colsLarge: number;  // 1920–2559 px (large monitor)
  colsTV: number;     // 2560 px+ (4K / TV)
}

const DEFAULTS: LayoutColumnConfig = {
  columns: 4,
  colsTablet: 3,
  colsMobile: 2,
  colsLarge: 6,
  colsTV: 8,
};

export function useResponsiveColumns(config: LayoutColumnConfig | null): number {
  const width = useWindowWidth();
  const cfg = config ?? DEFAULTS;
  if (width < 640)  return cfg.colsMobile;
  if (width < 1024) return cfg.colsTablet;
  if (width < 1920) return cfg.columns;
  if (width < 2560) return cfg.colsLarge;
  return cfg.colsTV;
}
