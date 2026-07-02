import { HTMLAttributes, ReactNode } from "react";

type Variant = "default" | "secondary" | "destructive" | "outline";

const variantCls: Record<Variant, string> = {
  default:     "bg-gray-900 text-white",
  secondary:   "bg-gray-100 text-gray-800",
  destructive: "bg-red-600 text-white",
  outline:     "border border-gray-300 text-gray-800 bg-transparent",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
  children?: ReactNode;
}

export function Badge({ variant = "default", className = "", children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${variantCls[variant]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}
