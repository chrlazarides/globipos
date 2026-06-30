/**
 * AgeVerificationDialog — prompts cashier to verify customer age
 * before adding an age-restricted item (alcohol, tobacco, etc.).
 *
 * Flow:
 *  1. Auto-shown when a restricted item is scanned.
 *  2. Cashier selects DOB (or born before year) or visual confirm.
 *  3. If underage: reject / supervisor override (PIN prompt).
 *  4. If approved: proceeds and logs in audit.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, ShieldCheck, ShieldX, KeyRound } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface AgeVerificationDialogProps {
  open: boolean;
  productName: string;
  minAge: number;              // e.g. 18
  onApprove: () => void;
  onReject: () => void;
}

type Stage = "dob_entry" | "underage" | "supervisor_pin" | "approved" | "rejected";

export default function AgeVerificationDialog({
  open,
  productName,
  minAge,
  onApprove,
  onReject,
}: AgeVerificationDialogProps) {
  const [stage, setStage] = useState<Stage>("dob_entry");
  const [birthYear, setBirthYear] = useState("");
  const [supervisorPin, setSupervisorPin] = useState("");
  const [pinError, setPinError] = useState("");

  const currentYear = new Date().getFullYear();
  const cutoffYear = currentYear - minAge;

  function reset() {
    setStage("dob_entry");
    setBirthYear("");
    setSupervisorPin("");
    setPinError("");
  }

  function handleCheck() {
    const year = parseInt(birthYear, 10);
    if (isNaN(year) || year < 1900 || year > currentYear) {
      return;
    }
    if (year <= cutoffYear) {
      // Old enough
      setStage("approved");
      onApprove();
      reset();
    } else {
      setStage("underage");
    }
  }

  async function handleSupervisorOverride() {
    setPinError("");
    try {
      const session = await invoke<{ id: string; name: string; role: string } | null>(
        "validate_pin",
        { pin: supervisorPin }
      );
      if (session && (session.role === "manager" || session.role === "supervisor")) {
        setStage("approved");
        await invoke("write_audit", {
          action: "age_override",
          entity: "sale",
          detail: `Supervisor ${session.name} overrode age check for ${productName}`,
        });
        onApprove();
        reset();
      } else {
        setPinError("Manager or supervisor PIN required");
      }
    } catch {
      setPinError("PIN invalid or terminal error");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o) { onReject(); reset(); } }}
    >
      <DialogContent className="sm:max-w-md" data-testid="age-verification-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Age Verification Required
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          <strong>{productName}</strong> requires customers to be {minAge}+ years of age.
        </p>

        {stage === "dob_entry" && (
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="birth-year">Year of birth</Label>
              <Input
                id="birth-year"
                data-testid="input-birth-year"
                type="number"
                min={1900}
                max={currentYear}
                placeholder={`e.g. ${cutoffYear}`}
                value={birthYear}
                onChange={(e) => setBirthYear(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCheck()}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Must be born in {cutoffYear} or earlier to purchase.
              </p>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" data-testid="btn-age-reject" onClick={() => { onReject(); reset(); }}>
                <ShieldX className="mr-1.5 h-4 w-4" />
                Refuse Sale
              </Button>
              <Button data-testid="btn-age-confirm" onClick={handleCheck} disabled={!birthYear}>
                <ShieldCheck className="mr-1.5 h-4 w-4" />
                Verify
              </Button>
            </DialogFooter>
          </div>
        )}

        {stage === "underage" && (
          <div className="space-y-4 py-2">
            <div className="rounded-md bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-4 text-center space-y-1">
              <ShieldX className="h-8 w-8 text-red-500 mx-auto" />
              <p className="font-semibold text-red-700 dark:text-red-300">Customer is under {minAge}</p>
              <p className="text-sm text-red-600 dark:text-red-400">Sale cannot be completed without supervisor override.</p>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStage("dob_entry")}>Back</Button>
              <Button variant="outline" onClick={() => { onReject(); reset(); }}>
                <ShieldX className="mr-1.5 h-4 w-4" />
                Remove Item
              </Button>
              <Button
                data-testid="btn-supervisor-override"
                variant="destructive"
                onClick={() => setStage("supervisor_pin")}
              >
                <KeyRound className="mr-1.5 h-4 w-4" />
                Supervisor Override
              </Button>
            </DialogFooter>
          </div>
        )}

        {stage === "supervisor_pin" && (
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="supervisor-pin">Supervisor PIN</Label>
              <Input
                id="supervisor-pin"
                data-testid="input-supervisor-pin"
                type="password"
                inputMode="numeric"
                placeholder="Enter supervisor PIN"
                value={supervisorPin}
                onChange={(e) => setSupervisorPin(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSupervisorOverride()}
                autoFocus
              />
              {pinError && <p className="text-xs text-red-500">{pinError}</p>}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStage("underage")}>Back</Button>
              <Button
                data-testid="btn-submit-supervisor-pin"
                onClick={handleSupervisorOverride}
                disabled={!supervisorPin}
              >
                Override & Allow
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
