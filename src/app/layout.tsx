import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { getUiTheme } from "@/platform/ui-theme";

const geist = localFont({ src: "./fonts/geist-latin.woff2", variable: "--font-geist", display: "swap", weight: "100 900" });

export const metadata: Metadata = {
  title: "Nuvortiq Smart Booking",
  description: "Thoughtful appointment booking for your clinic.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-theme={getUiTheme()} className={geist.variable}><body>{children}</body></html>;
}
