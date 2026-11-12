"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { createStaffSchema, type StaffMember } from "@/modules/staff/models";

export function StaffManager({ initial }: { initial: StaffMember[] }) {
  const [staff, setStaff] = useState(initial);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function perform(action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(""); setNotice("");
    try { await action(); }
    catch (failure) { setError(failure instanceof Error && failure.message !== "Failed to fetch" ? failure.message : "Unable to update staff. Refresh the list to check the saved status, then try again."); }
    finally { busy.current = false; setPending(false); }
  }

  async function request(method: "GET" | "POST" | "PATCH", input?: unknown) {
    const response = await fetch("/api/admin/staff", {
      method, credentials: "same-origin", cache: "no-store",
      ...(input === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) throw new Error(result?.error ?? "Unable to update staff. Refresh the list and try again.");
    return result;
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createStaffSchema.safeParse({ name, email });
    if (!parsed.success) { setError(parsed.error.issues[0].message); setNotice(""); return; }
    void perform(async () => {
      const result = await request("POST", parsed.data);
      setStaff((current) => [...current, result.member]);
      setName(""); setEmail(""); setNotice("Staff member added. They can sign in using Send code on the clinic sign-in page.");
    });
  }

  function changeStatus(member: StaffMember) {
    void perform(async () => {
      const result = await request("PATCH", { userId: member.userId, active: !member.active });
      setStaff((current) => current.map((entry) => entry.userId === member.userId ? result.member : entry));
      setConfirmation(null);
      setNotice(result.member.active ? "Staff access enabled. A fresh sign-in is required." : "Staff access disabled. Existing sessions have been revoked.");
    });
  }

  return <div className="max-w-4xl space-y-6" aria-busy={pending}>
    <section className="ui-panel" aria-labelledby="add-staff-heading">
      <h2 id="add-staff-heading" className="text-sm font-semibold">Add staff member</h2>
      <p className="ui-hint mt-2">Use their individual email address. Staff sign in with an email code.</p>
      <form onSubmit={add} noValidate className="mt-5">
        <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
          <div><label htmlFor="staff-name" className="text-sm font-medium">Name</label><input id="staff-name" className="ui-input" autoComplete="name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></div>
          <div><label htmlFor="staff-email" className="text-sm font-medium">Email</label><input id="staff-email" type="email" className="ui-input" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></div>
          <Button type="submit" className="w-fit">Add staff</Button>
        </fieldset>
      </form>
    </section>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg border bg-muted p-3 text-sm text-primary">{notice}</p>}
    <section className="ui-panel" aria-labelledby="staff-list-heading">
      <div className="flex items-center justify-between gap-4"><h2 id="staff-list-heading" className="text-sm font-semibold">Clinic staff</h2><Button variant="outline" size="sm" disabled={pending} onClick={() => void perform(async () => {
        const result = await request("GET"); setStaff(result.staff); setConfirmation(null); setNotice("Staff list refreshed.");
      })}>Refresh list</Button></div>
      {!staff.length ? <p className="ui-hint mt-5">No staff members yet. Add your first team member above.</p> : <ul className="mt-3 divide-y">
        {[...staff].sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email)).map((member) => <li key={member.userId} className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0"><p className="break-words text-sm font-medium">{member.name}</p><p className="mt-1 break-all text-sm text-muted-foreground">{member.email}</p><p className={`mt-2 text-xs font-medium ${member.active ? "text-primary" : "text-muted-foreground"}`}>{member.active ? "Active" : "Inactive"}</p></div>
            <Button variant="outline" size="sm" disabled={pending} aria-label={`${member.active ? "Disable" : "Enable"} access for ${member.name}`} onClick={() => member.active ? setConfirmation(member.userId) : changeStatus(member)}>{member.active ? "Disable access" : "Enable access"}</Button>
          </div>
          {confirmation === member.userId && <fieldset disabled={pending} className="mt-4 rounded-lg border bg-muted p-4" aria-label={`Confirm disabling ${member.name}`}>
            <p className="text-sm">Disable access for {member.name}? They will be signed out and cannot sign in until you enable access again.</p>
            <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" onClick={() => changeStatus(member)}>Confirm disable</Button><Button variant="outline" size="sm" onClick={() => setConfirmation(null)}>Keep access</Button></div>
          </fieldset>}
        </li>)}
      </ul>}
    </section>
  </div>;
}
