import React from "react";

const actions = [
  {
    name: "Cash",
    color: "green", // #16a34a
    ringColor: "ring-[#16a34a]/30",
    glowColor: "shadow-[0_0_15px_rgba(22,163,74,0.15)]",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="4" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    ),
  },
  {
    name: "Card",
    color: "burgundy", // #a8203c
    ringColor: "ring-[#a8203c]/30",
    glowColor: "shadow-[0_0_15px_rgba(168,32,60,0.15)]",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="4" />
        <path d="M2 10h20" />
        <path d="M6 15h4" />
      </svg>
    ),
  },
  {
    name: "Voucher",
    color: "burgundy", // #a8203c
    ringColor: "ring-[#a8203c]/30",
    glowColor: "shadow-[0_0_15px_rgba(168,32,60,0.15)]",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h16a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8a2 2 0 0 1 2-2Z" />
        <path d="M9 11l2 2 4-4" />
      </svg>
    ),
  },
  {
    name: "Loyalty",
    color: "burgundy",
    ringColor: "ring-[#a8203c]/30",
    glowColor: "shadow-[0_0_15px_rgba(168,32,60,0.15)]",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    ),
  },
  {
    name: "Discount",
    color: "amber", // #fbbf24
    ringColor: "ring-[#fbbf24]/30",
    glowColor: "shadow-[0_0_15px_rgba(251,191,36,0.15)]",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="9" r="2" />
        <circle cx="15" cy="15" r="2" />
        <path d="m5 19 14-14" />
      </svg>
    ),
  },
  {
    name: "Hold",
    color: "amber",
    ringColor: "ring-[#fbbf24]/30",
    glowColor: "shadow-[0_0_15px_rgba(251,191,36,0.15)]",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
  },
  {
    name: "Recall",
    color: "amber",
    ringColor: "ring-[#fbbf24]/30",
    glowColor: "shadow-[0_0_15px_rgba(251,191,36,0.15)]",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
      </svg>
    ),
  },
  {
    name: "Void",
    color: "red", // #f87171
    ringColor: "ring-[#f87171]/30",
    glowColor: "shadow-[0_0_15px_rgba(248,113,113,0.15)]",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="m15 9-6 6" />
        <path d="m9 9 6 6" />
      </svg>
    ),
  },
  {
    name: "Refund",
    color: "red",
    ringColor: "ring-[#f87171]/30",
    glowColor: "shadow-[0_0_15px_rgba(248,113,113,0.15)]",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    ),
  },
  {
    name: "Print",
    color: "burgundy",
    ringColor: "ring-[#a8203c]/30",
    glowColor: "shadow-[0_0_15px_rgba(168,32,60,0.15)]",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9V2h12v7" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <path d="M6 14h12v8H6z" />
      </svg>
    ),
  },
  {
    name: "Subtotal",
    color: "burgundy",
    ringColor: "ring-[#a8203c]/30",
    glowColor: "shadow-[0_0_15px_rgba(168,32,60,0.15)]",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M8 8h8" />
        <path d="M8 12h8" />
        <path d="M8 16h8" />
      </svg>
    ),
  },
  {
    name: "Pay",
    color: "green",
    ringColor: "ring-[#16a34a]/30",
    glowColor: "shadow-[0_0_15px_rgba(22,163,74,0.15)]",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <path d="M22 4L12 14.01l-3-3" />
      </svg>
    ),
  },
];

export function SoftOutline() {
  return (
    <div className="min-h-screen bg-[#030712] p-8 font-sans text-gray-100">
      <div className="max-w-4xl mx-auto space-y-8">
        
        <header className="mb-12">
          <h1 className="text-2xl font-semibold mb-2">SoftOutline Icons</h1>
          <p className="text-gray-400 text-sm">
            Hypothesis: Soft rounded outline icons with a consistent 2px stroke, fully rounded caps and joins, inside a circular chip with a faint colored ring and glow matching the semantic accent color. Refined and editorial.
          </p>
        </header>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6">
          {actions.map((action) => (
            <div 
              key={action.name} 
              className="flex flex-col items-center justify-center p-6 bg-[#111827] border border-gray-800 rounded-xl hover:bg-gray-800/80 transition-colors cursor-pointer group"
            >
              <div className={`flex items-center justify-center w-16 h-16 rounded-full ring-1 ${action.ringColor} ${action.glowColor} mb-4 bg-[#030712] group-hover:bg-[#111827] transition-all duration-300`}>
                <div className="text-gray-200">
                  {action.icon}
                </div>
              </div>
              <span className="text-sm font-medium tracking-wide">
                {action.name}
              </span>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}

export default SoftOutline;
