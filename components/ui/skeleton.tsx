import { cn } from "@/lib/utils";

/** Lightweight loading placeholder used while real-time streams hydrate. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

export { Skeleton };