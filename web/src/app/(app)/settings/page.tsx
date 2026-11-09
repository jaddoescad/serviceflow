import { redirect } from "next/navigation";
import { SETTINGS_PAGES } from "@/lib/settings-pages";

/** Settings opens on its first page. */
export default function SettingsPage() {
  redirect(`/settings/${SETTINGS_PAGES[0].id}`);
}
