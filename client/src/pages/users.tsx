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
import { Users, Plus, Pencil, Trash2, ShieldCheck, Shield, Clock, Loader2, Smartphone, KeyRound, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { formatDateTime } from "@/lib/utils";

interface User {
  id: string;
  username: string;
  email: string | null;
  role: string;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  totpEnabled?: boolean;
}

interface UserFormData {
  username: string;
  email: string;
  password: string;
  role: string;
  active: boolean;
}

// ─── User create/edit dialog ──────────────────────────────────────────────────
function UserDialog({ open, onClose, user }: { open: boolean; onClose: () => void; user: User | null }) {
  const { toast } = useToast();
  const isEdit = !!user;
  const [form, setForm] = useState<UserFormData>({
    username: user?.username || "",
    email: user?.email || "",
    password: "",
    role: user?.role || "staff",
    active: user?.active ?? true,
  });

  const mutation = useMutation({
    mutationFn: async (data: UserFormData) => {
      const payload: any = { username: data.username, email: data.email, role: data.role, active: data.active };
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

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
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
            <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v }))}>
              <SelectTrigger data-testid="select-user-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin — Full access</SelectItem>
                <SelectItem value="staff">Staff — Standard access</SelectItem>
              </SelectContent>
            </Select>
          </div>
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

        {/* Initial state — choose action */}
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
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => setStep("disable")}
                  data-testid="button-2fa-start-disable"
                >
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
                <Button
                  className="w-full"
                  onClick={() => setupQuery.mutate()}
                  disabled={setupQuery.isPending}
                  data-testid="button-2fa-start-setup"
                >
                  {setupQuery.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Smartphone className="w-4 h-4 mr-2" />}
                  Set Up Two-Factor Authentication
                </Button>
              </>
            )}
            <Button variant="outline" className="w-full" onClick={handleClose}>Cancel</Button>
          </div>
        )}

        {/* Setup: scan QR and confirm code */}
        {step === "setup" && (
          <div className="space-y-4 pt-2">
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>Scan the QR code below, then enter the 6-digit code from your app. Do not close this dialog — if you do, you will need to scan a new QR code.</span>
            </div>
            {qrDataUrl && (
              <div className="flex justify-center">
                <img src={qrDataUrl} alt="2FA QR Code" className="w-48 h-48 rounded-lg border" data-testid="img-2fa-qr" />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Or enter manually into your app:</Label>
              <code className="block text-xs bg-muted rounded p-2 break-all font-mono select-all" data-testid="text-2fa-secret">
                {secret}
              </code>
            </div>
            <div className="space-y-2">
              <Label htmlFor="totp-code">Confirmation Code</Label>
              <Input
                id="totp-code"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="text-center text-xl tracking-widest font-mono"
                data-testid="input-2fa-setup-code"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose} data-testid="button-2fa-cancel">Cancel</Button>
              <Button
                onClick={() => enableMutation.mutate()}
                disabled={code.length !== 6 || enableMutation.isPending}
                data-testid="button-2fa-confirm-enable"
              >
                {enableMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Enable 2FA
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Disable: confirm with current code */}
        {step === "disable" && (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Enter the current code from your authenticator app to disable two-factor authentication.
            </p>
            <div className="space-y-2">
              <Label htmlFor="disable-code">Authentication Code</Label>
              <Input
                id="disable-code"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="text-center text-xl tracking-widest font-mono"
                data-testid="input-2fa-disable-code"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("start")}>Back</Button>
              <Button
                variant="destructive"
                onClick={() => disableMutation.mutate()}
                disabled={code.length !== 6 || disableMutation.isPending}
                data-testid="button-2fa-confirm-disable"
              >
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

// ─── Main users page ──────────────────────────────────────────────────────────
export default function UsersPage() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [twoFactorOpen, setTwoFactorOpen] = useState(false);

  const { data: users = [], isLoading } = useQuery<User[]>({ queryKey: ["/api/users"] });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/users/${id}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed" }));
        throw new Error(err.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const reset2faMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/users/${id}/reset-2fa`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "2FA reset", description: "User will be prompted to set up 2FA on next login." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const currentUserData = users.find(u => u.id === currentUser?.id);

  return (
    <div className="p-6">
      <PageHeader
        title="User Management"
        description="Manage who can access this system"
        action={
          <Button onClick={() => { setEditUser(null); setDialogOpen(true); }} data-testid="button-create-user">
            <Plus className="w-4 h-4 mr-2" />
            Add User
          </Button>
        }
      />

      <Card className="mt-6">
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
                      {user.id === currentUser?.id && (
                        <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.email || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={user.role === "admin" ? "default" : "secondary"} className="gap-1">
                        {user.role === "admin" ? <ShieldCheck className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
                        {user.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.active ? "outline" : "destructive"} className="text-xs">
                        {user.active ? "Active" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.totpEnabled ? (
                        <Badge variant="outline" className="text-xs gap-1 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700">
                          <CheckCircle2 className="w-3 h-3" />
                          Enabled
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs gap-1 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700">
                          <AlertTriangle className="w-3 h-3" />
                          Not set up
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {user.lastLoginAt ? (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDateTime(user.lastLoginAt)}
                        </span>
                      ) : "Never"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {user.id === currentUser?.id ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setTwoFactorOpen(true)}
                            title="Manage two-factor authentication"
                            data-testid={`button-2fa-manage-${user.id}`}
                          >
                            <Smartphone className="w-4 h-4" />
                          </Button>
                        ) : currentUser?.role === "admin" && user.totpEnabled && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-amber-600 hover:text-amber-700"
                            onClick={() => reset2faMutation.mutate(user.id)}
                            disabled={reset2faMutation.isPending}
                            title="Reset 2FA — user will be forced to set up again on next login"
                            data-testid={`button-reset-2fa-${user.id}`}
                          >
                            <KeyRound className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { setEditUser(user); setDialogOpen(true); }}
                          data-testid={`button-edit-user-${user.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => deleteMutation.mutate(user.id)}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-user-${user.id}`}
                        >
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
      />

      <TwoFactorDialog
        open={twoFactorOpen}
        onClose={() => setTwoFactorOpen(false)}
        currentlyEnabled={currentUserData?.totpEnabled ?? false}
      />
    </div>
  );
}
