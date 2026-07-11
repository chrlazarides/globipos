import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PosLocation } from "@shared/schema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (location: PosLocation) => void;
}

// Reusable "create a stock/warehouse location" dialog. Posts to the
// items-module-accessible /api/stock-locations endpoint so stock managers can
// create locations without POS admin access.
export function CreateLocationDialog({ open, onOpenChange, onCreated }: Props) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [isDefaultReceiving, setIsDefaultReceiving] = useState(false);

  const reset = () => { setName(""); setCode(""); setAddress(""); setPhone(""); setIsDefaultReceiving(false); };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Location name is required");
      if (!code.trim()) throw new Error("Location code is required");
      const res = await apiRequest("POST", "/api/stock-locations", {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        address: address.trim() || null,
        phone: phone.trim() || null,
        isDefaultReceiving,
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Failed to create location"); }
      return res.json() as Promise<PosLocation>;
    },
    onSuccess: (loc) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/locations"] });
      toast({ title: "Location created", description: `${loc.name} is ready to receive stock.` });
      onCreated?.(loc);
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New Stock Location</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="loc-name">Name</Label>
              <Input id="loc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Warehouse" data-testid="input-newloc-name" />
            </div>
            <div>
              <Label htmlFor="loc-code">Code</Label>
              <Input id="loc-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="WH1" data-testid="input-newloc-code" />
            </div>
          </div>
          <div>
            <Label htmlFor="loc-address">Address</Label>
            <Input id="loc-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Optional" data-testid="input-newloc-address" />
          </div>
          <div>
            <Label htmlFor="loc-phone">Phone</Label>
            <Input id="loc-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" data-testid="input-newloc-phone" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={isDefaultReceiving} onCheckedChange={(c) => setIsDefaultReceiving(!!c)} data-testid="checkbox-newloc-default" />
            <span className="text-sm">Set as default receiving location</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} data-testid="button-create-location">
            {mutation.isPending ? "Creating…" : "Create Location"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
