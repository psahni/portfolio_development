import { Activity } from "lucide-react";
import Link from "next/link";

export function Brand({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return <Link href={href} aria-label="Nuvortiq Smart Booking home" className="inline-flex min-w-0 items-center gap-2.5 rounded-md">
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-white"><Activity aria-hidden="true" className="size-4" strokeWidth={2} /></span>
    <span className="text-lg font-semibold tracking-[-0.055em]">nuvortiq<span className="text-primary">.</span></span>
    {!compact && <span className="ml-2 hidden border-l pl-3 text-[9px] leading-relaxed font-medium tracking-[0.13em] text-muted-foreground uppercase sm:block">Smart<br />Booking</span>}
  </Link>;
}
