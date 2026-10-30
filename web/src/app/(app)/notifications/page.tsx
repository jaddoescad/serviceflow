import { NotificationsView } from "@/components/notification-feed";
import { getNotifications } from "@/lib/actions/notifications";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const unreadOnly = (await searchParams).filter === "unread";
  const items = await getNotifications({ limit: 50, unreadOnly });
  return <NotificationsView key={String(unreadOnly)} initial={items} unreadOnly={unreadOnly} />;
}
