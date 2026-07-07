import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function PageHeader({ title, description, subtitle, action }: PageHeaderProps) {
  const subtext = subtitle ?? description;
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" data-testid={`text-page-title`}>{title}</h1>
        {subtext && (
          <p className="text-sm text-muted-foreground mt-1" data-testid="text-page-description">{subtext}</p>
        )}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}
