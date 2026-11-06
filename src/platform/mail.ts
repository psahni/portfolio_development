export type PatientLoginCode = { email: string; code: string };

export interface AuthMailer {
  sendPatientLoginCode(message: PatientLoginCode): Promise<void>;
}

// No console fallback: a misconfigured mail provider must never leak login codes.
export const unconfiguredMailer: AuthMailer = {
  async sendPatientLoginCode() {
    throw new Error("Patient email delivery is not configured.");
  },
};
