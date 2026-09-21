"use client"

import * as React from "react";
import { cn } from "@/lib/utils";

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  /** Optional tone override when the value crosses a business threshold. */
  tone?: "default" | "success" | "warning" | "destructive";
}

/** Simple determinate progress bar. */
const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, tone = "default", ...props }, ref) => {
    const clamped = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 100);
    const fillColor =
      tone === "success"
        ? "bg-success"
        : tone === "warning"
          ? "bg-warning"
          : tone === "destructive"
            ? "bg-destructive"
            : "bg-primary";

    return (
      <div
        ref={ref}
        className={cn("relative h-2 w-full overflow-hidden rounded-full bg-secondary", className)}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        {...props}
      >
        <div className={cn("h-full rounded-full transition-all", fillColor)} style={{ width: `${clamped}%` }} />
      </div>
    );
  }
);
Progress.displayName = "Progress";

export { Progress };