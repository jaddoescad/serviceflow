"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestPortalAppointment, savePortalPreferences, setPortalLanguage } from "@/lib/actions/portal";
import {
  fmtPortalDate,
  fmtPortalDay,
  fmtPortalMoney,
  fmtPortalVisit,
  portalError,
  portalStrings,
  portalToday,
  type PortalStrings,
} from "@/lib/portal-i18n";
import {
  CHANNEL_MODES,
  VISIT_WINDOWS,
  type ChannelMode,
  type CustomerPortal,
  type PortalLanguage,
  type VisitWindow,
} from "@/lib/portal-types";
import { CustomerShell, NavIcon, type ShellNavIcon } from "./customer-shell";
import { Input, Select, Textarea, cn } from "./ui";

// Follows the DripJobs customer portal, in the frame the /p, /co and /i pages
// share (customer-shell.tsx): "My Proposals", "My Invoices"… in the sidebar
// and one white section card for the chosen view.

export type PortalView = "proposals" | "changeOrders" | "invoices" | "appointments" | "request" | "preferences";

const ICONS = {
  pin: "M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  chevron: "m9 18 6-6-6-6",
  checkCircle: "M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3",
  plus: "M12 5v14M5 12h14",
  x: "M18 6 6 18M6 6l12 12",
} as const;

function Icon({ name, className }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-4 w-4 shrink-0", className)}
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

const NAV: { view: PortalView; icon: ShellNavIcon }[] = [
  { view: "proposals", icon: "file" },
  { view: "changeOrders", icon: "swap" },
  { view: "invoices", icon: "receipt" },
  { view: "appointments", icon: "calendar" },
  { view: "request", icon: "calendarPlus" },
  { view: "preferences", icon: "mail" },
];

const GREEN_BUTTON =
  "inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#16a34a] px-5 text-[15px] font-semibold text-white shadow-sm outline-none transition-colors hover:bg-[#15803d] focus-visible:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50";
const FIELD = "h-10 w-full px-3 text-sm";

type Tone = "yellow" | "orange" | "green" | "red" | "gray" | "blue";
const PILL_TONES: Record<Tone, string> = {
  yellow: "bg-[#fef3c7] text-[#92400e]",
  orange: "bg-[#ffedd5] text-[#9a3412]",
  green: "bg-[#dcfce7] text-[#166534]",
  red: "bg-[#fee2e2] text-[#991b1b]",
  gray: "bg-[#f1f5f9] text-[#475569]",
  blue: "bg-[#dbeafe] text-[#1e40af]",
};
const STATUS_TONES: Record<string, Tone> = {
  sent: "yellow",
  accepted: "green",
  declined: "red",
  expired: "orange",
  cancelled: "gray",
  open: "blue",
  partial: "yellow",
  paid: "green",
  late: "red",
  void: "gray",
};

function StatusPill({ status, label }: { status: string; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide",
        PILL_TONES[STATUS_TONES[status] ?? "gray"],
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

/** A white card with the dark icon tile and title, like the document pages' sections. */
function Section({ icon, title, children }: { icon: ShellNavIcon; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-white p-4 sm:p-6">
      <h2 className="mb-4 flex items-center gap-3 text-[16px] font-semibold text-[var(--color-heading)]">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#111113] text-white">
          <NavIcon icon={icon} />
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-[#f8fafc] px-4 py-8 text-center text-[13px] text-[var(--color-muted)]">{children}</div>
  );
}

/** One proposal, change order or invoice; opens the document's own page. */
function DocumentRow({
  href,
  title,
  meta,
  amount,
  extra,
  status,
  statusLabel,
  viewLabel,
}: {
  href: string;
  title: string;
  meta: string;
  amount: string;
  extra?: string;
  status: string;
  statusLabel: string;
  viewLabel: string;
}) {
  return (
    <li>
      <a
        href={href}
        className="group flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-white px-4 py-3 outline-none transition-colors hover:border-[var(--color-border-strong)] hover:bg-[#fafafa] focus-visible:shadow-[var(--focus-ring)]"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 text-[15px] font-semibold text-[var(--color-heading)]">{title}</span>
            <StatusPill status={status} label={statusLabel} />
          </div>
          <div className="mt-0.5 text-[13px] text-[var(--color-muted)]">{meta}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[15px] font-semibold tabular-nums text-[var(--color-heading)]">{amount}</div>
          {extra ? <div className="text-xs tabular-nums text-[var(--color-muted)]">{extra}</div> : null}
        </div>
        <span className="hidden items-center gap-1 text-[13px] font-medium text-[var(--brand-accent)] sm:flex">
          {viewLabel}
          <Icon name="chevron" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
        <Icon name="chevron" className="h-4 w-4 text-[var(--color-faint)] sm:hidden" />
      </a>
    </li>
  );
}

function VisitRow({ title, when, place }: { title: string; when: string; place: string | null }) {
  return (
    <li className="flex gap-3 rounded-xl border border-[var(--color-border)] bg-white px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f1f5f9] text-[var(--brand-accent)]">
        <NavIcon icon="calendar" />
      </span>
      <div className="min-w-0 text-[13px] leading-5">
        <div className="text-[15px] font-semibold text-[var(--color-heading)]">{title}</div>
        <div className="text-[var(--color-text)]">{when}</div>
        {place ? (
          <div className="flex items-center gap-1 text-[var(--color-muted)]">
            <Icon name="pin" className="h-3.5 w-3.5" />
            <span className="truncate">{place}</span>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

type TimeRow = { key: number; date: string; window: VisitWindow };

function RequestForm({
  portal,
  token,
  lang,
  t,
}: {
  portal: CustomerPortal;
  token: string;
  lang: PortalLanguage;
  t: PortalStrings;
}) {
  const router = useRouter();
  const timeZone = portal.company.timezone;
  const [today] = useState(() => portalToday(timeZone));
  const [rows, setRows] = useState<TimeRow[]>([{ key: 0, date: "", window: "anytime" }]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function update(key: number, change: Partial<TimeRow>) {
    setRows(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const times = rows.filter((row) => row.date).map(({ date, window }) => ({ date, window }));
    if (!times.length && !note.trim()) {
      setError(t.request.needTime);
      return;
    }
    startTransition(async () => {
      setError("");
      const result = await requestPortalAppointment({ token, times, note });
      if (!result.ok) {
        setError(portalError(lang, result.error));
        return;
      }
      setSent(true);
      setRows([{ key: Date.now(), date: "", window: "anytime" }]);
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {sent ? (
        <p
          role="status"
          className="flex items-center gap-2.5 rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3 text-[13px] font-medium text-[#166534]"
        >
          <Icon name="checkCircle" className="h-5 w-5 text-[#16a34a]" />
          {t.request.sent}
        </p>
      ) : null}
      <form onSubmit={submit} className="space-y-4">
        <p className="text-[13px] text-[var(--color-muted)]">{t.request.intro}</p>
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.key} className="flex items-end gap-2">
              <label className="block min-w-0 flex-1">
                <span className="mb-1 block text-xs font-medium text-[var(--color-muted)]">{t.request.date}</span>
                <Input
                  type="date"
                  min={today}
                  max={addDays(today, 180)}
                  value={row.date}
                  onChange={(event) => update(row.key, { date: event.target.value })}
                  className={FIELD}
                />
              </label>
              <label className="block min-w-0 flex-1">
                <span className="mb-1 block text-xs font-medium text-[var(--color-muted)]">{t.request.time}</span>
                <Select
                  value={row.window}
                  onChange={(event) => update(row.key, { window: event.target.value as VisitWindow })}
                  className={cn(FIELD, "pl-3")}
                >
                  {VISIT_WINDOWS.map((window) => (
                    <option key={window} value={window}>
                      {t.windows[window]}
                    </option>
                  ))}
                </Select>
              </label>
              {rows.length > 1 ? (
                <button
                  type="button"
                  aria-label={t.request.removeTime}
                  onClick={() => setRows(rows.filter((other) => other.key !== row.key))}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--color-muted)] outline-none hover:bg-[var(--color-hover)] focus-visible:shadow-[var(--focus-ring)]"
                >
                  <Icon name="x" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {rows.length < 3 ? (
          <button
            type="button"
            onClick={() => setRows([...rows, { key: Date.now(), date: "", window: "anytime" }])}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--brand-accent)] hover:underline"
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
            {t.request.addTime}
          </button>
        ) : null}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--color-muted)]">{t.request.note}</span>
          <Textarea
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="px-3 py-2 text-sm"
          />
        </label>
        {error ? (
          <p role="alert" className="text-[13px] text-[var(--color-bad)]">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={pending} className={cn(GREEN_BUTTON, "w-full sm:w-auto")}>
          <NavIcon icon="calendarPlus" />
          {pending ? t.request.sending : t.request.send}
        </button>
      </form>

      {portal.requests.length ? (
        <div className="border-t border-[var(--color-border)] pt-4">
          <h3 className="mb-2 text-sm font-semibold text-[var(--color-heading)]">{t.request.recent}</h3>
          <ul className="space-y-2">
            {portal.requests.map((request) => (
              <li key={request.createdAt} className="rounded-xl bg-[#f8fafc] px-4 py-3 text-[13px] leading-5">
                <div className="text-xs text-[var(--color-muted)]">
                  {t.request.sentOn(fmtPortalDate(lang, request.createdAt, timeZone))}
                </div>
                {request.preferredTimes.length ? (
                  <div className="text-[var(--color-heading)]">
                    {request.preferredTimes
                      .map((time) => `${fmtPortalDay(lang, time.date)} · ${t.windows[time.window]}`)
                      .join("; ")}
                  </div>
                ) : null}
                {request.note ? (
                  <div className="whitespace-pre-line text-[var(--color-text)]">{request.note}</div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Preferences({
  portal,
  token,
  lang,
  t,
}: {
  portal: CustomerPortal;
  token: string;
  lang: PortalLanguage;
  t: PortalStrings;
}) {
  const router = useRouter();
  const [modes, setModes] = useState(portal.preferences);
  const [status, setStatus] = useState<{ error?: string; saved?: boolean }>({});
  const [pending, startTransition] = useTransition();
  const channels = (["email", "sms"] as const).filter((channel) =>
    channel === "email" ? !!portal.customer.email : !!portal.customer.phone,
  );
  const changed = modes.email !== portal.preferences.email || modes.sms !== portal.preferences.sms;

  if (!channels.length) return <Empty>{t.preferences.noChannels}</Empty>;

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          setStatus({});
          const result = await savePortalPreferences({ token, ...modes });
          if (!result.ok) {
            setStatus({ error: portalError(lang, result.error) });
            return;
          }
          setStatus({ saved: true });
          router.refresh();
        });
      }}
    >
      <p className="text-[13px] text-[var(--color-muted)]">{t.preferences.intro(portal.company.name)}</p>
      {channels.map((channel) => (
        <fieldset key={channel}>
          <legend className="mb-2 text-sm font-semibold text-[var(--color-heading)]">
            {t.preferences[channel]}
            <span className="ml-2 font-normal text-[var(--color-muted)]">
              {channel === "email" ? portal.customer.email : portal.customer.phone}
            </span>
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {CHANNEL_MODES.map((mode) => (
              <label
                key={mode}
                className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 transition-colors hover:border-[var(--color-border-strong)] has-[:checked]:border-[var(--brand-accent)] has-[:checked]:bg-[#f8fafc] has-[:focus-visible]:shadow-[var(--focus-ring)]"
              >
                <input
                  type="radio"
                  name={`mode-${channel}`}
                  value={mode}
                  checked={modes[channel] === mode}
                  onChange={() => {
                    setModes({ ...modes, [channel]: mode as ChannelMode });
                    setStatus({});
                  }}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand-accent)]"
                />
                <span className="min-w-0 text-[13px] leading-5">
                  <span className="block font-medium text-[var(--color-heading)]">{t.modes[mode].label}</span>
                  <span className="block text-[var(--color-muted)]">{t.modes[mode].hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || !changed} className={GREEN_BUTTON}>
          {pending ? t.preferences.saving : t.preferences.save}
        </button>
        {status.error ? (
          <span role="alert" className="text-[13px] text-[var(--color-bad)]">
            {status.error}
          </span>
        ) : status.saved && !changed ? (
          <span role="status" className="text-[13px] font-medium text-[#15803d]">
            {t.preferences.saved}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function firstView(portal: CustomerPortal): PortalView {
  if (portal.proposals.length) return "proposals";
  if (portal.invoices.length) return "invoices";
  if (portal.appointments.length || portal.projects.length) return "appointments";
  return "proposals";
}

/** A customer's own page from their private link. */
export function CustomerPortalView({
  portal,
  token,
  initialLanguage,
  initialView,
}: {
  portal: CustomerPortal;
  token: string;
  initialLanguage: PortalLanguage;
  initialView: PortalView | null;
}) {
  const [lang, setLang] = useState(initialLanguage);
  const [view, setView] = useState<PortalView>(initialView ?? firstView(portal));
  const t = portalStrings(lang);
  const { company } = portal;
  const timeZone = company.timezone;
  const nav = NAV.filter((item) => item.view !== "changeOrders" || portal.changeOrders.length || view === item.view);
  const current = NAV.find((item) => item.view === view) ?? NAV[0];
  const first = portal.customer.name.split(/\s+/)[0] ?? "";

  useEffect(() => {
    document.documentElement.lang = lang === "fr" ? "fr-CA" : "en";
  }, [lang]);

  function show(next: PortalView) {
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState(null, "", url);
    window.scrollTo({ top: 0 });
  }

  function chooseLanguage(next: PortalLanguage) {
    if (next === lang) return;
    setLang(next);
    void setPortalLanguage({ token, language: next });
  }

  return (
    <CustomerShell
      company={company}
      language={lang}
      languageLabel={t.language}
      onLanguage={chooseLanguage}
      callLabel={t.call}
      menuLabel={t.menu}
      nav={nav.map((item) => ({
        key: item.view,
        label: t.nav[item.view],
        icon: item.icon,
        active: item.view === view,
        onSelect: () => show(item.view),
      }))}
      mainClassName="pt-20"
    >
          <h1 className="text-[22px] font-semibold leading-8 text-[var(--color-heading)]">{t.greeting(first)}</h1>

          <Section icon={current.icon} title={t.nav[current.view]}>
            {view === "proposals" ? (
              portal.proposals.length ? (
                <ul className="space-y-2">
                  {portal.proposals.map((proposal) => (
                    <DocumentRow
                      key={proposal.token}
                      href={`/p/${proposal.token}`}
                      title={proposal.name || t.proposal}
                      meta={[proposal.address, proposal.sentAt ? t.sent(fmtPortalDate(lang, proposal.sentAt, timeZone)) : null]
                        .filter(Boolean)
                        .join(" · ")}
                      amount={fmtPortalMoney(lang, proposal.totalCents)}
                      status={proposal.status}
                      statusLabel={t.proposalStatus[proposal.status]}
                      viewLabel={t.view}
                    />
                  ))}
                </ul>
              ) : (
                <Empty>{t.empty.proposals}</Empty>
              )
            ) : null}

            {view === "changeOrders" ? (
              portal.changeOrders.length ? (
                <ul className="space-y-2">
                  {portal.changeOrders.map((order) => (
                    <DocumentRow
                      key={order.token}
                      href={`/co/${order.token}`}
                      title={`${t.changeOrder(order.number)} · ${order.name}`}
                      meta={order.sentAt ? t.sent(fmtPortalDate(lang, order.sentAt, timeZone)) : ""}
                      amount={fmtPortalMoney(lang, order.totalCents)}
                      status={order.status}
                      statusLabel={t.changeOrderStatus[order.status]}
                      viewLabel={t.view}
                    />
                  ))}
                </ul>
              ) : (
                <Empty>{t.empty.changeOrders}</Empty>
              )
            ) : null}

            {view === "invoices" ? (
              portal.invoices.length ? (
                <ul className="space-y-2">
                  {portal.invoices.map((invoice) => (
                    <DocumentRow
                      key={invoice.token}
                      href={`/i/${invoice.token}`}
                      title={`${t.invoice(invoice.number)} · ${invoice.name}`}
                      meta={
                        invoice.dueOn && invoice.status !== "paid" && invoice.status !== "void"
                          ? t.due(fmtPortalDay(lang, invoice.dueOn))
                          : invoice.sentAt
                            ? t.sent(fmtPortalDate(lang, invoice.sentAt, timeZone))
                            : ""
                      }
                      amount={fmtPortalMoney(lang, invoice.totalCents)}
                      extra={
                        invoice.status === "partial" || invoice.status === "late"
                          ? `${t.balance} ${fmtPortalMoney(lang, invoice.balanceCents)}`
                          : undefined
                      }
                      status={invoice.status}
                      statusLabel={t.invoiceStatus[invoice.status]}
                      viewLabel={t.view}
                    />
                  ))}
                </ul>
              ) : (
                <Empty>{t.empty.invoices}</Empty>
              )
            ) : null}

            {view === "appointments" ? (
              portal.appointments.length || portal.projects.length ? (
                <ul className="space-y-2">
                  {portal.appointments.map((appointment) => (
                    <VisitRow
                      key={appointment.startsAt}
                      title={t.appointmentKind[appointment.kind]}
                      when={fmtPortalVisit(lang, appointment.startsAt, appointment.endsAt, timeZone)}
                      place={appointment.location}
                    />
                  ))}
                  {portal.projects.map((project) => (
                    <VisitRow
                      key={`${project.startOn}-${project.address}`}
                      title={t.projectVisit}
                      when={
                        project.endOn && project.endOn !== project.startOn
                          ? `${fmtPortalDay(lang, project.startOn)} – ${fmtPortalDay(lang, project.endOn)}`
                          : fmtPortalDay(lang, project.startOn)
                      }
                      place={project.address}
                    />
                  ))}
                </ul>
              ) : (
                <Empty>
                  <p>{t.empty.appointments}</p>
                  <button
                    type="button"
                    onClick={() => show("request")}
                    className="mt-2 font-medium text-[var(--brand-accent)] hover:underline"
                  >
                    {t.requestAnother}
                  </button>
                </Empty>
              )
            ) : null}

            {view === "request" ? <RequestForm portal={portal} token={token} lang={lang} t={t} /> : null}
            {view === "preferences" ? <Preferences portal={portal} token={token} lang={lang} t={t} /> : null}
          </Section>
    </CustomerShell>
  );
}
