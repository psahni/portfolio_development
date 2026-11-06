import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nuvortiq Smart Booking",
  description: "Thoughtful appointment booking for your clinic.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
