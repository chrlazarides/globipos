import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Plus, SlidersHorizontal } from "lucide-react";
import { apiFetch, queryClient } from "../lib/queryClient";
import { type BasketItem } from "./Basket";

interface DiscoverProps {
  basket: BasketItem[];
  setBasket: React.Dispatch<React.SetStateAction<BasketItem[]>>;
}

interface RecommendationItem {
  id: string; name: string; sku: string; brand?: string | null; volume?: string | null;
  customerPrice: number; stockQuantity: number; unitType: string; packSize: number;
  recommendationReason?: string; recommendationScore?: number;
}
interface Preferences {
  dietaryPreferences?: string[]; dislikedIngredients?: string[]; preferredCategories?: string[];
  recommendationGoals?: string[]; budgetPreference?: string | null;
  notificationRecommendations?: boolean; notificationOrderUpdates?: boolean; notificationOffers?: boolean;
}

const dietary = ["Vegetarian", "Vegan", "Gluten-free", "Dairy-free"];
const goals = ["Healthy choices", "Save time", "Value for money", "Discover new products"];
type RecommendationContext = "general" | "basket" | "budget" | "favorites" | "new" | "restock";
interface CatalogCategory { id: string; name: string; }
interface CatalogResponse { categories?: CatalogCategory[]; }

function Chips({ options, value, onChange, label }: { options: string[]; value: string[]; onChange: (v: string[]) => void; label: string }) {
  return <fieldset><legend className="text-xs font-medium mb-2">{label}</legend><div className="flex flex-wrap gap-1.5">
    {options.map(option => { const selected = value.includes(option); return <button type="button" key={option} aria-pressed={selected} onClick={() => onChange(selected ? value.filter(v => v !== option) : [...value, option])}
      className={`px-2.5 py-1.5 rounded-full border text-xs transition-colors ${selected ? "text-white border-transparent" : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"}`}
      style={selected ? { background: "hsl(var(--primary))" } : {}}>{option}</button>; })}
  </div></fieldset>;
}

export default function Discover({ basket, setBasket }: DiscoverProps) {
  const [context, setContext] = useState<RecommendationContext>("general");
  const [prompt, setPrompt] = useState("");
  const [showPreferences, setShowPreferences] = useState(false);
  const [saving, setSaving] = useState(false);
  const { data: result, isLoading } = useQuery<{ items: RecommendationItem[]; profileComplete: boolean }>({
    queryKey: [`/api/customer/recommendations?context=${encodeURIComponent(context)}&limit=12`],
  });
  const { data: preferenceData } = useQuery<Preferences>({ queryKey: ["/api/customer/preferences"] });
  const { data: catalog } = useQuery<CatalogResponse>({ queryKey: ["/api/customer/catalog?limit=1"] });
  const [draft, setDraft] = useState<Preferences | null>(null);
  const prefs = draft || preferenceData || {};
  const items = useMemo(() => (result?.items || []).filter(item => {
    const q = prompt.toLowerCase().trim();
    return !q || [item.name, item.brand, item.recommendationReason].filter(Boolean).join(" ").toLowerCase().includes(q);
  }).sort((a, b) => prompt ? (b.recommendationScore || 0) - (a.recommendationScore || 0) : 0), [result?.items, prompt]);
  const add = (item: RecommendationItem) => setBasket(prev => {
    const existing = prev.find(b => b.item.id === item.id && !b.barcode);
    return existing ? prev.map(b => b === existing ? { ...b, quantity: b.quantity + 1 } : b) : [...prev, { item, quantity: 1 }];
  });
  const save = async () => {
    setSaving(true);
    try {
      await apiFetch("/api/customer/preferences", { method: "PUT", body: JSON.stringify(prefs) });
      queryClient.invalidateQueries({ queryKey: ["/api/customer/preferences"] });
      queryClient.invalidateQueries({
        predicate: query => String(query.queryKey[0] || "").startsWith("/api/customer/recommendations?"),
      });
      setDraft(null); setShowPreferences(false);
    } catch (error: any) { alert(error.message || "Could not save preferences"); } finally { setSaving(false); }
  };
  const choosePrompt = (next: string, nextContext: RecommendationContext) => {
    setPrompt(next); setContext(nextContext);
    if (nextContext === "budget") setDraft({ ...prefs, budgetPreference: "value" });
  };

  return <div className="space-y-4">
    <div className="flex gap-3 justify-between">
      <div><h1 className="text-xl font-semibold flex items-center gap-2"><Sparkles className="w-5 h-5 text-[hsl(var(--primary))]" />For You</h1>
        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">Provider-independent suggestions based on your saved preferences and purchases.</p></div>
      <button onClick={() => { setDraft(preferenceData || {}); setShowPreferences(!showPreferences); }} aria-expanded={showPreferences} className="p-2 h-9 rounded-lg border border-[hsl(var(--border))]" title="Edit personalization"><SlidersHorizontal className="w-4 h-4" /></button>
    </div>
    {showPreferences && <section className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-4 space-y-4">
      <div><h2 className="text-sm font-semibold">Personalize suggestions</h2><p className="text-[10px] text-[hsl(var(--muted-foreground))]">You control what is saved and used for recommendations.</p></div>
      <Chips label="Dietary preferences" options={dietary} value={prefs.dietaryPreferences || []} onChange={v => setDraft({ ...prefs, dietaryPreferences: v })} />
      <p className="text-[10px] text-amber-700 dark:text-amber-300">Dietary preferences are saved for personalization, but suggestions are not allergen or medical advice. Always verify the product label.</p>
      <label className="block text-xs font-medium">Disliked ingredients<input value={(prefs.dislikedIngredients || []).join(", ")} onChange={e => setDraft({ ...prefs, dislikedIngredients: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} placeholder="e.g. peanuts, coriander" className="mt-1.5 w-full px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm" /></label>
      {(catalog?.categories || []).length ? <Chips label="Preferred categories" options={(catalog?.categories || []).map(category => category.name)} value={prefs.preferredCategories || []} onChange={v => setDraft({ ...prefs, preferredCategories: v })} /> : <p className="text-xs text-[hsl(var(--muted-foreground))]">Preferred categories will be available when the catalog loads.</p>}
      <Chips label="Shopping goals" options={goals} value={prefs.recommendationGoals || []} onChange={v => setDraft({ ...prefs, recommendationGoals: v })} />
      <label className="block text-xs font-medium">Budget preference<select value={prefs.budgetPreference || ""} onChange={e => setDraft({ ...prefs, budgetPreference: e.target.value || null })} className="mt-1.5 w-full px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm"><option value="">No preference</option><option value="value">Best value</option><option value="balanced">Balanced</option><option value="premium">Premium</option></select></label>
      <fieldset><legend className="text-xs font-medium mb-2">Notifications</legend>
        <label className="flex items-center gap-2 text-xs py-1"><input type="checkbox" checked={prefs.notificationRecommendations ?? true} onChange={e => setDraft({ ...prefs, notificationRecommendations: e.target.checked })} />Recommendations</label>
        <label className="flex items-center gap-2 text-xs py-1"><input type="checkbox" checked={prefs.notificationOrderUpdates ?? true} onChange={e => setDraft({ ...prefs, notificationOrderUpdates: e.target.checked })} />Order updates</label>
        <label className="flex items-center gap-2 text-xs py-1"><input type="checkbox" checked={prefs.notificationOffers ?? true} onChange={e => setDraft({ ...prefs, notificationOffers: e.target.checked })} />Offers</label>
      </fieldset>
      <button disabled={saving} onClick={save} className="w-full py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60" style={{ background: "hsl(var(--primary))" }}>{saving ? "Saving…" : "Save preferences"}</button>
    </section>}
    {!result?.profileComplete && !isLoading && <button onClick={() => { setDraft(preferenceData || {}); setShowPreferences(true); }} className="w-full text-left rounded-xl p-3 text-xs bg-[hsl(var(--muted))]">Add a few preferences to make these suggestions more relevant.</button>}
    <div className="flex gap-1.5 overflow-x-auto pb-1"><button onClick={() => choosePrompt("", "budget")} className="flex-none px-3 py-1.5 rounded-full border border-[hsl(var(--border))] text-xs hover:bg-[hsl(var(--muted))]">Under my budget</button><button onClick={() => choosePrompt("", "favorites")} className="flex-none px-3 py-1.5 rounded-full border border-[hsl(var(--border))] text-xs hover:bg-[hsl(var(--muted))]">My favorites</button><button onClick={() => choosePrompt("", "new")} className="flex-none px-3 py-1.5 rounded-full border border-[hsl(var(--border))] text-xs hover:bg-[hsl(var(--muted))]">Try something new</button><button onClick={() => choosePrompt("", "restock")} className="flex-none px-3 py-1.5 rounded-full border border-[hsl(var(--border))] text-xs hover:bg-[hsl(var(--muted))]">Restock staples</button></div>
    <input value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Refine these suggestions…" aria-label="Refine personalized suggestions" className="w-full px-3 py-2.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm" />
    <p className="text-[10px] text-[hsl(var(--muted-foreground))]">Your words filter and re-rank the suggestions already shown; they do not send a chat message.</p>
    {isLoading ? <div className="grid grid-cols-2 gap-3">{[1,2,3,4].map(i => <div key={i} className="h-36 rounded-xl bg-[hsl(var(--muted))] animate-pulse" />)}</div> : <div className="grid grid-cols-2 gap-3">{items.map(item => <article key={item.id} className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-3 flex flex-col gap-2"><div className="flex-1"><p className="text-xs font-semibold leading-tight">{item.name}</p>{item.brand && <p className="text-[10px] text-[hsl(var(--muted-foreground))]">{item.brand}</p>}<p className="mt-1 text-[10px] text-[hsl(var(--primary))]">{item.recommendationReason || "Suggested from your preferences"}</p></div><div className="flex justify-between items-center"><b className="text-sm">€{Number(item.customerPrice).toFixed(2)}</b><button onClick={() => add(item)} disabled={item.stockQuantity <= 0} aria-label={`Add ${item.name}`} className="w-7 h-7 rounded-full text-white flex items-center justify-center disabled:opacity-40" style={{ background: "hsl(var(--primary))" }}><Plus className="w-4 h-4" /></button></div></article>)}</div>}
    {!isLoading && !items.length && <p className="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">No suggestions match that refinement.</p>}
  </div>;
}