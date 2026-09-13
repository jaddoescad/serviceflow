import { SITE_NAME } from "@/lib/site-brand";
import Link from "next/link";
import { Button, Card } from "@/components/ui";
import { SignOutButton } from "@/components/sign-out";

export default function NotAuthorized() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Not authorized</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          This dashboard is limited to {SITE_NAME} admins and managers. Your account is signed
          in but doesn&apos;t have access.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <SignOutButton />
          <Link href="/login">
            <Button variant="subtle">Back to login</Button>
          </Link>
        </div>
      </Card>
    </main>
  );
}
