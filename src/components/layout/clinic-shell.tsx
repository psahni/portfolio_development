import Link from "next/link";
import { ArrowLeft, CalendarDays, Clock3, LayoutDashboard, Settings2, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Brand } from "./brand";

type Section = "workspace" | "calendar" | "appointments" | "availability" | "settings" | "staff";
const navigation = [
  { key: "workspace", label: "Overview", href: "/admin/workspace", icon: LayoutDashboard },
  { key: "calendar", label: "Calendar", href: "/admin/calendar", icon: CalendarDays },
  { key: "appointments", label: "Appointments", href: "/admin/appointments", icon: CalendarDays },
  { key: "availability", label: "Availability", href: "/admin/availability", icon: Clock3 },
  { key: "settings", label: "Clinic settings", href: "/admin/settings", icon: Settings2 },
  { key: "staff", label: "Staff", href: "/admin/staff", icon: Users },
] as const;

export function ClinicShell({ active, title, description, children, actions, admin = true }: {
  active: Section; title: string; description: ReactNode; children: ReactNode; actions?: ReactNode; admin?: boolean;
}) {
  return <div className="min-h-screen">
    <header className="border-b bg-card">
      <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between gap-4 px-5 sm:px-8"><Brand href="/admin/workspace" /><div className="flex items-center gap-3"><span className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><span className="size-1.5 rounded-full bg-primary" />Clinic workspace</span>{actions}</div></div>
      <nav aria-label="Clinic navigation" className="mx-auto flex max-w-[1500px] gap-1 overflow-x-auto px-4 sm:px-7">
        {navigation.filter((item) => admin || item.key === "workspace").map(({ key, label, href, icon: Icon }) => <Link key={key} href={href} aria-label={`${label} navigation`} aria-current={active === key ? "page" : undefined} className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-xs font-medium transition-colors ${active === key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}><Icon aria-hidden="true" className="size-3.5" />{label}</Link>)}
      </nav>
    </header>
    <main className={`mx-auto max-w-[1500px] px-5 py-7 sm:px-8 sm:py-8 ${active === "settings" ? "!max-w-5xl" : ""}`}>
      {active !== "workspace" && <Link href="/admin/workspace" className={`${active === "calendar" ? "hidden sm:inline-flex" : "inline-flex"} mb-5 items-center gap-1.5 text-xs text-muted-foreground hover:text-primary`}><ArrowLeft aria-hidden="true" className="size-3" />Back to workspace</Link>}
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div className="min-w-0"><p className={`ui-eyebrow mb-2 ${active === "calendar" ? "hidden sm:block" : ""}`}>{active === "calendar" ? "Your schedule, at a glance" : "Clinic management"}</p><h1 className="ui-page-title">{title}</h1><div className={`ui-hint mt-2 max-w-2xl ${active === "calendar" ? "hidden sm:block" : ""}`}>{description}</div></div></div>
      {children}
    </main>
  </div>;
}
