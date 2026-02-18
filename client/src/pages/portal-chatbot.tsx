import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Send, Bot, User, ShoppingCart, Package, ArrowRight } from "lucide-react";
import type { Customer, Item, Category } from "@shared/schema";

interface PortalChatbotProps {
  customer: Customer;
}

interface CartItem {
  item: Item;
  quantity: number;
}

interface ChatMessage {
  role: "bot" | "user";
  text: string;
  options?: { label: string; value: string }[];
  items?: Item[];
  cart?: CartItem[];
}

type BotState = "greeting" | "main_menu" | "browse_categories" | "browse_items" | "item_detail" | "cart_review" | "confirm_order" | "order_complete";

export default function PortalChatbot({ customer }: PortalChatbotProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [botState, setBotState] = useState<BotState>("greeting");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const { data: catalog } = useQuery<{ items: Item[]; categories: Category[] }>({
    queryKey: ["/api/portal/catalog"],
  });

  const allItems = catalog?.items || [];
  const categories = catalog?.categories || [];

  const getPrice = (item: Item) => {
    const key = `price${customer.priceLevel}` as keyof Item;
    return parseFloat(String(item[key] || item.price1));
  };

  const fmt = (v: number) => `€${v.toLocaleString("el-CY", { minimumFractionDigits: 2 })}`;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (catalog && messages.length === 0) {
      addBotMessage(
        `Hello ${customer.name}! I'm your ordering assistant. How can I help you today?`,
        [
          { label: "Browse by category", value: "browse" },
          { label: "Search for a product", value: "search" },
          { label: "View my cart", value: "cart" },
          { label: "Quick reorder", value: "reorder" },
        ]
      );
      setBotState("main_menu");
    }
  }, [catalog]);

  const addBotMessage = (text: string, options?: { label: string; value: string }[], items?: Item[], cartItems?: CartItem[]) => {
    setMessages((prev) => [...prev, { role: "bot", text, options, items, cart: cartItems }]);
  };

  const addUserMessage = (text: string) => {
    setMessages((prev) => [...prev, { role: "user", text }]);
  };

  const handleOption = (value: string) => {
    switch (botState) {
      case "main_menu":
        handleMainMenu(value);
        break;
      case "browse_categories":
        handleCategorySelect(value);
        break;
      case "browse_items":
        handleItemAction(value);
        break;
      case "item_detail":
        handleItemAction(value);
        break;
      case "cart_review":
        handleCartAction(value);
        break;
      case "confirm_order":
        handleConfirmOrder(value);
        break;
      case "order_complete":
        handleMainMenu(value);
        break;
      default:
        handleMainMenu(value);
    }
  };

  const handleMainMenu = (value: string) => {
    addUserMessage(value === "browse" ? "Browse by category" : value === "search" ? "Search for a product" : value === "cart" ? "View my cart" : "Quick reorder");

    if (value === "browse") {
      const catOptions = categories.map((c) => ({ label: c.name, value: c.id }));
      catOptions.push({ label: "Show all products", value: "all" });
      addBotMessage("Which category would you like to browse?", catOptions);
      setBotState("browse_categories");
    } else if (value === "search") {
      addBotMessage("What product are you looking for? Type the name or SKU below.");
      setBotState("browse_items");
    } else if (value === "cart") {
      showCart();
    } else if (value === "reorder") {
      addBotMessage("Here are all available products. Tap any to add to your cart.", undefined, allItems.slice(0, 12));
      setBotState("browse_items");
    }
  };

  const handleCategorySelect = (categoryId: string) => {
    const cat = categories.find((c) => c.id === categoryId);
    addUserMessage(categoryId === "all" ? "Show all products" : cat?.name || categoryId);
    setSelectedCategory(categoryId);

    const filtered = categoryId === "all" ? allItems : allItems.filter((i) => i.categoryId === categoryId);

    if (filtered.length === 0) {
      addBotMessage("No products found in this category. Want to try something else?", [
        { label: "Browse other categories", value: "browse" },
        { label: "Back to menu", value: "menu" },
      ]);
      setBotState("main_menu");
    } else {
      addBotMessage(`Found ${filtered.length} product${filtered.length > 1 ? "s" : ""}. Tap a product to add it to your cart.`, undefined, filtered);
      setBotState("browse_items");
    }
  };

  const handleItemAction = (value: string) => {
    if (value === "menu") {
      addUserMessage("Back to menu");
      addBotMessage("What would you like to do?", [
        { label: "Browse by category", value: "browse" },
        { label: "Search for a product", value: "search" },
        { label: "View my cart", value: "cart" },
      ]);
      setBotState("main_menu");
      return;
    }

    if (value.startsWith("add:")) {
      const itemId = value.replace("add:", "");
      const item = allItems.find((i) => i.id === itemId);
      if (item) {
        addUserMessage(`Add ${item.name}`);
        setCart((prev) => {
          const existing = prev.find((ci) => ci.item.id === item.id);
          if (existing) {
            return prev.map((ci) => ci.item.id === item.id ? { ...ci, quantity: ci.quantity + 1 } : ci);
          }
          return [...prev, { item, quantity: 1 }];
        });
        const currentQty = (cart.find((ci) => ci.item.id === item.id)?.quantity || 0) + 1;
        addBotMessage(
          `Added ${item.name} to cart (qty: ${currentQty}). What next?`,
          [
            { label: "Add more of this", value: `add:${item.id}` },
            { label: "Continue shopping", value: selectedCategory ? selectedCategory : "browse" },
            { label: "View cart & checkout", value: "cart" },
          ]
        );
        setBotState("browse_items");
      }
      return;
    }

    if (value === "cart") {
      addUserMessage("View my cart");
      showCart();
      return;
    }

    handleCategorySelect(value);
  };

  const showCart = () => {
    if (cart.length === 0) {
      addBotMessage("Your cart is empty. Let's find some products!", [
        { label: "Browse by category", value: "browse" },
        { label: "Search for a product", value: "search" },
      ]);
      setBotState("main_menu");
    } else {
      const subtotal = cart.reduce((s, ci) => s + getPrice(ci.item) * ci.quantity, 0);
      const vat = subtotal * 0.19;
      const total = subtotal + vat;

      let cartSummary = "Here's your cart:\n\n";
      cart.forEach((ci) => {
        cartSummary += `${ci.quantity}x ${ci.item.name} - ${fmt(getPrice(ci.item) * ci.quantity)}\n`;
      });
      cartSummary += `\nSubtotal: ${fmt(subtotal)}\nVAT (19%): ${fmt(vat)}\nTotal: ${fmt(total)}`;

      addBotMessage(cartSummary, [
        { label: "Place order", value: "place_order" },
        { label: "Continue shopping", value: "browse" },
        { label: "Clear cart", value: "clear" },
      ], undefined, [...cart]);
      setBotState("cart_review");
    }
  };

  const handleCartAction = (value: string) => {
    if (value === "place_order") {
      addUserMessage("Place order");
      addBotMessage("Ready to submit your order?", [
        { label: "Yes, place my order", value: "confirm" },
        { label: "No, keep shopping", value: "browse" },
      ]);
      setBotState("confirm_order");
    } else if (value === "clear") {
      addUserMessage("Clear cart");
      setCart([]);
      addBotMessage("Cart cleared. What would you like to do?", [
        { label: "Browse by category", value: "browse" },
        { label: "Search for a product", value: "search" },
      ]);
      setBotState("main_menu");
    } else {
      addUserMessage("Continue shopping");
      addBotMessage("What would you like to do?", [
        { label: "Browse by category", value: "browse" },
        { label: "Search for a product", value: "search" },
      ]);
      setBotState("main_menu");
    }
  };

  const handleConfirmOrder = async (value: string) => {
    if (value === "confirm") {
      addUserMessage("Yes, place my order");
      setSubmitting(true);
      try {
        await apiRequest("POST", "/api/portal/orders", {
          customerId: customer.id,
          items: cart.map((ci) => ({ itemId: ci.item.id, quantity: ci.quantity })),
          notes: "Ordered via chatbot assistant",
        });
        setCart([]);
        queryClient.invalidateQueries({ queryKey: ["/api/portal/customer", customer.id, "orders"] });
        queryClient.invalidateQueries({ queryKey: ["/api/portal/catalog"] });
        addBotMessage("Your order has been placed successfully! We'll process it shortly.", [
          { label: "Place another order", value: "browse" },
          { label: "Back to menu", value: "menu" },
        ]);
        setBotState("order_complete");
        toast({ title: "Order placed", description: "Your order has been submitted." });
      } catch (err: any) {
        addBotMessage(`Order failed: ${err.message}. Please try again or contact support.`, [
          { label: "Try again", value: "place_order" },
          { label: "Back to menu", value: "menu" },
        ]);
        setBotState("cart_review");
      } finally {
        setSubmitting(false);
      }
    } else {
      addUserMessage("No, keep shopping");
      addBotMessage("No problem! What would you like to do?", [
        { label: "Browse by category", value: "browse" },
        { label: "View cart", value: "cart" },
      ]);
      setBotState("main_menu");
    }
  };

  const handleSend = () => {
    if (!input.trim()) return;
    const query = input.trim();
    setInput("");
    addUserMessage(query);

    const results = allItems.filter(
      (i) => i.name.toLowerCase().includes(query.toLowerCase()) || i.sku?.toLowerCase().includes(query.toLowerCase())
    );

    if (results.length === 0) {
      addBotMessage(`No products found matching "${query}". Try different search terms or browse by category.`, [
        { label: "Browse by category", value: "browse" },
        { label: "Back to menu", value: "menu" },
      ]);
      setBotState("main_menu");
    } else {
      addBotMessage(`Found ${results.length} product${results.length > 1 ? "s" : ""} matching "${query}". Tap to add to cart.`, undefined, results);
      setBotState("browse_items");
    }
  };

  if (!catalog) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-portal-chatbot-title">Order Assistant</h1>
        <p className="text-sm text-muted-foreground mt-1">I'll help you find and order products</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="h-[500px] flex flex-col">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg, i) => (
                <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "bot" && (
                    <div className="flex items-start justify-center w-8 h-8 rounded-md bg-primary/10 shrink-0 mt-0.5">
                      <Bot className="w-4 h-4 text-primary mt-2" />
                    </div>
                  )}
                  <div className={`max-w-[80%] space-y-2 ${msg.role === "user" ? "items-end" : ""}`}>
                    <div
                      className={`rounded-md px-3 py-2 text-sm whitespace-pre-line ${
                        msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                      }`}
                      data-testid={`chat-message-${i}`}
                    >
                      {msg.text}
                    </div>

                    {msg.items && msg.items.length > 0 && (
                      <div className="space-y-1">
                        {msg.items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between gap-2 p-2 rounded-md bg-card border text-sm"
                            data-testid={`chatbot-item-${item.id}`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="font-medium truncate">{item.name}</p>
                              <p className="text-xs text-muted-foreground">{item.sku} | {fmt(getPrice(item))}</p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOption(`add:${item.id}`)}
                              data-testid={`chatbot-add-${item.id}`}
                            >
                              <Plus className="w-3 h-3 mr-1" /> Add
                            </Button>
                          </div>
                        ))}
                        <div className="flex gap-1 flex-wrap mt-1">
                          <Button size="sm" variant="ghost" onClick={() => handleOption("cart")} data-testid="chatbot-view-cart">
                            <ShoppingCart className="w-3 h-3 mr-1" /> Cart ({cart.length})
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleOption("menu")} data-testid="chatbot-back-menu">
                            Back to menu
                          </Button>
                        </div>
                      </div>
                    )}

                    {msg.options && (
                      <div className="flex flex-wrap gap-1">
                        {msg.options.map((opt) => (
                          <Button
                            key={opt.value}
                            size="sm"
                            variant="outline"
                            onClick={() => handleOption(opt.value)}
                            disabled={submitting}
                            data-testid={`chatbot-option-${opt.value}`}
                          >
                            {opt.label}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                  {msg.role === "user" && (
                    <div className="flex items-start justify-center w-8 h-8 rounded-md bg-muted shrink-0 mt-0.5">
                      <User className="w-4 h-4 mt-2" />
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {cart.length > 0 && (
              <div className="px-4 py-2 border-t bg-muted/50 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm">
                  <ShoppingCart className="w-4 h-4" />
                  <span>{cart.length} item{cart.length > 1 ? "s" : ""} in cart</span>
                  <Badge variant="secondary">{fmt(cart.reduce((s, ci) => s + getPrice(ci.item) * ci.quantity, 0))}</Badge>
                </div>
                <Button size="sm" variant="outline" onClick={() => { addUserMessage("View cart"); showCart(); }} data-testid="chatbot-cart-bar">
                  Checkout <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            )}

            <div className="p-3 border-t flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Search for a product..."
                data-testid="input-chatbot-search"
              />
              <Button size="icon" onClick={handleSend} data-testid="button-chatbot-send">
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Plus({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
