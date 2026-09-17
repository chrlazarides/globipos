import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Star, TrendingUp, TrendingDown, Minus, Search, MessageSquare, FilterX, Calendar } from "lucide-react";
import { formatDate } from "@/lib/utils";

export default function CustomerFeedback() {
  const [filterRating, setFilterRating] = useState<string>("all");
  const [filterContext, setFilterContext] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/customer-feedback"],
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  const summary = data?.summary || {};
  const feedback = data?.recent || data?.feedback || [];
  const trendRows = Array.isArray(data?.trend) ? data.trend : [];
  const averageRating = Number(summary.averageRating ?? summary.average ?? 0);
  const reviewCount = Number(summary.total ?? summary.count ?? 0);
  const breakdown: Record<number, number> = {
    1: Number(summary.rating1 || 0),
    2: Number(summary.rating2 || 0),
    3: Number(summary.rating3 || 0),
    4: Number(summary.rating4 || 0),
    5: Number(summary.rating5 || 0),
  };
  const previousTrend = trendRows.at(-2);
  const currentTrend = trendRows.at(-1);
  const trendChange = Number(currentTrend?.averageRating || 0) - Number(previousTrend?.averageRating || 0);
  const trendDirection = trendChange > 0.01 ? "up" : trendChange < -0.01 ? "down" : "flat";

  const filteredFeedback = feedback.filter((item: any) => {
    const matchesRating = filterRating === "all" || item.rating.toString() === filterRating;
    const matchesContext = filterContext === "all" || item.context === filterContext;
    const matchesSearch = !searchQuery || 
      (item.comment && item.comment.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.orderId && item.orderId.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.customerName && item.customerName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.customerCode && item.customerCode.toLowerCase().includes(searchQuery.toLowerCase()));
    
    return matchesRating && matchesContext && matchesSearch;
  });

  const getTrendIcon = (direction: string) => {
    switch (direction) {
      case 'up': return <TrendingUp className="w-4 h-4 text-emerald-500" />;
      case 'down': return <TrendingDown className="w-4 h-4 text-rose-500" />;
      default: return <Minus className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getTrendColor = (direction: string) => {
    switch (direction) {
      case 'up': return "text-emerald-600 dark:text-emerald-400";
      case 'down': return "text-rose-600 dark:text-rose-400";
      default: return "text-muted-foreground";
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="title-feedback">Customer Sentiment</h1>
        <p className="text-sm text-muted-foreground mt-1">Monitor satisfaction and act on customer feedback</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="shadow-sm">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground">Average Rating</p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-4xl font-black tabular-nums">{averageRating.toFixed(1)}</span>
              <Star className="w-6 h-6 fill-yellow-400 text-yellow-400 -translate-y-1" />
            </div>
            <div className="mt-4 flex items-center gap-2 text-sm">
                <span className={`flex items-center font-medium ${getTrendColor(trendDirection)}`}>
                  {getTrendIcon(trendDirection)}
                  <span className="ml-1">{Math.abs(trendChange).toFixed(1)}</span>
              </span>
              <span className="text-muted-foreground">vs previous feedback day</span>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground">Total Reviews</p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-4xl font-black tabular-nums">{reviewCount}</span>
            </div>
            <div className="mt-4 flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">All time submissions</span>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm lg:col-span-2">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground mb-4">Rating Breakdown</p>
            <div className="space-y-2">
              {[5, 4, 3, 2, 1].map(star => {
                const count = breakdown[star] || 0;
                const pct = reviewCount > 0 ? (count / reviewCount) * 100 : 0;
                return (
                  <div key={star} className="flex items-center gap-3 text-sm">
                    <div className="flex items-center gap-1 w-12 shrink-0">
                      <span className="font-medium">{star}</span>
                      <Star className="w-3.5 h-3.5 fill-muted-foreground/30 text-muted-foreground/30" />
                    </div>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full ${star >= 4 ? 'bg-emerald-500' : star === 3 ? 'bg-yellow-500' : 'bg-rose-500'}`} 
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-12 text-right tabular-nums text-muted-foreground">{count}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter Bar */}
      <Card className="shadow-sm">
        <div className="p-4 border-b bg-muted/20 flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search comments or order IDs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-background"
              data-testid="input-search-feedback"
            />
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <Select value={filterRating} onValueChange={setFilterRating}>
              <SelectTrigger className="w-[140px] bg-background">
                <SelectValue placeholder="Rating" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Ratings</SelectItem>
                <SelectItem value="5">5 Stars</SelectItem>
                <SelectItem value="4">4 Stars</SelectItem>
                <SelectItem value="3">3 Stars</SelectItem>
                <SelectItem value="2">2 Stars</SelectItem>
                <SelectItem value="1">1 Star</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterContext} onValueChange={setFilterContext}>
              <SelectTrigger className="w-[140px] bg-background">
                <SelectValue placeholder="Context" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Contexts</SelectItem>
                <SelectItem value="order">Orders</SelectItem>
                <SelectItem value="general">General</SelectItem>
              </SelectContent>
            </Select>

            {(searchQuery || filterRating !== "all" || filterContext !== "all") && (
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => {
                  setSearchQuery("");
                  setFilterRating("all");
                  setFilterContext("all");
                }}
                title="Clear filters"
              >
                <FilterX className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Feedback List */}
        <div className="divide-y">
          {filteredFeedback.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-base font-medium">No feedback found</p>
              <p className="text-sm mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            filteredFeedback.map((item: any) => (
              <div key={item.id} className="p-6 transition-colors hover:bg-muted/10">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  
                  {/* Left Col: Customer & Rating */}
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="flex gap-0.5">
                        {[1, 2, 3, 4, 5].map(star => (
                          <Star 
                            key={star} 
                            className={`w-4 h-4 ${star <= item.rating ? 'fill-yellow-400 text-yellow-400' : 'fill-muted text-muted-foreground/30'}`} 
                          />
                        ))}
                      </div>
                      <Badge variant={item.sentiment === "negative" ? "destructive" : "outline"} className="text-[10px] uppercase font-bold tracking-wider">
                        {item.sentiment || "unclassified"}
                      </Badge>
                      {item.orderId && (
                        <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded">
                          #{item.orderId.slice(0,8)}
                        </span>
                      )}
                    </div>
                    
                    {item.comment ? (
                      <p className="text-sm text-foreground leading-relaxed">"{item.comment}"</p>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">No comment provided</p>
                    )}
                  </div>

                  {/* Right Col: Metadata */}
                  <div className="sm:text-right shrink-0">
                    <p className="text-sm font-medium">
                      {item.customerName || item.customer?.name || "Unknown Customer"}
                    </p>
                    {item.customerCode && (
                      <p className="text-xs text-muted-foreground">{item.customerCode}</p>
                    )}
                    <div className="flex items-center sm:justify-end gap-1.5 mt-2 text-xs text-muted-foreground">
                      <Calendar className="w-3.5 h-3.5" />
                      {formatDate(item.createdAt)}
                    </div>
                  </div>

                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
