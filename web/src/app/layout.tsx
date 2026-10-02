import { NavigationTiming } from "@/components/navigation-timing";
import { SITE_NAME, SITE_TITLE } from "@/lib/site-brand";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: `Jobs, photos, hours, and deals for ${SITE_NAME}.`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><NavigationTiming />{children}</body>
    </html>
  );
}
