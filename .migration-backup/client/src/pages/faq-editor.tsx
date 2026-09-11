import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, Pencil, Trash2, HelpCircle, GripVertical, Check, X } from "lucide-react";

interface FaqEntry {
  id: string;
  question: string;
  answer: string;
  keywords: string[];
  active: boolean;
  sortOrder: number;
}

export default function FaqEditor() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FaqEntry | null>(null);
  const [formQuestion, setFormQuestion] = useState("");
  const [formAnswer, setFormAnswer] = useState("");
  const [formKeywords, setFormKeywords] = useState("");
  const { toast } = useToast();

  const { data: faqs = [], isLoading } = useQuery<FaqEntry[]>({
    queryKey: ["/api/faq"],
  });

  const saveMutation = useMutation({
    mutationFn: async (data: { question: string; answer: string; keywords: string[] }) => {
      if (editing) {
        const res = await apiRequest("PUT", `/api/faq/${editing.id}`, data);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/faq", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/faq"] });
      closeDialog();
      toast({ title: editing ? "FAQ updated" : "FAQ created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/faq/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/faq"] });
      toast({ title: "FAQ deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await apiRequest("PUT", `/api/faq/${id}`, { active });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/faq"] }),
  });

  function openCreate() {
    setEditing(null);
    setFormQuestion("");
    setFormAnswer("");
    setFormKeywords("");
    setDialogOpen(true);
  }

  function openEdit(faq: FaqEntry) {
    setEditing(faq);
    setFormQuestion(faq.question);
    setFormAnswer(faq.answer);
    setFormKeywords((faq.keywords || []).join(", "));
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditing(null);
  }

  function handleSave() {
    if (!formQuestion.trim() || !formAnswer.trim()) {
      toast({ title: "Question and answer are required", variant: "destructive" });
      return;
    }
    const keywords = formKeywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    saveMutation.mutate({ question: formQuestion.trim(), answer: formAnswer.trim(), keywords });
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader
        title="FAQ Knowledge Base"
        subtitle="Manage questions and answers used by the chatbot to answer customer enquiries"
        icon={<HelpCircle className="w-5 h-5" />}
        action={
          <Button onClick={openCreate} data-testid="button-add-faq">
            <Plus className="w-4 h-4 mr-2" /> Add FAQ
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : faqs.length === 0 ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <HelpCircle className="w-10 h-10 opacity-30" />
            <p className="text-sm">No FAQ entries yet. Add your first one to help the chatbot answer common questions.</p>
            <Button variant="outline" onClick={openCreate} data-testid="button-add-faq-empty">
              <Plus className="w-4 h-4 mr-2" /> Add First FAQ
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {faqs.map((faq) => (
            <Card key={faq.id} className={faq.active ? "" : "opacity-60"} data-testid={`card-faq-${faq.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <GripVertical className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm" data-testid={`text-faq-question-${faq.id}`}>{faq.question}</p>
                        <Badge variant={faq.active ? "default" : "secondary"} className="text-xs">
                          {faq.active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{faq.answer}</p>
                      {faq.keywords && faq.keywords.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {faq.keywords.map((k) => (
                            <span key={k} className="text-xs bg-muted px-1.5 py-0.5 rounded">
                              {k}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => toggleMutation.mutate({ id: faq.id, active: !faq.active })}
                      title={faq.active ? "Deactivate" : "Activate"}
                      data-testid={`button-toggle-faq-${faq.id}`}
                    >
                      {faq.active ? <X className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => openEdit(faq)}
                      data-testid={`button-edit-faq-${faq.id}`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => deleteMutation.mutate(faq.id)}
                      data-testid={`button-delete-faq-${faq.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit FAQ" : "Add FAQ Entry"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Question</label>
              <Input
                value={formQuestion}
                onChange={(e) => setFormQuestion(e.target.value)}
                placeholder="e.g. What are your opening hours?"
                data-testid="input-faq-question"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Answer</label>
              <Textarea
                value={formAnswer}
                onChange={(e) => setFormAnswer(e.target.value)}
                placeholder="e.g. We are open Monday–Friday 9am–6pm and Saturday 10am–4pm."
                rows={4}
                data-testid="input-faq-answer"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Keywords (comma-separated, optional)</label>
              <Input
                value={formKeywords}
                onChange={(e) => setFormKeywords(e.target.value)}
                placeholder="e.g. hours, open, close, time"
                data-testid="input-faq-keywords"
              />
              <p className="text-xs text-muted-foreground">
                Keywords help the chatbot match this FAQ to customer questions.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeDialog} data-testid="button-cancel-faq">
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-faq">
                {saveMutation.isPending ? "Saving..." : editing ? "Save Changes" : "Add FAQ"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
