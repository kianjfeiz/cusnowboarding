import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

/**
 * Imported for its side effect: this is what actually runs the env schema.
 *
 * Until it was imported somewhere, `createEnv` never executed and every
 * production guard in it was dead code - including the one that keeps a
 * deployment without RESEND_API_KEY from printing every verification code and
 * pay link into the logs, and the minimum length on the secret that signs the
 * claim cookie. Do not remove this import.
 */
import "@/env";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  // Anchors the relative URLs Next generates for canonical and og: tags. Without
  // it a deployed build falls back to localhost, which is only visible once a
  // link is pasted somewhere that unfurls it.
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"),
  title: "CU Snowboarding",
  description: "Trip signups and payments for the CU Boulder snowboarding team.",
  // The site is shared by link within the team, not published.
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
