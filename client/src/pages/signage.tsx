import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Monitor,
  PlaySquare,
  Image as ImageIcon,
  Video,
  Plus,
  Trash2,
  ExternalLink,
  Settings,
  Clock,
  Calendar as CalendarIcon,
  CheckCircle2,
  XCircle,
  MoreVertical,
  GripVertical,
  Link as LinkIcon,
  Copy
} from "lucide-react";
import {
  SignageMedia,
  SignagePlaylist,
  SignagePlaylistItem,
  SignageScreen,
  InsertSignageMedia,
  InsertSignagePlaylist,
  InsertSignageScreen,
  Item,
  SeasonalOffer
} from "@shared/schema";
import { format } from "date-fns";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertSignageMediaSchema, insertSignagePlaylistSchema, insertSignageScreenSchema } from "@shared/schema";

// ─── Components ─────────────────────────────────────────────────────────────

export default function DigitalSignage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("screens");

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Digital Signage"
        description="Manage media, playlists, and screen pairing for POS displays and menu boards"
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="screens" data-testid="tab-screens">
            <Monitor className="w-4 h-4 mr-1.5" />
            Screens
          </TabsTrigger>
          <TabsTrigger value="playlists" data-testid="tab-playlists">
            <PlaySquare className="w-4 h-4 mr-1.5" />
            Playlists
          </TabsTrigger>
          <TabsTrigger value="media" data-testid="tab-media">
            <ImageIcon className="w-4 h-4 mr-1.5" />
            Media Library
          </TabsTrigger>
        </TabsList>

        <TabsContent value="screens" className="mt-4">
          <ScreensTab />
        </TabsContent>
        <TabsContent value="playlists" className="mt-4">
          <PlaylistsTab />
        </TabsContent>
        <TabsContent value="media" className="mt-4">
          <MediaTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Media Tab ─────────────────────────────────────────────────────────────

function MediaTab() {
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const { data: media = [], isLoading } = useQuery<SignageMedia[]>({
    queryKey: ["/api/signage/media"],
  });

  const form = useForm<InsertSignageMedia>({
    resolver: zodResolver(insertSignageMediaSchema),
    defaultValues: {
      name: "",
      mediaType: "image",
      url: "",
      durationSeconds: 8,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (values: InsertSignageMedia) => {
      const res = await apiRequest("POST", "/api/signage/media", values);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signage/media"] });
      toast({ title: "Media added successfully" });
      setIsAddOpen(false);
      form.reset();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/signage/media/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signage/media"] });
      toast({ title: "Media deleted" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Media Library</h3>
        <Button onClick={() => setIsAddOpen(true)} size="sm" data-testid="button-add-media">
          <Plus className="w-4 h-4 mr-2" />
          Add Media
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {media.map((m) => (
          <Card key={m.id} className="overflow-hidden">
            <div className="aspect-video relative bg-muted flex items-center justify-center">
              {m.mediaType === "image" ? (
                <img src={m.url} alt={m.name} className="object-cover w-full h-full" />
              ) : (
                <Video className="w-12 h-12 text-muted-foreground" />
              )}
            </div>
            <CardContent className="p-3">
              <div className="flex justify-between items-start">
                <div className="min-w-0">
                  <p className="font-medium truncate text-sm" data-testid={`text-media-name-${m.id}`}>{m.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{m.mediaType} · {m.durationSeconds}s</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={() => deleteMutation.mutate(m.id)}
                  data-testid={`button-delete-media-${m.id}`}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Media</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Summer Promotion" data-testid="input-media-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="mediaType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-media-type">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="image">Image</SelectItem>
                        <SelectItem value="video">Video</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>URL</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="https://..." data-testid="input-media-url" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="durationSeconds"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Default Duration (seconds)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value))}
                        data-testid="input-media-duration"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-save-media">
                  Save Media
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Playlists Tab ─────────────────────────────────────────────────────────────

function PlaylistsTab() {
  const { toast } = useToast();
  const [selectedPlaylist, setSelectedPlaylist] = useState<SignagePlaylist | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);

  const { data: playlists = [] } = useQuery<SignagePlaylist[]>({
    queryKey: ["/api/signage/playlists"],
  });

  const { data: media = [] } = useQuery<SignageMedia[]>({
    queryKey: ["/api/signage/media"],
  });

  const { data: items = [] } = useQuery<Item[]>({
    queryKey: ["/api/items"],
  });

  const { data: offers = [] } = useQuery<SeasonalOffer[]>({
    queryKey: ["/api/offers"],
  });

  const playlistItemsQuery = useQuery<SignagePlaylistItem[]>({
    queryKey: ["/api/signage/playlists", selectedPlaylist?.id, "items"],
    enabled: !!selectedPlaylist,
  });

  const createPlaylistMutation = useMutation({
    mutationFn: async (values: InsertSignagePlaylist) => {
      const res = await apiRequest("POST", "/api/signage/playlists", values);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signage/playlists"] });
      toast({ title: "Playlist created" });
      setIsAddOpen(false);
    },
  });

  const deletePlaylistMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/signage/playlists/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signage/playlists"] });
      setSelectedPlaylist(null);
      toast({ title: "Playlist deleted" });
    },
  });

  const addItemMutation = useMutation({
    mutationFn: async (values: any) => {
      const res = await apiRequest("POST", `/api/signage/playlists/${selectedPlaylist?.id}/items`, values);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signage/playlists", selectedPlaylist?.id, "items"] });
      setIsAddItemOpen(false);
      toast({ title: "Item added to playlist" });
    },
  });

  const removeItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      await apiRequest("DELETE", `/api/signage/playlists/${selectedPlaylist?.id}/items/${itemId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signage/playlists", selectedPlaylist?.id, "items"] });
      toast({ title: "Item removed from playlist" });
    },
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-bold">Playlists</CardTitle>
          <Button variant="ghost" size="icon" onClick={() => setIsAddOpen(true)} data-testid="button-create-playlist">
            <Plus className="w-4 h-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {playlists.map((p) => (
              <Button
                key={p.id}
                variant={selectedPlaylist?.id === p.id ? "secondary" : "ghost"}
                className="w-full justify-start text-left font-normal"
                onClick={() => setSelectedPlaylist(p)}
                data-testid={`button-select-playlist-${p.id}`}
              >
                <PlaySquare className="w-4 h-4 mr-2 text-muted-foreground" />
                {p.name}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>{selectedPlaylist ? selectedPlaylist.name : "Select a Playlist"}</CardTitle>
            <CardDescription>Manage sequence and scheduling</CardDescription>
          </div>
          {selectedPlaylist && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setIsAddItemOpen(true)} data-testid="button-add-playlist-item">
                <Plus className="w-4 h-4 mr-2" /> Add Item
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive"
                onClick={() => deletePlaylistMutation.mutate(selectedPlaylist.id)}
                data-testid={`button-delete-playlist-${selectedPlaylist.id}`}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {!selectedPlaylist ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <PlaySquare className="w-12 h-12 mb-2 opacity-20" />
              <p>Select a playlist to manage its content</p>
            </div>
          ) : (
            <div className="space-y-2">
              {playlistItemsQuery.data?.map((item, idx) => {
                const mediaRef = media.find((m) => m.id === item.mediaId);
                const itemRef = items.find((i) => i.id === item.itemId);
                const offerRef = offers.find((o) => o.id === item.offerId);

                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 p-3 rounded-md border bg-card hover:bg-accent/50 transition-colors"
                    data-testid={`row-playlist-item-${idx}`}
                  >
                    <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          {item.contentType}
                        </Badge>
                        <span className="font-medium text-sm truncate">
                          {item.contentType === "media" ? mediaRef?.name : item.contentType === "item" ? itemRef?.name : offerRef?.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {item.durationSeconds}s
                        </span>
                        {(item.startDate || item.endDate) && (
                          <span className="flex items-center gap-1">
                            <CalendarIcon className="w-3 h-3" />
                            {item.startDate && format(new Date(item.startDate), "MMM d")} - {item.endDate && format(new Date(item.endDate), "MMM d")}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => removeItemMutation.mutate(item.id)}
                      data-testid={`button-remove-playlist-item-${item.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Playlist</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              createPlaylistMutation.mutate({ name: formData.get("name") as string });
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="playlist-name">Name</Label>
              <Input id="playlist-name" name="name" placeholder="POS Display Loop" required data-testid="input-playlist-name" />
            </div>
            <DialogFooter>
              <Button type="submit" data-testid="button-save-playlist">Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddItemOpen} onOpenChange={setIsAddItemOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add to Playlist</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              addItemMutation.mutate({
                contentType: formData.get("contentType"),
                mediaId: formData.get("mediaId") || null,
                itemId: formData.get("itemId") || null,
                offerId: formData.get("offerId") || null,
                durationSeconds: parseInt(formData.get("duration") as string),
                startDate: formData.get("startDate") || null,
                endDate: formData.get("endDate") || null,
                daysOfWeek: formData.get("daysOfWeek") || null,
                startTime: formData.get("startTime") || null,
                endTime: formData.get("endTime") || null,
                enabled: true,
                sortOrder: (playlistItemsQuery.data?.length || 0),
              });
            }}
            className="grid grid-cols-2 gap-4"
          >
            <div className="col-span-2 space-y-2">
              <Label>Content Type</Label>
              <Select name="contentType" defaultValue="media">
                <SelectTrigger data-testid="select-item-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="media">Library Media</SelectItem>
                  <SelectItem value="item">Product Item</SelectItem>
                  <SelectItem value="offer">Seasonal Offer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 space-y-2">
              <Label>Select Resource</Label>
              {/* Note: In a real app we'd switch inputs based on contentType */}
              <Select name="mediaId">
                <SelectTrigger data-testid="select-resource">
                  <SelectValue placeholder="Select media..." />
                </SelectTrigger>
                <SelectContent>
                  {media.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Duration (seconds)</Label>
              <Input name="duration" type="number" defaultValue={8} data-testid="input-item-duration" />
            </div>

            <div className="space-y-2">
              <Label>Days of Week (0-6)</Label>
              <Input name="daysOfWeek" placeholder="0,1,2,3,4,5,6" data-testid="input-item-days" />
            </div>

            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input name="startDate" type="date" data-testid="input-item-start-date" />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input name="endDate" type="date" data-testid="input-item-end-date" />
            </div>

            <div className="space-y-2">
              <Label>Start Time</Label>
              <Input name="startTime" type="time" data-testid="input-item-start-time" />
            </div>
            <div className="space-y-2">
              <Label>End Time</Label>
              <Input name="endTime" type="time" data-testid="input-item-end-time" />
            </div>

            <div className="col-span-2">
              <DialogFooter>
                <Button type="submit" data-testid="button-confirm-add-item">Add to Playlist</Button>
              </DialogFooter>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Screens Tab ─────────────────────────────────────────────────────────────

function ScreensTab() {
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const { data: screens = [] } = useQuery<SignageScreen[]>({
    queryKey: ["/api/signage/screens"],
  });

  const { data: playlists = [] } = useQuery<SignagePlaylist[]>({
    queryKey: ["/api/signage/playlists"],
  });

  const { data: terminals = [] } = useQuery<any[]>({
    queryKey: ["/api/pos/terminals"],
  });

  const form = useForm<InsertSignageScreen>({
    resolver: zodResolver(insertSignageScreenSchema),
    defaultValues: {
      name: "",
      screenType: "menu_board",
      playlistId: null,
      posTerminalId: null,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (values: InsertSignageScreen) => {
      const res = await apiRequest("POST", "/api/signage/screens", values);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signage/screens"] });
      toast({ title: "Screen created" });
      setIsAddOpen(false);
      form.reset();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...values }: any) => {
      const res = await apiRequest("PATCH", `/api/signage/screens/${id}`, values);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signage/screens"] });
      toast({ title: "Screen updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/signage/screens/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signage/screens"] });
      toast({ title: "Screen deleted" });
    },
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Paired Screens</h3>
        <Button onClick={() => setIsAddOpen(true)} size="sm" data-testid="button-add-screen">
          <Plus className="w-4 h-4 mr-2" />
          Add Screen
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {screens.map((s) => (
          <Card key={s.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center gap-2 min-w-0">
                <Monitor className="w-4 h-4 text-muted-foreground" />
                <CardTitle className="text-sm font-bold truncate" data-testid={`text-screen-name-${s.id}`}>{s.name}</CardTitle>
              </div>
              <Badge
                variant={s.status === "online" ? "default" : "secondary"}
                className={s.status === "online" ? "bg-green-500 hover:bg-green-600" : ""}
                data-testid={`status-screen-${s.id}`}
              >
                {s.status}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Type</p>
                  <p className="font-medium capitalize">{s.screenType.replace(/_/g, " ")}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Pairing Code</p>
                  <div className="flex items-center gap-1">
                    <code className="bg-muted px-1 rounded font-bold" data-testid={`text-pairing-code-${s.id}`}>{s.pairingCode}</code>
                    <Button variant="ghost" size="icon" className="h-4 w-4" onClick={() => copyToClipboard(s.pairingCode)}>
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Assigned Playlist</Label>
                <Select
                  value={s.playlistId || "none"}
                  onValueChange={(v) => updateMutation.mutate({ id: s.id, playlistId: v === "none" ? null : v })}
                >
                  <SelectTrigger className="h-8 text-xs" data-testid={`select-screen-playlist-${s.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Playlist</SelectItem>
                    {playlists.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between pt-2 border-t mt-2">
                <a
                  href={`/signage/play/${s.pairingCode}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-blue-600 hover:underline flex items-center gap-1"
                  data-testid={`link-player-${s.id}`}
                >
                  <ExternalLink className="w-3 h-3" /> Player URL
                </a>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={() => deleteMutation.mutate(s.id)}
                  data-testid={`button-delete-screen-${s.id}`}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Screen</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Main Bar Menu" data-testid="input-screen-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="screenType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Screen Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-screen-type">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="menu_board">Menu Board</SelectItem>
                        <SelectItem value="shelf_monitor">Shelf Monitor</SelectItem>
                        <SelectItem value="pos_customer_display">POS Customer Display</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {form.watch("screenType") === "pos_customer_display" && (
                <FormField
                  control={form.control}
                  name="posTerminalId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>POS Terminal</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value || undefined}>
                        <FormControl>
                          <SelectTrigger data-testid="select-terminal">
                            <SelectValue placeholder="Select terminal" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {terminals.map((t) => (
                            <SelectItem key={t.id} value={t.id}>{t.name} ({t.terminalCode})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-save-screen">
                  Create Screen
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
