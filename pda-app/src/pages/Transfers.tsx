import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/queryClient";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { ArrowLeftRight, Plus, X, CheckCircle2, Trash2 } from "lucide-react";

interface Transfer {
  id: string;
  transferNumber: string;
  fromLocation: string;
  toLocation: string;
  status: string;
  createdByUsername: string;
  createdAt: string;
}

interface TransferItem { id: string; itemId: string; itemName: string; sku: string | null; quantity: number; }
interface ItemLite { id: string; name: string; sku: string; barcode: string | null; }

export default function Transfers() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [fromLocation, setFromLocation] = useState("Main Warehouse");
  const [toLocation, setToLocation] = useState("");
  const [draftItems, setDraftItems] = useState<TransferItem[]>([]);
  const [qtyInput, setQtyInput] = useState("1");
  const [pendingItem, setPendingItem] = useState<ItemLite | null>(null);

  const transfersQuery = useQuery<Transfer[]>({ queryKey: ["/api/pda/transfers"] });
  const activeTransferQuery = useQuery<Transfer & { items: TransferItem[] }>({
    queryKey: [`/api/pda/transfers/${activeId}`],
    enabled: !!activeId,
  });

  const lookupItem = useMutation({
    mutationFn: async (code: string) => apiFetch<ItemLite>(`/api/items/barcode/${encodeURIComponent(code)}`),
    onSuccess: (item) => { setPendingItem(item); setQtyInput("1"); },
    onError: () => alert("No item found for that barcode."),
  });

  function addDraftItem() {
    if (!pendingItem) return;
    setDraftItems((prev) => [
      ...prev,
      { id: crypto.randomUUID(), itemId: pendingItem.id, itemName: pendingItem.name, sku: pendingItem.sku, quantity: parseInt(qtyInput) || 1 },
    ]);
    setPendingItem(null);
  }

  const createTransfer = useMutation({
    mutationFn: async () =>
      apiFetch<Transfer>("/api/pda/transfers", {
        method: "POST",
        body: JSON.stringify({
          fromLocation,
          toLocation,
          items: draftItems.map((i) => ({ itemId: i.itemId, itemName: i.itemName, sku: i.sku, quantity: i.quantity })),
        }),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/pda/transfers"] });
      setDraftItems([]);
      setToLocation("");
      setActiveId(data.id);
    },
  });

  const completeTransfer = useMutation({
    mutationFn: async () => apiFetch(`/api/pda/transfers/${activeId}/complete`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/pda/transfers"] });
      qc.invalidateQueries({ queryKey: [`/api/pda/transfers/${activeId}`] });
    },
  });

  if (activeId) {
    const t = activeTransferQuery.data;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">{t?.transferNumber || "Transfer"}</h1>
            <p className="text-sm text-muted-foreground">{t?.fromLocation} → {t?.toLocation}</p>
          </div>
          <button onClick={() => setActiveId(null)} className="text-muted-foreground" data-testid="button-close-transfer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {t?.status === "completed" ? (
          <div className="flex items-center gap-2 text-success bg-success/10 rounded-lg p-3 text-sm">
            <CheckCircle2 className="w-4 h-4" /> Transfer completed and logged.
          </div>
        ) : (
          <button
            onClick={() => completeTransfer.mutate()}
            disabled={completeTransfer.isPending}
            className="w-full bg-success text-success-foreground rounded-lg py-3 font-medium"
            data-testid="button-complete-transfer"
          >
            Mark Transfer Complete
          </button>
        )}

        <div className="space-y-2">
          {t?.items.map((i) => (
            <div key={i.id} className="bg-card border border-border rounded-lg p-3 flex items-center justify-between" data-testid={`row-transfer-item-${i.itemId}`}>
              <div>
                <p className="text-sm font-medium">{i.itemName}</p>
                <p className="text-xs text-muted-foreground">SKU {i.sku}</p>
              </div>
              <span className="font-semibold text-sm">×{i.quantity}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2"><ArrowLeftRight className="w-5 h-5" /> Transfers</h1>
        <p className="text-sm text-muted-foreground">Log a stock movement between locations</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <input
            value={fromLocation}
            onChange={(e) => setFromLocation(e.target.value)}
            placeholder="From location"
            className="rounded-lg border border-border bg-background py-2.5 px-3 text-sm"
            data-testid="input-from-location"
          />
          <input
            value={toLocation}
            onChange={(e) => setToLocation(e.target.value)}
            placeholder="To location"
            className="rounded-lg border border-border bg-background py-2.5 px-3 text-sm"
            data-testid="input-to-location"
          />
        </div>

        {pendingItem ? (
          <div className="rounded-lg border border-border p-3 space-y-2">
            <p className="text-sm font-medium">{pendingItem.name}</p>
            <div className="flex items-center gap-2">
              <input
                value={qtyInput}
                onChange={(e) => setQtyInput(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                className="w-20 text-center rounded-lg border border-border bg-background py-2"
                data-testid="input-transfer-qty"
              />
              <button onClick={addDraftItem} className="flex-1 bg-primary text-primary-foreground rounded-lg py-2 text-sm" data-testid="button-add-transfer-item">
                Add to Transfer
              </button>
            </div>
          </div>
        ) : (
          <BarcodeScanner onScan={(code) => lookupItem.mutate(code)} />
        )}

        {draftItems.length > 0 && (
          <div className="space-y-1.5">
            {draftItems.map((i) => (
              <div key={i.id} className="flex items-center justify-between bg-muted rounded-lg px-3 py-2 text-sm" data-testid={`row-draft-item-${i.itemId}`}>
                <span>{i.itemName} ×{i.quantity}</span>
                <button onClick={() => setDraftItems((prev) => prev.filter((d) => d.id !== i.id))} data-testid={`button-remove-draft-${i.itemId}`}>
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => createTransfer.mutate()}
          disabled={createTransfer.isPending || !toLocation || !draftItems.length}
          className="w-full bg-primary text-primary-foreground rounded-lg py-2.5 font-medium flex items-center justify-center gap-2 disabled:opacity-40"
          data-testid="button-create-transfer"
        >
          <Plus className="w-4 h-4" /> Create Transfer ({draftItems.length} item{draftItems.length !== 1 ? "s" : ""})
        </button>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Recent Transfers</h2>
        {transfersQuery.data?.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveId(t.id)}
            className="w-full text-left bg-card border border-border rounded-lg p-3 flex items-center justify-between"
            data-testid={`card-transfer-${t.id}`}
          >
            <div>
              <p className="text-sm font-medium">{t.transferNumber}</p>
              <p className="text-xs text-muted-foreground">{t.fromLocation} → {t.toLocation}</p>
            </div>
            <span className={`text-xs rounded-full px-2 py-0.5 ${t.status === "completed" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
              {t.status}
            </span>
          </button>
        ))}
        {transfersQuery.data?.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">No transfers yet</p>
        )}
      </div>
    </div>
  );
}
