import { SITE_NAME, SITE_TITLE } from "@/lib/site-brand";
import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: `Jobs, photos, hours, and deals for ${SITE_NAME}.`,
};

// data-design pins the active theme. Themes 1–5 are defined in globals.css.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-design="1">
      <body>{children}</body>
    </html>
  );
}
