/**
 * PosIcons — bold-solid custom icon set for the touch POS UI.
 *
 * Each icon is a filled, high-contrast glyph designed to be legible at
 * small sizes on a dark theme. Sourced from the approved "Bold Solid"
 * canvas mockup (icon-library/BoldSolid.tsx).
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      {children}
    </svg>
  );
}

export function CashIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M2 6C2 4.89543 2.89543 4 4 4H20C21.1046 4 22 4.89543 22 6V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18V6ZM7 12C7 10.3431 8.34315 9 10 9H14C15.6569 9 17 10.3431 17 12C17 13.6569 15.6569 15 14 15H10C8.34315 15 7 13.6569 7 12ZM4 6V8H6V6H4ZM18 6V8H20V6H18ZM18 16V18H20V16H18ZM4 16V18H6V16H4Z" />
    </Base>
  );
}

export function CardIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 5C2.44772 5 2 5.44772 2 6V18C2 18.5523 2.44772 19 3 19H21C21.5523 19 22 18.5523 22 18V6C22 5.44772 21.5523 5 21 5H3ZM3.5 7H20.5V9H3.5V7ZM3.5 13H10.5V15H3.5V13ZM12.5 13H15.5V15H12.5V13Z" />
    </Base>
  );
}

export function VoucherIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M2 6C2 4.89543 2.89543 4 4 4H20C21.1046 4 22 4.89543 22 6V8.5C21.1716 8.5 20.5 9.17157 20.5 10C20.5 10.8284 21.1716 11.5 22 11.5V12.5C21.1716 12.5 20.5 13.1716 20.5 14C20.5 14.8284 21.1716 15.5 22 15.5V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18V15.5C2.82843 15.5 3.5 14.8284 3.5 14C3.5 13.1716 2.82843 12.5 2 12.5V11.5C2.82843 11.5 3.5 10.8284 3.5 10C3.5 9.17157 2.82843 8.5 2 8.5V6ZM9 9H15V11H9V9ZM9 13H15V15H9V13Z" />
    </Base>
  );
}

export function LoyaltyIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 21.35L10.55 20.03C5.4 15.36 2 12.28 2 8.5C2 5.42 4.42 3 7.5 3C9.24 3 10.91 3.81 12 5.09C13.09 3.81 14.76 3 16.5 3C19.58 3 22 5.42 22 8.5C22 12.28 18.6 15.36 13.45 20.04L12 21.35Z" />
    </Base>
  );
}

export function DiscountIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M10.83 2L19 2C20.1046 2 21 2.89543 21 4V12.17C21 12.7 20.79 13.21 20.41 13.59L11.59 22.41C10.81 23.19 9.54 23.19 8.76 22.41L1.59 15.24C0.81 14.46 0.81 13.19 1.59 12.41L10.41 3.59C10.79 3.21 11.3 3 11.83 3L10.83 2ZM15.5 8C16.3284 8 17 7.32843 17 6.5C17 5.67157 16.3284 5 15.5 5C14.6716 5 14 5.67157 14 6.5C14 7.32843 14.6716 8 15.5 8Z" />
    </Base>
  );
}

export function HoldIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 4C4.89543 4 4 4.89543 4 6V18C4 19.1046 4.89543 20 6 20H18C19.1046 20 20 19.1046 20 18V6C20 4.89543 19.1046 4 18 4H6ZM8 8H10V16H8V8ZM14 8H16V16H14V8Z" />
    </Base>
  );
}

export function RecallIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12H20C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12C4 7.58172 7.58172 4 12 4C14.28 4 16.34 4.96 17.8 6.5L15 9H22V2L19.2 4.8C17.4 3.06 14.84 2 12 2ZM11 7V13.41L15.29 17.7L16.7 16.29L13 12.58V7H11Z" />
    </Base>
  );
}

export function VoidIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2ZM17.5 12C17.5 12.72 17.36 13.41 17.1 14.05L9.95 6.9C10.59 6.64 11.28 6.5 12 6.5C15.04 6.5 17.5 8.96 17.5 12ZM6.5 12C6.5 11.28 6.64 10.59 6.9 9.95L14.05 17.1C13.41 17.36 12.72 17.5 12 17.5C8.96 17.5 6.5 15.04 6.5 12Z" />
    </Base>
  );
}

export function RefundIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path
        d="M12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2ZM12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4ZM10 7L16 12L10 17V13H6V11H10V7Z"
        style={{ transformOrigin: "center", transform: "rotate(180deg)" }}
      />
    </Base>
  );
}

export function PrintIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M18 7H6V3H18V7ZM19 9H5C3.89543 9 3 9.89543 3 11V17H7V21H17V17H21V11C21 9.89543 20.1046 9 19 9ZM15 19H9V14H15V19ZM18 12C17.4477 12 17 11.5523 17 11C17 10.4477 17.4477 10 18 10C18.5523 10 19 10.4477 19 11C19 11.5523 18.5523 12 18 12Z" />
    </Base>
  );
}

export function SubtotalIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 6H20V8H4V6ZM4 11H20V13H4V11ZM4 16H20V18H4V16Z" />
    </Base>
  );
}

export function PayIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM10 17L5 12L6.41 10.59L10 14.17L17.59 6.58L19 8L10 17Z" />
    </Base>
  );
}
