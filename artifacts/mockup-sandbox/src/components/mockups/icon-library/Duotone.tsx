import React from 'react';

type ActionIcon = {
  label: string;
  colorClass: string;
  bgClass: string;
  renderIcon: () => React.ReactNode;
};

const actions: ActionIcon[] = [
  {
    label: 'Cash',
    colorClass: 'text-[#16a34a]',
    bgClass: 'bg-[#16a34a]/10',
    renderIcon: () => (
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8">
        <rect x="2" y="6" width="28" height="20" rx="4" className="fill-current opacity-30" />
        <circle cx="16" cy="16" r="5" className="fill-current" />
        <rect x="6" y="10" width="4" height="4" rx="1" className="fill-current" />
        <rect x="22" y="10" width="4" height="4" rx="1" className="fill-current" />
      </svg>
    ),
  },
  {
    label: 'Card',
    colorClass: 'text-[#a8203c]',
    bgClass: 'bg-[#a8203c]/10',
    renderIcon: () => (
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8">
        <rect x="2" y="5" width="28" height="22" rx="4" className="fill-current opacity-30" />
        <rect x="2" y="10" width="28" height="6" className="fill-current" />
        <rect x="6" y="20" width="8" height="3" rx="1" className="fill-current" />
        <rect x="16" y="20" width="10" height="3" rx="1" className="fill-current opacity-50" />
      </svg>
    ),
  },
  {
    label: 'Voucher',
    colorClass: 'text-[#a8203c]',
    bgClass: 'bg-[#a8203c]/10',
    renderIcon: () => (
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8">
        <path d="M4 6C4 4.89543 4.89543 4 6 4H26C27.1046 4 28 4.89543 28 6V11.5C26.6193 11.5 25.5 12.6193 25.5 14C25.5 15.3807 26.6193 16.5 28 16.5V26C28 27.1046 27.1046 28 26 28H6C4.89543 28 4 27.1046 4 26V16.5C5.38071 16.5 6.5 15.3807 6.5 14C6.5 12.6193 5.38071 11.5 4 11.5V6Z" className="fill-current opacity-30" />
        <rect x="10" y="10" width="12" height="4" rx="2" className="fill-current" />
        <rect x="10" y="16" width="8" height="4" rx="2" className="fill-current" />
      </svg>
    ),
  },
  {
    label: 'Loyalty',
    colorClass: 'text-[#a8203c]',
    bgClass: 'bg-[#a8203c]/10',
    renderIcon: () => (
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8">
        <path d="M16 28L5.52786 21.018C2.56846 19.045 2 14.887 4.14589 12.181L4.85411 11.288C6.67104 9.00034 9.84594 8.35824 12.3963 9.76106V9.76106C14.6152 10.9815 17.3848 10.9815 19.6037 9.76106V9.76106C22.1541 8.35824 25.329 9.00034 27.1459 11.288L27.8541 12.181C29.9999 14.887 29.4315 19.045 26.4721 21.018L16 28Z" className="fill-current opacity-30" />
        <circle cx="16" cy="14" r="4" className="fill-current" />
      </svg>
    ),
  },
  {
    label: 'Discount',
    colorClass: 'text-[#fbbf24]',
    bgClass: 'bg-[#fbbf24]/10',
    renderIcon: () => (
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8">
        <path d="M15.4142 4H26C27.1046 4 28 4.89543 28 6V16.5858C28 17.1162 27.7893 17.6249 27.4142 18L18 27.4142C17.2189 28.1953 15.9526 28.1953 15.1716 27.4142L4.58579 16.8284C3.80474 16.0474 3.80474 14.7811 4.58579 14L14 4.58579C14.3751 4.21071 14.8838 4 15.4142 4Z" className="fill-current opacity-30" />
        <circle cx="21" cy="11" r="3" className="fill-current" />
        <rect x="9" y="16.5" width="14" height="3" rx="1.5" transform="rotate(-45 9 16.5)" className="fill-current" />
      </svg>
    ),
  },
  {
    label: 'Hold',
    colorClass: 'text-[#fbbf24]',
    bgClass: 'bg-[#fbbf24]/10',
    renderIcon: () => (
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8">
        <circle cx="16" cy="16" r="13" className="fill-current opacity-30" />
        <rect x="11" y="10" width="4" height="12" rx="2" className="fill-current" />
        <rect x="17" y="10" width="4" height="12" rx="2" className="fill-current" />
      </svg>
    ),
  },
  {
    label: 'Recall',
    colorClass: 'text-[#a8203c]',
    bgClass: 'bg-[#a8203c]/10',
    renderIcon: () => (
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8">
        <path d="M16 28C9.37258 28 4 22.6274 4 16C4 9.37258 9.37258 4 16 4C20.6722 4 24.7171 6.67137 26.6976 10.7H21V13.7H29.5V5H26.5V8.12599C24.129 3.88219 19.5397 1 16 1C7.71573 1 1 7.71573 1 16C1 24.2843 7.71573 31 16 31C22.6397 31 28.2713 26.6853 30.25 20.7L27.3912 19.7548C25.8037 24.5574 21.2858 28 16 28Z" className="fill-current opacity-30" />
        <path d="M15 8H18V15.5L22.5 19.5L20.5 22L15 17V8Z" className="fill-current" />
      </svg>
    ),
  },
  {
    label: 'Void',
    colorClass: 'text-[#f87171]',
    bgClass: 'bg-[#f87171]/10',
    renderIcon: () => (
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8">
        <circle cx="16" cy="16" r="13" className="fill-current opacity-30" />
        <path d="M10.3431 10.3431L21.6568 21.6568" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        <path d="M21.6569 10.3431L10.3432 21.6568" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: 'Refund',
    colorClass: 'text-[#fbbf24]',
    bgClass: 'bg-[#fbbf24]/10',
    renderIcon: () => (
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8">
        <rect x="4" y="6" width="24" height="20" rx="4" className="fill-current opacity-30" />
        <path d="M18 11L13 16L18 21" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 16H23" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: 'Print',
    colorClass: 'text-[#a8203c]',
    bgClass: 'bg-[#a8203c]/10',
    renderIcon: () => (
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8">
        <rect x="6" y="12" width="20" height="14" rx="3" className="fill-current opacity-30" />
        <rect x="10" y="4" width="12" height="12" rx="2" className="fill-current" />
        <rect x="10" y="20" width="12" height="8" rx="1" className="fill-current" />
      </svg>
    ),
  },
  {
    label: 'Subtotal',
    colorClass: 'text-[#a8203c]',
    bgClass: 'bg-[#a8203c]/10',
    renderIcon: () => (
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8">
        <rect x="4" y="4" width="24" height="24" rx="4" className="fill-current opacity-30" />
        <rect x="10" y="10" width="12" height="3" rx="1.5" className="fill-current" />
        <rect x="10" y="19" width="12" height="3" rx="1.5" className="fill-current" />
        <rect x="10" y="14.5" width="8" height="3" rx="1.5" className="fill-current" />
      </svg>
    ),
  },
  {
    label: 'Pay',
    colorClass: 'text-[#16a34a]',
    bgClass: 'bg-[#16a34a]/10',
    renderIcon: () => (
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8">
        <rect x="3" y="6" width="26" height="20" rx="10" className="fill-current opacity-30" />
        <path d="M12 16L15 19L20 13" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export default function Duotone() {
  return (
    <div className="min-h-screen bg-[#030712] p-8 font-sans text-white">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <header className="space-y-2 border-b border-gray-800 pb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Duotone</h1>
          <p className="text-gray-400 text-sm">
            Layered duotone icons: low opacity base fill + solid high-opacity detail layer inside a soft tinted chip.
          </p>
        </header>

        {/* Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
          {actions.map((action) => (
            <button
              key={action.label}
              className="flex flex-col items-center justify-center gap-4 p-6 rounded-2xl bg-[#111827] border border-gray-800 hover:border-gray-700 transition-colors group cursor-pointer"
            >
              <div
                className={`w-16 h-16 flex items-center justify-center rounded-[18px] transition-transform group-hover:scale-105 group-active:scale-95 ${action.bgClass} ${action.colorClass}`}
              >
                {action.renderIcon()}
              </div>
              <span className="text-sm font-medium text-gray-200 tracking-wide">
                {action.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Export named as well to match requirements
export { Duotone };
