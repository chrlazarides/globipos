import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/App";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Users, Plus, Pencil, Trash2, ShieldCheck, Shield, Clock, Loader2, Smartphone, KeyRound, CheckCircle2, XCircle, AlertTriangle, Crown, Lock } from "lucide-react";
import { formatDateTime } from "@/lib/utils";

export interface User {
  id: string;
  username: string;
  email: string | null;
  role: string;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  totpEnabled?: boolean;
  permissions: string[];
}

// ─── Module definitions for permissions ──────────────────────────────────────
export const ALL_MODULES = [
  { key: "dashboard",  label: "Dashboard" },
  { key: "items",      label: "Items / Inventory" },
  { key: "customers",  label: "Customers" },
  { key: "statements", label: "Customer Statements" },
  { key: "invoices",   label: "Sales (Invoices, Credit Notes, Proforma, Quotations)" },
  { key: "payments",   label: "Customer Payments" },
  { key: "suppliers",  label: "Purchasing (Suppliers, Purchase Invoices, Supplier Payments)" },
  { key: "pricing",    label: "Pricing & Seasonal Offers" },
  { key: "accounting", label: "Accounting (COA, Journal Entries, Expenses, Reports)" },
  { key: "reports",    label: "Analytics / Reports" },
  { key: "email_logs", label: "Email Log" },
  { key: "import",     label: "Import Data" },
  { key: "pda_operations", label: "PDA Operations (Handheld Scanner App)" },
];

interface UserFormData {
  username: string;
  email: string;
  password: string;
  role: string;
  active: boolean;
  permissions: string[];
}

// ─── Permissions Selector ─────────────────────────────────────────────────────
function PermissionsSelector({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const allSelected = value.length === 0;
  const toggle = (key: string) => {
    if (value.includes(key)) onChange(value.filter(k => k !== key));
    else onChange([...value, key]);
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <div className="flex items-center gap-2 p-2 rounded border bg-muted/30 w-full">
          <Lock className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {allSelected
              ? "Full access — all modules visible (no restrictions)"
              : `Restricted to ${value.length} module${value.length !== 1 ? "s" : ""}`}
          </span>
          {!allSelected && (
            <button
              type="button"
              className="ml-auto text-xs text-blue-600 hover:underline"
              onClick={() => onChange([])}
            >
              Grant full access
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto pr-1">
        {ALL_MODULES.map(m => (
          <label key={m.key} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/40 px-2 py-1 rounded">
            <Checkbox
              checked={allSelected || value.includes(m.key)}
              onCheckedChange={() => {
                if (allSelected) {
                  // First click when "full access": restrict to all except this one
                  onChange(ALL_MODULES.filter(x => x.key !== m.key).map(x => x.key));
                } else {
                  toggle(m.key);
                }
              }}
            />
            <span>{m.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ─── User create/edit dialog ──────────────────────────────────────────────────
function UserDialog({ open, onClose, user, currentUser }: { open: boolean; onClose: () => void; user: User | null; currentUser: any }) {
  const { toast } = useToast();
  const isEdit = !!user;
  const [form, setForm] = useState<UserFormData>({
    username: user?.username || "",
    email: user?.email || "",
    password: "",
    role: user?.role || "staff",
    active: user?.active ?? true,
    permissions: user?.permissions || [],
  });

  const mutation = useMutation({
    mutationFn: async (data: UserFormData) => {
      const payload: any = { username: data.username, email: data.email, role: data.role, active: data.active, permissions: data.permissions };
      if (data.password) payload.password = data.password;
      const res = await apiRequest(isEdit ? "PUT" : "POST", isEdit ? `/api/users/${user!.id}` : "/api/users", payload);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: isEdit ? "User updated" : "User created" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.username) return;
    if (!isEdit && !form.password) return;
    mutation.mutate(form);
  };

  const isStaff = form.role === "staff";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit User" : "Create User"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="username">Username *</Label>
            <Input id="username" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} data-testid="input-user-username" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} data-testid="input-user-email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{isEdit ? "New Password (leave blank to keep)" : "Password *"}</Label>
            <Input id="password" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} data-testid="input-user-password" required={!isEdit} />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v, permissions: v !== "staff" ? [] : f.permissions }))}>
              <SelectTrigger data-testid="select-user-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="superuser">
                  <div className="flex items-center gap-2">
                    <Crown className="w-3.5 h-3.5 text-amber-500" />
                    Superuser — Full access + Settings management
                  </div>
                </SelectItem>
                <SelectItem value="admin">Admin — Full access</SelectItem>
                <SelectItem value="staff">Staff — Configurable access</SelectItem>
              </SelectContent>
            </Select>
            {form.role === "superuser" && (
              <p className="text-xs text-amber-600 dark:text-amber-400">Superusers can access Settings and manage all users without a settings password.</p>
            )}
          </div>

          {isStaff && (
            <div className="space-y-2">
              <Label>Module Access</Label>
              <PermissionsSelector value={form.permissions} onChange={v => setForm(f => ({ ...f, permissions: v }))} />
            </div>
          )}

          {isEdit && (
            <div className="flex items-center gap-3">
              <Switch checked={form.active} onCheckedChange={v => setForm(f => ({ ...f, active: v }))} data-testid="switch-user-active" />
              <Label>Active account</Label>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending} data-testid="button-user-save">
              {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isEdit ? "Save Changes" : "Create User"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── 2FA setup / disable dialog ───────────────────────────────────────────────
function TwoFactorDialog({ open, onClose, currentlyEnabled }: { open: boolean; onClose: () => void; currentlyEnabled: boolean }) {
  const { toast } = useToast();
  const [step, setStep] = useState<"start" | "setup" | "disable">("start");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");

  const setupQuery = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/auth/2fa/setup");
      return res.json();
    },
    onSuccess: (data) => {
      setQrDataUrl(data.qrDataUrl);
      setSecret(data.secret);
      setStep("setup");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const enableMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/2fa/enable", { secret, code: code.replace(/\s/g, "") });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "2FA enabled", description: "Two-factor authentication is now active on your account." });
      handleClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const disableMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/2fa/disable", { code: code.replace(/\s/g, "") });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "2FA disabled", description: "Two-factor authentication has been removed from your account." });
      handleClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleClose = () => {
    setStep("start");
    setCode("");
    setQrDataUrl("");
    setSecret("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="w-4 h-4" />
            Two-Factor Authentication
          </DialogTitle>
          <DialogDescription>
            {currentlyEnabled
              ? "2FA is currently enabled on your account."
              : "Add an extra layer of security to your account."}
          </DialogDescription>
        </DialogHeader>

        {step === "start" && (
          <div className="space-y-3 pt-2">
            {currentlyEnabled ? (
              <>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800">
                  <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-green-800 dark:text-green-300">Two-factor authentication is active</p>
                    <p className="text-green-700 dark:text-green-400 text-xs mt-0.5">Your account requires a code from your authenticator app at login.</p>
                  </div>
                </div>
                <Button variant="destructive" className="w-full" onClick={() => setStep("disable")} data-testid="button-2fa-start-disable">
                  <XCircle className="w-4 h-4 mr-2" />
                  Disable Two-Factor Authentication
                </Button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
                  <KeyRound className="w-5 h-5 text-muted-foreground shrink-0" />
                  <div className="text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">Authenticator app required</p>
                    <p className="text-xs mt-0.5">You'll need Google Authenticator, Authy, or any TOTP-compatible app.</p>
                  </div>
                </div>
                <Button className="w-full" onClick={() => setupQuery.mutate()} disabled={setupQuery.isPending} data-testid="button-2fa-start-setup">
                  {setupQuery.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Smartphone className="w-4 h-4 mr-2" />}
                  Set Up Two-Factor Authentication
                </Button>
              </>
            )}
            <Button variant="outline" className="w-full" onClick={handleClose}>Cancel</Button>
          </div>
        )}

        {step === "setup" && (
          <div className="space-y-4 pt-2">
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>Scan the QR code below, then enter the 6-digit code from your app.</span>
            </div>
            {qrDataUrl && (
              <div className="flex justify-center">
                <img src={qrDataUrl} alt="2FA QR Code" className="w-48 h-48 rounded-lg border" data-testid="img-2fa-qr" />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Or enter manually into your app:</Label>
              <code className="block text-xs bg-muted rounded p-2 break-all font-mono select-all" data-testid="text-2fa-secret">{secret}</code>
            </div>
            <div className="space-y-2">
              <Label htmlFor="totp-code">Confirmation Code</Label>
              <Input id="totp-code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" maxLength={6} inputMode="numeric" autoComplete="one-time-code" className="text-center text-xl tracking-widest font-mono" data-testid="input-2fa-setup-code" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose} data-testid="button-2fa-cancel">Cancel</Button>
              <Button onClick={() => enableMutation.mutate()} disabled={code.length !== 6 || enableMutation.isPending} data-testid="button-2fa-confirm-enable">
                {enableMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Enable 2FA
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "disable" && (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">Enter the current code from your authenticator app to disable two-factor authentication.</p>
            <div className="space-y-2">
              <Label htmlFor="disable-code">Authentication Code</Label>
              <Input id="disable-code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" maxLength={6} inputMode="numeric" autoComplete="one-time-code" className="text-center text-xl tracking-widest font-mono" data-testid="input-2fa-disable-code" autoFocus />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("start")}>Back</Button>
              <Button variant="destructive" onClick={() => disableMutation.mutate()} disabled={code.length !== 6 || disableMutation.isPending} data-testid="button-2fa-confirm-disable">
                {disableMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Disable 2FA
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Role badge ───────────────────────────────────────────────────────────────
function RoleBadge({ role }: { role: string }) {
  if (role === "superuser") return (
    <Badge className="gap-1 bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700">
      <Crown className="w-3 h-3" /> superuser
    </Badge>
  );
  if (role === "admin") return (
    <Badge variant="default" className="gap-1"><ShieldCheck className="w-3 h-3" /> admin</Badge>
  );
  return <Badge variant="secondary" className="gap-1"><Shield className="w-3 h-3" /> staff</Badge>;
}

// ─── Exportable Users content (used in Settings tab and standalone page) ──────
export function UsersContent() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [twoFactorOpen, setTwoFactorOpen] = useState(false);

  const { data: users = [], isLoading } = useQuery<User[]>({ queryKey: ["/api/users"] });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/users/${id}`);
      if (!res.ok) { const err = await res.json().catch(() => ({ message: "Failed" })); throw new Error(err.message); }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/users"] }); toast({ title: "User deleted" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const reset2faMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/users/${id}/reset-2fa`);
      if (!res.ok) { const err = await res.json().catch(() => ({ message: "Failed" })); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/users"] }); toast({ title: "2FA reset", description: "User will be prompted to set up 2FA on next login." }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const currentUserData = users.find(u => u.id === currentUser?.id);

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button onClick={() => { setEditUser(null); setDialogOpen(true); }} data-testid="button-create-user">
          <Plus className="w-4 h-4 mr-2" />
          Add User
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">{users.length} user{users.length !== 1 ? "s" : ""}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>2FA</TableHead>
                  <TableHead>Last Login</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map(user => (
                  <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                    <TableCell className="font-medium">
                      {user.username}
                      {user.id === currentUser?.id && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.email || "—"}</TableCell>
                    <TableCell><RoleBadge role={user.role} /></TableCell>
                    <TableCell>
                      {user.role !== "staff" ? (
                        <span className="text-xs text-muted-foreground">Full access</span>
                      ) : user.permissions.length === 0 ? (
                        <span className="text-xs text-muted-foreground">All modules</span>
                      ) : (
                        <span className="text-xs text-amber-700 dark:text-amber-400">{user.permissions.length} module{user.permissions.length !== 1 ? "s" : ""}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.active ? "outline" : "destructive"} className="text-xs">
                        {user.active ? "Active" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.totpEnabled ? (
                        <Badge variant="outline" className="text-xs gap-1 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700">
                          <CheckCircle2 className="w-3 h-3" /> Enabled
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs gap-1 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700">
                          <AlertTriangle className="w-3 h-3" /> Not set up
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {user.lastLoginAt ? (
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDateTime(user.lastLoginAt)}</span>
                      ) : "Never"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {user.id === currentUser?.id ? (
                          <Button size="sm" variant="ghost" onClick={() => setTwoFactorOpen(true)} title="Manage two-factor authentication" data-testid={`button-2fa-manage-${user.id}`}>
                            <Smartphone className="w-4 h-4" />
                          </Button>
                        ) : (currentUser?.role === "admin" || currentUser?.role === "superuser") && user.totpEnabled && (
                          <Button size="sm" variant="ghost" className="text-amber-600 hover:text-amber-700" onClick={() => reset2faMutation.mutate(user.id)} disabled={reset2faMutation.isPending} title="Reset 2FA" data-testid={`button-reset-2fa-${user.id}`}>
                            <KeyRound className="w-4 h-4" />
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => { setEditUser(user); setDialogOpen(true); }} data-testid={`button-edit-user-${user.id}`}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => deleteMutation.mutate(user.id)} disabled={deleteMutation.isPending || user.id === currentUser?.id} data-testid={`button-delete-user-${user.id}`}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <UserDialog
        key={editUser?.id ?? "new"}
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditUser(null); }}
        user={editUser}
        currentUser={currentUser}
      />

      <TwoFactorDialog
        open={twoFactorOpen}
        onClose={() => setTwoFactorOpen(false)}
        currentlyEnabled={currentUserData?.totpEnabled ?? false}
      />
    </>
  );
}

// ─── Standalone page wrapper ───────────────────────────────────────────────────
export default function UsersPage() {
  return (
    <div className="p-6">
      <PageHeader
        title="User Management"
        description="Manage who can access this system"
      />
      <div className="mt-6">
        <UsersContent />
      </div>
    </div>
  );
}
