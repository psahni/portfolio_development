import { describe, expect, it } from "vitest";
import { patientDestination } from "@/modules/identity/patient-destination";

describe("patient sign-in destination", () => {
  it("retains the booking destination", () => { expect(patientDestination("/book")).toBe("/book"); });
  it.each([undefined, ["/book"], "https://example.com", "//example.com", "/admin", "/book?next=https://example.com", "/book/../admin", "\\\\example.com"])("rejects an unapproved destination %s", (value) => {
    expect(patientDestination(value)).toBe("/appointments");
  });
});
