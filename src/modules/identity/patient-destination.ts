// Only known in-app destinations may survive patient sign-in.
export function patientDestination(value: unknown): "/book" | "/appointments" {
  return value === "/book" ? "/book" : "/appointments";
}
