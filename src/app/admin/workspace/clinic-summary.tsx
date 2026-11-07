import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DAYS, type ClinicConfiguration } from "@/modules/clinic/configuration";

function displayTime(value: string) {
  // Recurring hours are clinic-local wall times; formatting must not convert them through UTC.
  const [hour, minute] = value.split(":");
  return `${Number(hour) % 12 || 12}:${minute} ${Number(hour) < 12 ? "AM" : "PM"}`;
}

export function ClinicSummary({ settings }: { settings: ClinicConfiguration }) {
  const details = [
    ["Doctor", settings.doctorName], ["Contact email", settings.email || "Not provided"],
    ["Contact phone", settings.phone || "Not provided"], ["Clinic timezone", settings.timezone.replaceAll("_", " ")],
  ];
  const rules = [
    ["Appointment duration", `${settings.durationMinutes} min`],
    ["Buffer before", settings.bufferBeforeMinutes ? `${settings.bufferBeforeMinutes} min` : "No buffer"],
    ["Buffer after", settings.bufferAfterMinutes ? `${settings.bufferAfterMinutes} min` : "No buffer"],
    ["Minimum notice", `${settings.minLeadMinutes} min`],
    ["Booking window", `Next ${settings.bookingHorizonDays} ${settings.bookingHorizonDays === 1 ? "day" : "days"}`],
  ];

  return <section aria-label="Saved clinic settings" className="mt-8 space-y-6">
    <div className="rounded-2xl border bg-card p-6 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0"><p className="mb-2 text-xs font-semibold tracking-[0.14em] text-primary uppercase">Clinic overview</p><h2 className="break-words text-2xl font-semibold tracking-tight">{settings.clinicName}</h2></div>
        <Button asChild variant="outline"><Link href="/admin/settings">Clinic settings</Link></Button>
      </div>
      <dl className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {details.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm font-medium leading-relaxed">{value}</dd></div>)}
      </dl>
    </div>
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <section aria-labelledby="saved-rules" className="rounded-2xl border bg-card p-6">
        <h3 id="saved-rules" className="text-lg font-semibold">Appointment rules</h3>
        <dl className="mt-4 divide-y">
          {rules.map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-x-5 gap-y-1 py-3 text-sm"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd></div>)}
        </dl>
      </section>
      <section aria-labelledby="saved-hours" className="min-w-0 rounded-2xl border bg-card p-6">
        <h3 id="saved-hours" className="text-lg font-semibold">Weekly hours</h3>
        <p className="mt-1 break-words text-sm text-muted-foreground">All times in {settings.timezone.replaceAll("_", " ")}.</p>
        <table aria-label="Weekly opening hours" className="mt-4 w-full text-left text-sm">
          <thead><tr className="border-b text-xs text-muted-foreground"><th scope="col" className="pb-3 pr-4 font-medium">Day</th><th scope="col" className="pb-3 font-medium">Hours</th></tr></thead>
          <tbody className="divide-y">
            {settings.weeklyHours.map(({ day, intervals }) => <tr key={day}>
              <th scope="row" className="py-3 pr-4 align-top font-medium">{DAYS[day]}</th>
              <td className="py-3 align-top">{intervals.length ? <ul className="space-y-1">{intervals.map((interval) => <li key={interval.start} className="flex flex-wrap items-baseline gap-x-1"><time dateTime={interval.start} className="whitespace-nowrap">{displayTime(interval.start)}</time><span> – </span><time dateTime={interval.end} className="whitespace-nowrap">{displayTime(interval.end)}</time></li>)}</ul> : <span className="text-muted-foreground">Closed</span>}</td>
            </tr>)}
          </tbody>
        </table>
      </section>
    </div>
  </section>;
}
