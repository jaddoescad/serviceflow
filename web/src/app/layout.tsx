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

// Runs before first paint so the saved theme never flashes. Staff pages default
// to dark (ThemeToggle saves the choice); customer pages always stay light.
const THEME_SCRIPT = `(function(){var t="dark";try{t=localStorage.getItem("theme")||t}catch(e){}if(!/^\\/(p|co|i|portal|u)\\//.test(location.pathname))document.documentElement.dataset.theme=t})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body><NavigationTiming />{children}</body>
    </html>
  );
}
