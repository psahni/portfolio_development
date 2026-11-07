import { z } from "zod";
import { toMinutes } from "@/modules/clinic/configuration";

export const dateSchema = z.iso.date().refine((value) => {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Choose a valid calendar date.");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time between 00:00 and 23:59.");
const interval = z.object({ start: time, end: time });
export type TimeInterval = z.infer<typeof interval>;
const reason = z.string().trim().max(160, "Keep the note to 160 characters.").default("");

export const overrideSchema = z.object({
  date: dateSchema, mode: z.enum(["weekly", "closed", "custom"]),
  intervals: z.array(interval).max(8).default([]), reason,
}).superRefine((value, ctx) => {
  if (value.mode !== "custom" && value.intervals.length) ctx.addIssue({ code: "custom", path: ["intervals"], message: "Use intervals only for special hours." });
  if (value.mode === "custom" && !value.intervals.length) ctx.addIssue({ code: "custom", path: ["intervals"], message: "Add at least one special-hours interval." });
  const sorted = [...value.intervals].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  sorted.forEach((entry, index) => {
    if (toMinutes(entry.start) >= toMinutes(entry.end)) ctx.addIssue({ code: "custom", path: ["intervals"], message: "Closing time must be after opening time on the same day." });
    if (index && toMinutes(entry.start) < toMinutes(sorted[index - 1].end)) ctx.addIssue({ code: "custom", path: ["intervals"], message: "Special hours must not overlap." });
  });
});

export const breakSchema = z.object({ date: dateSchema, start: time, end: time, reason }).refine((value) => toMinutes(value.start) < toMinutes(value.end), "The break must finish after it starts on the same day.");
export const removeBreakSchema = z.object({ date: dateSchema, id: z.uuid() });
export type DateOverride = { mode: "closed" | "custom"; intervals: TimeInterval[]; reason: string };
export type Occupancy = { id?: string; kind: "block" | "appointment"; startsAt: Date; endsAt: Date; reason?: string };
export type ConflictTime = { startsAt: string; endsAt: string; kind: "block" | "appointment" };

export class SchedulingError extends Error {
  constructor(public statusCode: number, message: string, public conflicts: ConflictTime[] = []) { super(message); }
}

export function conflictTimes(rows: Occupancy[]): ConflictTime[] {
  return rows.map((row) => ({ startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), kind: row.kind }));
}

export function clockLabel(value: string) {
  const [hour, minute] = value.split(":");
  return `${Number(hour) % 12 || 12}:${minute} ${Number(hour) < 12 ? "AM" : "PM"}`;
}
