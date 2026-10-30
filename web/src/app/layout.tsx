import { NavigationTiming } from "@/components/navigation-timing";
import { SITE_NAME, SITE_TITLE } from "@/lib/site-brand";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// The design tokens name Inter first; this makes it actually load.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: `Jobs, photos, hours, and deals for ${SITE_NAME}.`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body><NavigationTiming />{children}</body>
    </html>
  );
}
