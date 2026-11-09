import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import { getIdentity } from "@/modules/identity/server";
import { SignOutButton } from "../sign-out-button";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getClinicService } from "@/modules/clinic/server";
import { ClinicShell } from "@/components/layout/clinic-shell";
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
    <ClinicShell active="workspace" title="Clinic workspace" admin={principal.role === "admin"} actions={<SignOutButton />} description="A little more clarity. A calmer clinic day.">
      <div className="mb-5 flex items-center gap-2 text-xs text-muted-foreground"><span className="flex size-7 items-center justify-center rounded-full border bg-card text-[10px] font-semibold text-primary">{principal.role === "admin" ? "DR" : "ST"}</span><span>{principal.role === "admin" ? "Doctor / Admin" : "Staff"}</span><span className="mx-1 text-border">/</span><span>Overview</span></div>
      {principal.role === "admin" && (settings ? <ClinicSummary settings={settings} /> : <div className="ui-panel max-w-xl"><p className="ui-eyebrow mb-3">Welcome to your workspace</p><h2 className="text-xl font-semibold tracking-tight">Prepare your clinic</h2><p className="ui-hint mt-3 mb-5">Start with your clinic details, appointment rules and weekly opening hours.</p><Button asChild><Link href="/admin/settings">Clinic settings</Link></Button></div>)}
      {principal.role === "staff" && <div className="ui-panel max-w-xl"><h2 className="font-semibold">Welcome to your clinic</h2><p className="ui-hint mt-2">You’re signed in to your clinic workspace. Your doctor can help you get started.</p></div>}
    </ClinicShell>
  );
}
