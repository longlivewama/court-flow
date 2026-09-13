import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CourtFlow", template: "%s · CourtFlow" },
  description: "Enterprise padel court management platform",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
};

// Reading the per-request nonce here (set by middleware.ts) is what makes
// Next.js stamp it onto every script/style tag it injects, and is also what
// opts this route out of static rendering — required since the nonce (and
// thus the page output) differs on every request. Without this call, Next
// silently renders its scripts with no nonce at all and strict-dynamic
// blocks all of them.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await headers();

  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
