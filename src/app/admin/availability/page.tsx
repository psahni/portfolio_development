import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import { getSchedulingService } from "@/modules/scheduling/server";
import { dateSchema } from "@/modules/scheduling/models";
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
  return <main className="mx-auto min-h-screen max-w-5xl px-5 py-8 sm:px-8">
    <Link href="/admin/workspace" className="rounded text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">← Back to workspace</Link>
    <header className="py-7"><p className="mb-3 text-xs font-semibold tracking-[0.16em] text-primary uppercase">Your clinic calendar</p><h1 className="text-3xl font-medium tracking-tight">Availability</h1><p className="mt-3 text-sm text-muted-foreground">Preview appointment times and make changes for a single day.</p></header>
    {initial.configured ? <AvailabilityEditor initial={initial} /> : <section className="rounded-2xl border bg-card p-6"><h2 className="text-lg font-semibold">Set up your clinic first</h2><p className="mt-2 mb-4 text-sm text-muted-foreground">Choose a clinic timezone and weekly hours before managing availability.</p><Link className="font-medium text-primary underline" href="/admin/settings">Clinic settings</Link></section>}
  </main>;
}
