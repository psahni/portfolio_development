"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { configurationSchema, DAYS, toMinutes, toTime, type ClinicConfiguration } from "@/modules/clinic/configuration";

const inputClass = "mt-2 h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
type NumericField = "durationMinutes" | "bufferBeforeMinutes" | "bufferAfterMinutes" | "minLeadMinutes" | "bookingHorizonDays";
const numericFields: { key: NumericField; label: string; min: number; max: number }[] = [
  { key: "durationMinutes", label: "Appointment duration (minutes)", min: 5, max: 240 },
  { key: "bufferBeforeMinutes", label: "Buffer before (minutes)", min: 0, max: 120 },
  { key: "bufferAfterMinutes", label: "Buffer after (minutes)", min: 0, max: 120 },
  { key: "minLeadMinutes", label: "Minimum notice (minutes)", min: 0, max: 10080 },
  { key: "bookingHorizonDays", label: "Book ahead (days)", min: 1, max: 365 },
];

export function SettingsForm({ initial, timezones }: { initial: ClinicConfiguration; timezones: string[] }) {
  const router = useRouter();
  const [settings, setSettings] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  function update(next: ClinicConfiguration) { setSettings(next); setError(""); setSaved(false); }

  function updateIntervals(day: number, intervals: ClinicConfiguration["weeklyHours"][number]["intervals"]) {
    update({ ...settings, weeklyHours: settings.weeklyHours.map((entry) => entry.day === day ? { ...entry, intervals } : entry) });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(""); setSaved(false);
    const parsed = configurationSchema.safeParse(settings);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setPending(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store", body: JSON.stringify(parsed.data),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.settings) throw new Error(result?.error ?? "Unable to save clinic settings. Please try again.");
      setSettings(result.settings); setSaved(true); router.refresh();
    } catch (failure) {
      setError(failure instanceof Error && failure.message !== "Failed to fetch" ? failure.message : "Unable to save clinic settings. Please try again.");
    } finally { setPending(false); }
  }

  return (
    <form onSubmit={save} noValidate aria-busy={pending} className="space-y-6">
      <fieldset disabled={pending} className="space-y-6">
        <section aria-labelledby="clinic-details" className="rounded-2xl border bg-card p-5 sm:p-7">
          <h2 id="clinic-details" className="text-lg font-semibold">Clinic and doctor</h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            {([
              ["clinicName", "Clinic name", "text"], ["doctorName", "Doctor name", "text"],
              ["email", "Contact email (optional)", "email"], ["phone", "Contact phone (optional)", "tel"],
            ] as const).map(([key, label, type]) => <div key={key}>
              <label htmlFor={key} className="text-sm font-medium">{label}</label>
              <input id={key} type={type} maxLength={key === "phone" ? 32 : key === "email" ? 254 : 120} value={settings[key]} onChange={(event) => update({ ...settings, [key]: event.target.value })} className={inputClass} />
            </div>)}
            <div className="sm:col-span-2">
              <label htmlFor="timezone" className="text-sm font-medium">Clinic timezone</label>
              <select id="timezone" value={settings.timezone} onChange={(event) => update({ ...settings, timezone: event.target.value })} className={inputClass} aria-describedby="timezone-hint">
                <option value="" disabled>Select clinic timezone</option>
                {timezones.map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}
              </select>
              <p id="timezone-hint" className="mt-2 text-sm text-muted-foreground">Weekly hours and appointment times use this timezone.</p>
            </div>
          </div>
        </section>
        <section aria-labelledby="appointment-rules" className="rounded-2xl border bg-card p-5 sm:p-7">
          <h2 id="appointment-rules" className="text-lg font-semibold">Appointment rules</h2>
          <p className="mt-2 text-sm text-muted-foreground">Set the visit length, preparation time and how far ahead patients can book.</p>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            {numericFields.map(({ key, label, min, max }) => <div key={key}>
              <label htmlFor={key} className="text-sm font-medium">{label}</label>
              <input id={key} type="number" min={min} max={max} step={1} value={Number.isNaN(settings[key]) ? "" : settings[key]} onChange={(event) => update({ ...settings, [key]: event.target.value === "" ? NaN : Number(event.target.value) })} className={inputClass} />
            </div>)}
          </div>
        </section>
        <section aria-labelledby="weekly-hours" className="rounded-2xl border bg-card p-5 sm:p-7">
          <h2 id="weekly-hours" className="text-lg font-semibold">Weekly hours</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Leave a day closed or add opening hours. Add separate intervals for breaks; each interval must finish on the same day.</p>
          <div className="mt-6 space-y-5">
            {settings.weeklyHours.map(({ day, intervals }) => <fieldset key={day} className="min-w-0 border-t pt-4" aria-label={`${DAYS[day]} hours`}>
              <legend className="pr-3 text-sm font-semibold">{DAYS[day]}</legend>
              {!intervals.length && <p className="mb-3 text-sm text-muted-foreground">Closed</p>}
              {intervals.map((interval, index) => <div key={index} className="mb-4 grid grid-cols-2 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
                {(["start", "end"] as const).map((key) => <div key={key}>
                  <label htmlFor={`${day}-${index}-${key}`} className="text-xs text-muted-foreground">{key === "start" ? "Opens" : "Closes"}</label>
                  <input id={`${day}-${index}-${key}`} aria-label={`${DAYS[day]} ${key === "start" ? "opening" : "closing"} time ${index + 1}`} type="time" step={60} value={interval[key]} onChange={(event) => updateIntervals(day, intervals.map((entry, i) => i === index ? { ...entry, [key]: event.target.value } : entry))} className={inputClass} />
                </div>)}
                <Button type="button" variant="outline" size="sm" className="col-span-2 w-fit sm:col-span-1" aria-label={`Remove ${DAYS[day]} interval ${index + 1}`} onClick={() => updateIntervals(day, intervals.filter((_, i) => i !== index))}>Remove</Button>
              </div>)}
              <Button type="button" variant="outline" size="sm" aria-label={`Add ${DAYS[day]} hours`} disabled={intervals.length >= 8} onClick={() => {
                const lastEnd = intervals.length ? Math.max(...intervals.map((entry) => toMinutes(entry.end))) : 540;
                const start = Number.isFinite(lastEnd) && lastEnd < 1439 ? lastEnd : 540;
                updateIntervals(day, [...intervals, { start: toTime(start), end: toTime(Math.min(start + (intervals.length ? 60 : 480), 1439)) }]);
              }}>Add hours</Button>
            </fieldset>)}
          </div>
        </section>
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {saved && <p role="status" className="rounded-lg border bg-muted p-3 text-sm text-primary">Clinic settings saved.</p>}
        <Button type="submit" className="w-full sm:w-auto">{pending ? "Saving…" : "Save settings"}</Button>
      </fieldset>
    </form>
  );
}
