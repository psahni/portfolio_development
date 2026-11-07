import { z } from "zod";
import { dateSchema, type TimeInterval } from "./models";

export const calendarQuerySchema = z.object({
  date: dateSchema.refine((date) => date >= "0001-01-01", "Choose a valid calendar date.").optional(),
  view: z.enum(["day", "week"]).default("week"),
});
export type CalendarMode = z.infer<typeof calendarQuerySchema>["view"];
export type CalendarEvent = {
  id: string;
  kind: "available" | "appointment" | "block";
  startsAt: string;
  endsAt: string;
  label: string;
  note: string;
  continuesFromPreviousDay: boolean;
  continuesToNextDay: boolean;
};
export type CalendarDay = {
  date: string;
  hours: TimeInterval[];
  events: CalendarEvent[];
  outsideWindow: boolean;
};
export type CalendarView = {
  configured: boolean;
  date: string;
  today: string;
  timezone: string;
  mode: CalendarMode;
  startDate: string;
  endDate: string;
  days: CalendarDay[];
};
