import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Search, ShoppingCart, Plus, Minus, X, Package } from "lucide-react";
import type { Customer, Item, Category } from "@shared/schema";

interface PortalShopProps {
  customer: Customer;
}

interface CartItem {
  item: Item;
  quantity: number;
}

export default function PortalShop({ customer }: PortalShopProps) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const { data: catalog, isLoading } = useQuery<{ items: Item[]; categories: Category[] }>({
    queryKey: ["/api/portal/catalog"],
  });

  const items = catalog?.items || [];
  const categories = catalog?.categories || [];

  const filtered = items.filter((item) => {
    const matchesSearch = !search || item.name.toLowerCase().includes(search.toLowerCase()) || item.sku?.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !categoryFilter || item.categoryId === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const getPrice = (item: Item) => {
    const key = `price${customer.priceLevel}` as keyof Item;
    return parseFloat(String(item[key] || item.price1));
  };

  const fmt = (v: number) => `€${v.toLocaleString("el-CY", { minimumFractionDigits: 2 })}`;

  const addToCart = (item: Item) => {
    setCart((prev) => {
      const existing = prev.find((ci) => ci.item.id === item.id);
      if (existing) {
        return prev.map((ci) => ci.item.id === item.id ? { ...ci, quantity: ci.quantity + 1 } : ci);
      }
      return [...prev, { item, quantity: 1 }];
    });
  };

  const updateQuantity = (itemId: string, delta: number) => {
    setCart((prev) =>
      prev.map((ci) => ci.item.id === itemId ? { ...ci, quantity: Math.max(0, ci.quantity + delta) } : ci).filter((ci) => ci.quantity > 0)
    );
  };

  const removeFromCart = (itemId: string) => {
    setCart((prev) => prev.filter((ci) => ci.item.id !== itemId));
  };

  const cartTotal = cart.reduce((sum, ci) => sum + getPrice(ci.item) * ci.quantity, 0);
  const vatAmount = cartTotal * 0.19;
  const grandTotal = cartTotal + vatAmount;

  const handleSubmit = async () => {
    if (cart.length === 0) return;
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/portal/orders", {
        customerId: customer.id,
        items: cart.map((ci) => ({ itemId: ci.item.id, quantity: ci.quantity })),
        notes,
      });
      toast({ title: "Order placed", description: "Your order has been submitted successfully." });
      setCart([]);
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["/api/portal/customer", customer.id, "orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/catalog"] });
    } catch (err: any) {
      toast({ title: "Order failed", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const getCartQuantity = (itemId: string) => cart.find((ci) => ci.item.id === itemId)?.quantity || 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-portal-shop-title">Shop</h1>
        <p className="text-sm text-muted-foreground mt-1">Browse our catalog and place your order</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 space-y-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search products..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-portal-search"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            <Button
              variant={categoryFilter === "" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setCategoryFilter("")}
              data-testid="button-filter-all"
            >
              All
            </Button>
            {categories.map((cat) => (
              <Button
                key={cat.id}
                variant={categoryFilter === cat.id ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setCategoryFilter(cat.id)}
                data-testid={`button-filter-${cat.id}`}
              >
                {cat.name}
              </Button>
            ))}
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Package className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm">No products found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filtered.map((item) => {
                const qty = getCartQuantity(item.id);
                return (
                  <Card key={item.id} data-testid={`card-product-${item.id}`}>
                    <CardContent className="p-4">
                      <div className="flex justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate" data-testid={`text-product-name-${item.id}`}>{item.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{item.sku} | {item.packSize}</p>
                          {item.vintage && <p className="text-xs text-muted-foreground">Vintage: {item.vintage}</p>}
                          <p className="text-sm font-semibold mt-1" data-testid={`text-product-price-${item.id}`}>{fmt(getPrice(item))}</p>
                          <p className="text-xs text-muted-foreground">Stock: {item.stockQuantity}</p>
                        </div>
                        <div className="flex flex-col items-end justify-between">
                          {qty > 0 ? (
                            <div className="flex items-center gap-1">
                              <Button size="icon" variant="outline" onClick={() => updateQuantity(item.id, -1)} data-testid={`button-decrease-${item.id}`}>
                                <Minus className="w-3 h-3" />
                              </Button>
                              <span className="w-8 text-center text-sm font-medium" data-testid={`text-qty-${item.id}`}>{qty}</span>
                              <Button size="icon" variant="outline" onClick={() => updateQuantity(item.id, 1)} data-testid={`button-increase-${item.id}`}>
                                <Plus className="w-3 h-3" />
                              </Button>
                            </div>
                          ) : (
                            <Button size="sm" onClick={() => addToCart(item)} data-testid={`button-add-${item.id}`}>
                              <Plus className="w-3 h-3 mr-1" /> Add
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        <div className="w-full lg:w-80 lg:sticky lg:top-16 space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-4 h-4" />
                <h3 className="font-semibold text-sm">Cart ({cart.length} items)</h3>
              </div>

              {cart.length === 0 ? (
                <p className="text-sm text-muted-foreground">Your cart is empty</p>
              ) : (
                <>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {cart.map((ci) => (
                      <div key={ci.item.id} className="flex items-center justify-between gap-2 text-sm">
                        <div className="flex-1 min-w-0">
                          <p className="truncate font-medium">{ci.item.name}</p>
                          <p className="text-xs text-muted-foreground">{ci.quantity} x {fmt(getPrice(ci.item))}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="font-medium">{fmt(getPrice(ci.item) * ci.quantity)}</span>
                          <Button size="icon" variant="ghost" onClick={() => removeFromCart(ci.item.id)} data-testid={`button-remove-${ci.item.id}`}>
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="border-t pt-2 space-y-1 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>{fmt(cartTotal)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">VAT (19%)</span>
                      <span>{fmt(vatAmount)}</span>
                    </div>
                    <div className="flex justify-between gap-2 font-semibold">
                      <span>Total</span>
                      <span data-testid="text-cart-total">{fmt(grandTotal)}</span>
                    </div>
                  </div>

                  <Input
                    placeholder="Order notes (optional)"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    data-testid="input-order-notes"
                  />

                  <Button
                    className="w-full"
                    disabled={submitting || cart.length === 0}
                    onClick={handleSubmit}
                    data-testid="button-place-order"
                  >
                    {submitting ? "Placing Order..." : "Place Order"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
