import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import { getSchedulingService } from "@/modules/scheduling/server";
import { calendarQuerySchema } from "@/modules/scheduling/calendar-model";
import { DoctorCalendar } from "./doctor-calendar";

export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ date?: string; view?: string }> }) {
  const parsed = calendarQuerySchema.safeParse(await searchParams);
  const query = parsed.success ? parsed.data : calendarQuerySchema.parse({});
  const initial = await getSchedulingService().calendar(await headers(), query.date, query.view).catch((error: unknown) => {
    if (isAPIError(error) && error.status === "UNAUTHORIZED") redirect("/admin");
    if (isAPIError(error) && error.status === "FORBIDDEN") redirect("/admin/workspace");
    throw error;
  });
  return <main className="mx-auto min-h-screen max-w-7xl px-5 py-8 sm:px-8">
    <Link href="/admin/workspace" className="text-sm text-primary hover:underline">← Back to workspace</Link>
    <header className="py-7"><p className="mb-3 text-xs font-semibold tracking-[0.16em] text-primary uppercase">Your clinic schedule</p><h1 className="text-3xl font-medium tracking-tight">Doctor calendar</h1><p className="mt-3 text-sm text-muted-foreground">See available appointments, booked times and breaks in one place.</p></header>
    {initial.configured ? <DoctorCalendar initial={initial} /> : <section className="rounded-2xl border bg-card p-6"><h2 className="text-lg font-semibold">Set up your clinic first</h2><p className="mt-2 mb-4 text-sm text-muted-foreground">Choose a clinic timezone and weekly hours before opening the calendar.</p><Link className="font-medium text-primary underline" href="/admin/settings">Clinic settings</Link></section>}
  </main>;
}
