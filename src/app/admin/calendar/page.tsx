import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import { getSchedulingService } from "@/modules/scheduling/server";
import { calendarQuerySchema } from "@/modules/scheduling/calendar-model";
import { SignOutButton } from "../sign-out-button";
import { ClinicShell } from "@/components/layout/clinic-shell";
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
  return <ClinicShell actions={<SignOutButton />} active="calendar" title="Doctor calendar" description="A clear view of your day. Every appointment, every open moment.">
    {initial.configured ? <DoctorCalendar initial={initial} /> : <section className="ui-panel"><h2 className="text-lg font-semibold">Set up your clinic first</h2><p className="mt-2 mb-4 text-sm text-muted-foreground">Choose a clinic timezone and weekly hours before opening the calendar.</p><Link className="font-medium text-primary underline" href="/admin/settings">Clinic settings</Link></section>}
  </ClinicShell>;
}
