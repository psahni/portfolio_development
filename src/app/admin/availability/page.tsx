import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import { getSchedulingService } from "@/modules/scheduling/server";
import { dateSchema } from "@/modules/scheduling/models";
import { SignOutButton } from "../sign-out-button";
import { ClinicShell } from "@/components/layout/clinic-shell";
import { AvailabilityEditor } from "./availability-editor";

export const dynamic = "force-dynamic";

export default async function AvailabilityPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const query = await searchParams;
  const selected = dateSchema.safeParse(query.date);
  const initial = await getSchedulingService().preview(await headers(), selected.success ? selected.data : undefined).catch((error: unknown) => {
    if (isAPIError(error) && error.status === "UNAUTHORIZED") redirect("/admin");
    if (isAPIError(error) && error.status === "FORBIDDEN") redirect("/admin/workspace");
    throw error;
  });
  return <ClinicShell actions={<SignOutButton />} active="availability" title="Availability" description={<>Fine-tune a single day without changing your regular schedule. <Link href="/admin/calendar" className="font-medium text-primary underline underline-offset-4">Open calendar</Link></>}>
    {initial.configured ? <AvailabilityEditor initial={initial} /> : <section className="ui-panel"><h2 className="text-lg font-semibold">Set up your clinic first</h2><p className="mt-2 mb-4 text-sm text-muted-foreground">Choose a clinic timezone and weekly hours before managing availability.</p><Link className="font-medium text-primary underline" href="/admin/settings">Clinic settings</Link></section>}
  </ClinicShell>;
}
