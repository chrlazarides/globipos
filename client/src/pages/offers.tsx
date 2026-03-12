import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Gift } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertSeasonalOfferSchema, type SeasonalOffer } from "@shared/schema";
import { z } from "zod";

const offerFormSchema = insertSeasonalOfferSchema.extend({
  name: z.string().min(1, "Name is required"),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
});

export default function Offers() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: offers = [], isLoading } = useQuery<SeasonalOffer[]>({ queryKey: ["/api/seasonal-offers"] });

  const createOffer = useMutation({
    mutationFn: async (data: z.infer<typeof offerFormSchema>) => {
      const res = await apiRequest("POST", "/api/seasonal-offers", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/seasonal-offers"] });
      setDialogOpen(false);
      toast({ title: "Seasonal offer created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const columns: Column<SeasonalOffer>[] = [
    {
      key: "name",
      header: "Offer",
      cell: (row) => (
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-amber-100 dark:bg-amber-900/30">
            <Gift className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <p className="font-medium text-sm">{row.name}</p>
            {row.description && <p className="text-xs text-muted-foreground truncate max-w-[250px]">{row.description}</p>}
          </div>
        </div>
      ),
    },
    {
      key: "discount",
      header: "Discount",
      cell: (row) => <Badge variant="secondary">{row.discountPercentage}%</Badge>,
    },
    {
      key: "mixMatch",
      header: "Mix & Match",
      cell: (row) => (
        <Badge variant={row.mixMatch ? "default" : "outline"}>
          {row.mixMatch ? "Yes" : "No"}
        </Badge>
      ),
    },
    {
      key: "minItems",
      header: "Min. Items",
      cell: (row) => <span className="text-sm">{row.minItems}</span>,
    },
    {
      key: "period",
      header: "Period",
      cell: (row) => (
        <span className="text-sm">
          {formatDate(row.startDate)} - {formatDate(row.endDate)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => {
        const now = new Date();
        const start = new Date(row.startDate);
        const end = new Date(row.endDate);
        const isActive = row.active && start <= now && end >= now;
        const isUpcoming = row.active && start > now;
        return (
          <Badge variant={isActive ? "default" : isUpcoming ? "secondary" : "outline"}>
            {isActive ? "Live" : isUpcoming ? "Upcoming" : "Ended"}
          </Badge>
        );
      },
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Seasonal Offers"
        description="Create mix & match deals and seasonal promotions"
        action={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-offer"><Plus className="w-4 h-4 mr-1" /> New Offer</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Seasonal Offer</DialogTitle></DialogHeader>
              <OfferForm onSubmit={(d) => createOffer.mutate(d)} isPending={createOffer.isPending} />
            </DialogContent>
          </Dialog>
        }
      />

      <Card>
        <CardContent className="p-4">
          <DataTable columns={columns} data={offers} isLoading={isLoading} emptyMessage="No seasonal offers found" />
        </CardContent>
      </Card>
    </div>
  );
}

function OfferForm({ onSubmit, isPending }: { onSubmit: (d: any) => void; isPending: boolean }) {
  const form = useForm({
    resolver: zodResolver(offerFormSchema),
    defaultValues: {
      name: "", description: "", startDate: new Date().toISOString().split("T")[0],
      endDate: "", discountPercentage: "0", minItems: 1, mixMatch: false, active: true,
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem>
            <FormLabel>Offer Name</FormLabel>
            <FormControl><Input {...field} placeholder="e.g. Summer Wine Festival" data-testid="input-offer-name" /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="description" render={({ field }) => (
          <FormItem>
            <FormLabel>Description</FormLabel>
            <FormControl><Textarea {...field} value={field.value || ""} className="resize-none" data-testid="input-offer-description" /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="startDate" render={({ field }) => (
            <FormItem>
              <FormLabel>Start Date</FormLabel>
              <FormControl><Input type="date" {...field} data-testid="input-offer-start" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="endDate" render={({ field }) => (
            <FormItem>
              <FormLabel>End Date</FormLabel>
              <FormControl><Input type="date" {...field} data-testid="input-offer-end" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="discountPercentage" render={({ field }) => (
            <FormItem>
              <FormLabel>Discount (%)</FormLabel>
              <FormControl><Input type="number" step="0.01" {...field} data-testid="input-offer-discount" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="minItems" render={({ field }) => (
            <FormItem>
              <FormLabel>Min. Items</FormLabel>
              <FormControl><Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 1)} data-testid="input-offer-min" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <FormField control={form.control} name="mixMatch" render={({ field }) => (
          <FormItem className="flex items-center justify-between rounded-md border p-3">
            <div>
              <FormLabel>Mix & Match</FormLabel>
              <p className="text-xs text-muted-foreground">Allow combining different items for the offer</p>
            </div>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-mix-match" />
            </FormControl>
          </FormItem>
        )} />
        <div className="flex justify-end">
          <Button type="submit" disabled={isPending} data-testid="button-save-offer">
            {isPending ? "Saving..." : "Save Offer"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
