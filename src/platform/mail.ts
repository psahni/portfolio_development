export type LoginCode = { email: string; code: string };
export type PatientLoginCode = LoginCode;

export interface AuthMailer {
  sendPatientLoginCode(message: PatientLoginCode): Promise<void>;
  sendStaffLoginCode(message: LoginCode): Promise<void>;
}

// No console fallback: a misconfigured mail provider must never leak login codes.
export const unconfiguredMailer: AuthMailer = {
  async sendPatientLoginCode() {
    throw new Error("Patient email delivery is not configured.");
  },
  async sendStaffLoginCode() {
    throw new Error("Staff email delivery is not configured.");
  },
};
