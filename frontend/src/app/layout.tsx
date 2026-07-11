import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CourtFlow", template: "%s · CourtFlow" },
  description: "Enterprise padel court management platform",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
