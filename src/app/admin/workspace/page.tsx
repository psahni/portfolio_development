import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import { getIdentity } from "@/modules/identity/server";
import { SignOutButton } from "../sign-out-button";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getClinicService } from "@/modules/clinic/server";
import { ClinicSummary } from "./clinic-summary";

export const dynamic = "force-dynamic";

function handleAccessError(error: unknown): never {
  if (isAPIError(error) && (error.status === "UNAUTHORIZED" || error.status === "FORBIDDEN")) redirect("/admin");
  throw error;
}

export default async function Workspace() {
  const requestHeaders = await headers();
  const principal = await getIdentity().access.requireClinicAccess(requestHeaders).catch(handleAccessError);
  const settings = principal.role === "admin" ? await getClinicService().get(requestHeaders).catch(handleAccessError) : null;
  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-8 md:px-12">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-6">
        <span className="font-semibold tracking-tight">nuvortiq <span className="ml-2 text-xs font-normal text-muted-foreground">SMART BOOKING</span></span>
        <SignOutButton />
      </header>
      <section className="py-16">
        <p className="mb-4 text-sm font-medium text-primary">{principal.role === "admin" ? "Doctor / Admin" : "Staff"}</p>
        <h1 className="text-3xl font-medium tracking-tight md:text-4xl">Clinic workspace</h1>
        <p className="mt-5 max-w-xl leading-relaxed text-muted-foreground">You’re signed in. Patient booking is coming next.</p>
        {principal.role === "admin" && (settings ? <ClinicSummary settings={settings} /> : <div className="mt-8 max-w-xl rounded-2xl border bg-card p-6"><h2 className="text-lg font-semibold">Prepare your clinic</h2><p className="mt-2 mb-5 text-sm leading-relaxed text-muted-foreground">Set clinic details, appointment rules and weekly opening hours.</p><Button asChild><Link href="/admin/settings">Clinic settings</Link></Button></div>)}
      </section>
    </main>
  );
}
