import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import { ClinicShell } from "@/components/layout/clinic-shell";
import { getStaffService } from "@/modules/staff/server";
import { SignOutButton } from "../sign-out-button";
import { StaffManager } from "./staff-manager";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const staff = await getStaffService().list(await headers()).catch((error: unknown) => {
    if (isAPIError(error) && error.status === "UNAUTHORIZED") redirect("/admin");
    if (isAPIError(error) && error.status === "FORBIDDEN") redirect("/admin/workspace");
    throw error;
  });
  return <ClinicShell active="staff" title="Staff" description="Add your reception team and manage their clinic access." actions={<SignOutButton />}>
    <StaffManager initial={staff} />
  </ClinicShell>;
}
