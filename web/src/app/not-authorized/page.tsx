import { SITE_NAME } from "@/lib/site-brand";
import Link from "next/link";
import { Button, buttonClassName, Card } from "@/components/ui";
import { SignOutButton } from "@/components/sign-out";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NotAuthorized() {
  // A login without any company (e.g. made in the app, company never created)
  // can still create one.
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  const { count } = userId
    ? await supabase
        .from("org_members")
        .select("org_id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_active", true)
    : { count: null };
  const noCompany = Boolean(userId) && count === 0;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">{noCompany ? "No company yet" : "Not authorized"}</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          {noCompany
            ? "Your account isn't part of a company. Create one, or ask your company to invite this email."
            : `This dashboard is limited to ${SITE_NAME} admins and managers. Your account is signed in but doesn't have access.`}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <SignOutButton />
          {noCompany ? (
            <Link href="/signup" className={buttonClassName()}>
              Create a company
            </Link>
          ) : (
            <Link href="/login">
              <Button variant="subtle">Back to login</Button>
            </Link>
          )}
        </div>
      </Card>
    </main>
  );
}
