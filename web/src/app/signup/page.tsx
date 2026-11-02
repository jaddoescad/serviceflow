"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthCard } from "@/components/auth-card";
import { Button, Field, Input } from "@/components/ui";

/** Same steps as the iOS and Android apps: an emailed 6-digit code creates the
 * login, then a password (the website signs in with one), then the company. */
type Step = "loading" | "details" | "code" | "password" | "company";

const SUBTITLES: Record<Step, string> = {
  loading: "",
  details: "Create an account for your company.",
  code: "Check your email.",
  password: "Choose a password.",
  company: "Name your company.",
};

function friendly(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("rate limit") || lower.includes("security purposes")) {
    return "Too many attempts. Wait a minute and try again.";
  }
  return message;
}

export default function SignUpPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("loading");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Someone already signed in (e.g. they made their login in the app) only
  // needs the company.
  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => setStep(data.user ? "company" : "details"));
  }, []);

  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const problem = await action();
      if (problem) setError(friendly(problem));
    } catch {
      setError("You're offline. Check your connection and try again.");
    }
    setBusy(false);
  }

  function sendCode(e: React.FormEvent) {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (!name.trim()) return setError("Enter your name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) return setError("Enter a valid email address.");
    run(async () => {
      const { error } = await createClient().auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: true, data: { full_name: name.trim() } },
      });
      if (error) return error.message;
      setEmail(address);
      setStep("code");
      return null;
    });
  }

  function resendCode() {
    run(async () => {
      const { error } = await createClient().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) return error.message;
      setNote("A new code is on its way.");
      return null;
    });
  }

  function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    run(async () => {
      const { error } = await createClient().auth.verifyOtp({ email, token: code, type: "email" });
      if (error) return /expired|invalid/i.test(error.message) ? "That code is wrong or expired." : error.message;
      setStep("password");
      return null;
    });
  }

  function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError("Use at least 8 characters.");
    run(async () => {
      const { error } = await createClient().auth.updateUser({ password });
      if (error) return error.message;
      setStep("company");
      return null;
    });
  }

  function createCompany(e: React.FormEvent) {
    e.preventDefault();
    const companyName = company.trim();
    if (companyName.length < 2) return setError("Enter your company's name.");
    if (companyName.length > 80) return setError("Use 80 characters or fewer.");
    run(async () => {
      const { error } = await createClient().rpc("create_company", { requested_name: companyName });
      if (error) return error.message;
      router.replace("/");
      router.refresh();
      return null;
    });
  }

  if (step === "loading") return <main className="min-h-screen" />;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <AuthCard subtitle={SUBTITLES[step]}>
        {step === "details" ? (
          <form onSubmit={sendCode} className="space-y-4">
            <Field label="Your name">
              <Input autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </Field>
            {error ? <p className="text-sm text-[var(--color-bad)]">{error}</p> : null}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Sending…" : "Email me a code"}
            </Button>
          </form>
        ) : step === "code" ? (
          <form onSubmit={verifyCode} className="space-y-4">
            <Field label={`6-digit code sent to ${email}`}>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="tracking-[0.3em]"
              />
            </Field>
            {error ? <p className="text-sm text-[var(--color-bad)]">{error}</p> : null}
            {note ? <p className="text-sm text-[var(--color-muted)]">{note}</p> : null}
            <Button type="submit" disabled={busy || code.length !== 6} className="w-full">
              {busy ? "Checking…" : "Continue"}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={resendCode} className="w-full">
              Send a new code
            </Button>
          </form>
        ) : step === "password" ? (
          <form onSubmit={savePassword} className="space-y-4">
            <Field label="Password (at least 8 characters)">
              <Input
                type="password"
                autoComplete="new-password"
                autoFocus
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {error ? <p className="text-sm text-[var(--color-bad)]">{error}</p> : null}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Saving…" : "Save password"}
            </Button>
          </form>
        ) : (
          <form onSubmit={createCompany} className="space-y-4">
            <Field label="Company name">
              <Input
                autoComplete="organization"
                autoFocus
                required
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </Field>
            {error ? <p className="text-sm text-[var(--color-bad)]">{error}</p> : null}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Creating…" : "Create company"}
            </Button>
          </form>
        )}
        {step === "details" ? (
          <p className="mt-4 text-center text-[13px] text-[var(--color-muted)]">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-[var(--color-heading)] hover:underline">
              Sign in
            </Link>
          </p>
        ) : null}
      </AuthCard>
    </main>
  );
}
