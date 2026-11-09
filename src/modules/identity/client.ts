"use client";

type StaffAction = "sign-in/admin-pin" | "email-otp/send-verification-otp" | "sign-in/email-otp" | "sign-out";
type PatientAction = Exclude<StaffAction, "sign-in/admin-pin">;

async function requestAuth(boundary: "patient" | "staff", action: StaffAction, body: object) {
  const response = await fetch(`/api/auth/${boundary}/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    credentials: "same-origin", cache: "no-store", body: JSON.stringify(body),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error ?? "Sign-in is temporarily unavailable. Please try again.");
  }
}

export function requestStaffAuth(action: StaffAction, body: object) { return requestAuth("staff", action, body); }
export function requestPatientAuth(action: PatientAction, body: object) { return requestAuth("patient", action, body); }
