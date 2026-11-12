import { z } from "zod";

export const createStaffSchema = z.object({
  name: z.string().trim().min(1, "Enter the staff member’s name.").max(120),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address.")),
}).strict();

export const staffStatusSchema = z.object({
  userId: z.string().min(1).max(128),
  active: z.boolean(),
}).strict();

export type StaffMember = { userId: string; name: string; email: string; active: boolean };

export class StaffError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message); }
}
