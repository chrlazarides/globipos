import { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "default" | "outline" | "destructive" | "ghost" | "secondary";
type Size = "default" | "sm" | "lg" | "icon";

const variantCls: Record<Variant, string> = {
  default:     "bg-gray-900 text-white hover:bg-gray-800",
  outline:     "border border-gray-300 bg-white text-gray-900 hover:bg-gray-50",
  destructive: "bg-red-600 text-white hover:bg-red-700",
  ghost:       "bg-transparent text-gray-900 hover:bg-gray-100",
  secondary:   "bg-gray-100 text-gray-900 hover:bg-gray-200",
};

const sizeCls: Record<Size, string> = {
  default: "px-4 py-2 text-sm",
  sm:      "px-3 py-1.5 text-sm",
  lg:      "px-6 py-3 text-base",
  icon:    "p-2",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children?: ReactNode;
}

export function Button({ variant = "default", size = "default", className = "", children, ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none ${variantCls[variant]} ${sizeCls[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
