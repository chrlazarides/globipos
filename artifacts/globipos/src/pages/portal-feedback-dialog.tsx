import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { portalApiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Star } from "lucide-react";
import type { Customer } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PortalFeedbackDialogProps {
  customer: Customer;
  orderId?: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function PortalFeedbackDialog({ customer, orderId, isOpen, onClose }: PortalFeedbackDialogProps) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const feedbackMutation = useMutation({
    mutationFn: async () => {
      const res = await portalApiRequest("POST", `/api/portal/customer/${customer.id}/feedback`, {
        orderId,
        context: orderId ? "order" : "general",
        rating,
        comment: comment.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Feedback Submitted",
        description: "Thank you for sharing your experience!",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/customer-feedback"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/customer", customer.id, "feedback"] });
      onClose();
      // Reset state after close
      setTimeout(() => {
        setRating(0);
        setHoverRating(0);
        setComment("");
      }, 300);
    },
    onError: (err: Error) => {
      toast({
        title: "Submission Failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (rating === 0) {
      toast({ title: "Rating required", description: "Please select a star rating.", variant: "destructive" });
      return;
    }
    feedbackMutation.mutate();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{orderId ? "Rate your order" : "Share your feedback"}</DialogTitle>
          <DialogDescription>
            {orderId 
              ? `How was your experience with order #${orderId.slice(0, 8)}?` 
              : "We'd love to hear how we're doing and how we can improve."}
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-6 flex flex-col items-center gap-6">
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setRating(star)}
                onMouseEnter={() => setHoverRating(star)}
                onMouseLeave={() => setHoverRating(0)}
                className="p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full transition-transform hover:scale-110 active:scale-95"
                data-testid={`button-star-${star}`}
              >
                <Star
                  className={`w-10 h-10 ${
                    star <= (hoverRating || rating)
                      ? "fill-yellow-400 text-yellow-400 drop-shadow-sm"
                      : "fill-muted text-muted-foreground/30"
                  } transition-colors`}
                />
              </button>
            ))}
          </div>

          <div className="w-full space-y-2">
            <Textarea
              placeholder="Tell us more about your experience (optional)..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="resize-none"
              rows={4}
              data-testid="textarea-feedback-comment"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={feedbackMutation.isPending}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={rating === 0 || feedbackMutation.isPending}
            data-testid="button-submit-feedback"
          >
            {feedbackMutation.isPending ? "Submitting..." : "Submit Feedback"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
