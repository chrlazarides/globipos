import { useState } from "react";
import type { ComponentType } from "react";
import {
  AppleIcon, BeefIcon, CarrotIcon, CherryIcon, CroissantIcon, EggIcon, FishIcon,
  Loader2Icon, MilkIcon, ShoppingBasketIcon, ShoppingBagIcon, SnowflakeIcon, WheatIcon, BananaIcon,
} from "lucide-react";
import type { Product } from "../types";
import { formatCurrency } from "../lib/pricing";

type IconType = ComponentType<{ className?: string }>;

function iconFor(name: string): IconType {
  const n = name.toLowerCase();
  if (/\bice\b/.test(n)) return SnowflakeIcon;
  if (/\bbags?\b/.test(n)) return ShoppingBagIcon;
  if (/(milk|dairy|cheese|yogh?urt|cream)/.test(n)) return MilkIcon;
  if (/(beef|meat|chicken|pork|lamb|sausage)/.test(n)) return BeefIcon;
  if (/(fish|tuna|salmon|seafood)/.test(n)) return FishIcon;
  if (/(bread|bakery|croissant|pie)/.test(n)) return CroissantIcon;
  if (/(egg)/.test(n)) return EggIcon;
  if (/(banana)/.test(n)) return BananaIcon;
  if (/(cherr|berry|grape)/.test(n)) return CherryIcon;
  if (/(flour|rice|wheat|pasta|cereal)/.test(n)) return WheatIcon;
  if (/(carrot|potato|onion|tomato|cucumber|pepper|veg|salad)/.test(n)) return CarrotIcon;
  if (/(apple|orange|lemon|fruit|melon|pear)/.test(n)) return AppleIcon;
  return ShoppingBasketIcon;
}

export function productUnitLabel(p: Product): string {
  const u = (p.unit_type || "").toLowerCase();
  if (u === "kg" || u.includes("kilo") || u === "weight") return "/kg";
  if (u === "g" || u === "gram" || u === "grams") return "/g";
  return "";
}

interface Props {
  product: Product;
  price: number;
  light: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  imageBaseUrl?: string;
}

export function GroceryProductTile({ product, price, light, busy, disabled, onClick, imageBaseUrl }: Props) {
  let imageUrl: string | undefined;
  if (product.image_url?.startsWith("data:image/")) imageUrl = product.image_url;
  else if (product.image_url) {
    try {
      const url = new URL(product.image_url, imageBaseUrl ? `${imageBaseUrl.replace(/\/$/, "")}/` : undefined);
      if (url.protocol === "https:" || url.protocol === "http:") imageUrl = url.href;
    } catch { /* An unusable photo retains the product's category icon. */ }
  }
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const imgFailed = !!imageUrl && failedImage === imageUrl;
  const Icon = iconFor(`${product.name} ${product.description ?? ""}`);
  const plu = product.sku || product.barcode || product.server_id;
  const unit = productUnitLabel(product);
  const surface = light
    ? "bg-white border-gray-200 text-gray-900 hover:border-green-600"
    : "bg-gray-800 border-gray-700 text-white hover:border-green-500";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy}
      data-testid={`grocery-product-${product.server_id}`}
      className={`relative min-h-0 overflow-hidden rounded-xl border flex flex-col text-left transition-all active:scale-95 disabled:opacity-60 ${surface} ${busy ? "ring-2 ring-green-500" : ""}`}
    >
      <span className={`absolute top-1 right-1 z-10 max-w-[70%] truncate rounded-full px-1.5 py-0.5 text-[10px] font-mono font-semibold ${light ? "bg-gray-100 text-gray-600" : "bg-gray-900/80 text-gray-300"}`}>
        {plu}
      </span>
      <div className={`flex-1 min-h-0 flex items-center justify-center ${light ? "bg-green-50" : "bg-gray-900/40"}`}>
        {imageUrl && !imgFailed ? (
          <img src={imageUrl} alt={product.name} loading="lazy" onError={() => setFailedImage(imageUrl!)} className="h-full w-full object-contain p-1" />
        ) : (
          <Icon className={`h-1/2 w-1/2 max-h-14 max-w-14 ${light ? "text-green-700" : "text-green-400"}`} />
        )}
      </div>
      <div className="px-2 py-1">
        <div className="text-xs font-bold leading-tight line-clamp-2">{product.name}</div>
        <div className="mt-0.5 flex items-baseline gap-1">
          <span className={`text-sm font-bold ${light ? "text-green-700" : "text-green-400"}`}>{formatCurrency(price)}</span>
          {unit && <span className={`text-[10px] font-medium ${light ? "text-gray-500" : "text-gray-400"}`}>{unit}</span>}
          {product.timed_price != null && <span className="ml-auto text-[10px] text-amber-500 font-semibold">OFFER</span>}
        </div>
      </div>
      {busy && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <Loader2Icon className="h-8 w-8 animate-spin text-white" />
        </div>
      )}
    </button>
  );
}
