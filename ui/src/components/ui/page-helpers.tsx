import React from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, description, children }) => (
  <div className="flex items-center justify-between border-b border-border px-6 py-5">
    <div>
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
    </div>
    {children && <div className="flex items-center gap-2">{children}</div>}
  </div>
);

interface StatusBadgeProps {
  status: "active" | "revoked" | "warning";
  children: React.ReactNode;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, children }) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
      status === "active" && "bg-success/15 text-success",
      status === "revoked" && "bg-destructive/15 text-destructive",
      status === "warning" && "bg-warning/15 text-warning"
    )}
  >
    {children}
  </span>
);

export const EmptyState: React.FC<{ icon: React.ReactNode; title: string; description: string; children?: React.ReactNode }> = ({
  icon, title, description, children
}) => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">{icon}</div>
    <h3 className="font-medium">{title}</h3>
    <p className="mt-1 text-sm text-muted-foreground max-w-sm">{description}</p>
    {children && <div className="mt-4">{children}</div>}
  </div>
);

export const DataCard: React.FC<{ label: string; value: string | number; subtext?: string }> = ({ label, value, subtext }) => (
  <div className="rounded-xl border border-border bg-card p-4">
    <p className="text-xs font-medium text-muted-foreground">{label}</p>
    <p className="mt-1 text-2xl font-bold tracking-tight">{String(value)}</p>
    {subtext && <p className="mt-0.5 text-xs text-muted-foreground">{subtext}</p>}
  </div>
);
