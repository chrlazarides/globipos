/**
 * Minimal shadcn-compatible Select backed by a native <select> element.
 * The Select root pre-collects items from SelectContent > SelectItem children
 * and renders an invisible native <select> overlay in SelectTrigger.
 */
import { ReactNode, createContext, useContext, Children, isValidElement } from "react";

interface CtxType {
  value?: string;
  onValueChange?: (v: string) => void;
  items: Array<{ value: string; label: string }>;
}

const Ctx = createContext<CtxType>({ items: [] });

function collectItems(children: ReactNode): Array<{ value: string; label: string }> {
  const items: Array<{ value: string; label: string }> = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const p = child.props as { value?: string; children?: ReactNode };
    if (p.value !== undefined) {
      items.push({ value: String(p.value), label: String(p.children ?? p.value) });
    }
  });
  return items;
}

export function Select({ value, onValueChange, children }: { value?: string; onValueChange?: (v: string) => void; children: ReactNode }) {
  const items: Array<{ value: string; label: string }> = [];
  Children.forEach(children, (level1) => {
    if (!isValidElement(level1)) return;
    Children.forEach((level1.props as { children?: ReactNode }).children, (level2) => {
      if (!isValidElement(level2)) return;
      const collected = collectItems((level2.props as { children?: ReactNode }).children ?? level2);
      items.push(...collected);
    });
    const direct = collectItems((level1.props as { children?: ReactNode }).children);
    items.push(...direct);
  });
  const unique = Array.from(new Map(items.map((i) => [i.value, i])).values());

  return (
    <Ctx.Provider value={{ value, onValueChange, items: unique }}>
      <div className="relative">{children}</div>
    </Ctx.Provider>
  );
}

export function SelectTrigger({ children, className = "", ...props }: { children?: ReactNode; className?: string; [k: string]: unknown }) {
  const { value, onValueChange, items } = useContext(Ctx);
  return (
    <div
      className={`relative flex h-10 items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ${className}`}
      {...props}
    >
      {children}
      <svg className="h-4 w-4 opacity-50 ml-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
      <select
        value={value ?? ""}
        onChange={(e) => onValueChange?.(e.target.value)}
        className="absolute inset-0 opacity-0 w-full cursor-pointer"
        aria-label="Select option"
      >
        {items.map((i) => (
          <option key={i.value} value={i.value}>{i.label}</option>
        ))}
      </select>
    </div>
  );
}

export function SelectValue({ placeholder }: { placeholder?: string }) {
  const { value } = useContext(Ctx);
  return <span className="truncate">{value || placeholder || ""}</span>;
}

export function SelectContent({ children }: { children: ReactNode }) {
  return null;
}

export function SelectItem({ value, children }: { value: string; children: ReactNode }) {
  return null;
}
