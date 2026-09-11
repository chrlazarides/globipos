interface BrandLogoProps {
  compact?: boolean;
}

export function BrandLogo({ compact = false }: BrandLogoProps) {
  return (
    <div className="inline-flex items-center justify-center gap-2" aria-label="GlobiPOS">
      <img
        src="/terminal/icons/globipos-terminal-192.png"
        alt=""
        className={compact ? "h-8 w-8 rounded-lg" : "h-12 w-12 rounded-xl"}
      />
      <span className={compact ? "text-xl font-bold tracking-tight" : "text-3xl font-bold tracking-tight"}>
        <span className="text-sky-400">globi</span>
        <span className="text-orange-500">pos</span>
      </span>
    </div>
  );
}