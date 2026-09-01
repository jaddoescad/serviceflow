import { Badge, Card, CardHeader, StatusText, cn } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import type {
  AppointmentPeriodSegment,
  BusinessPulse as BusinessPulseData,
  MetricComparison,
  RateComparison,
} from "@/lib/business-pulse-metrics";

const integer = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });

function money(cents: number | null): string {
  return cents == null ? "—" : fmtMoney(cents / 100);
}

function percent(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function roas(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(2)}×`;
}

function multiplier(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(1)}×`;
}

function rateHint(label: string, rate: RateComparison): string {
  return `${label} ${percent(rate.current)} · prior ${percent(rate.previous)}`;
}

function shortDate(value: string): string {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function compactPeriod(start: string, end: string): string {
  const startDate = new Date(`${start}T12:00:00Z`);
  const endDate = new Date(`${end}T12:00:00Z`);
  const sameMonth =
    startDate.getUTCFullYear() === endDate.getUTCFullYear() &&
    startDate.getUTCMonth() === endDate.getUTCMonth();
  if (sameMonth) {
    return `${startDate.toLocaleDateString("en-CA", { month: "short", timeZone: "UTC" })} ${startDate.getUTCDate()}–${endDate.getUTCDate()}`;
  }
  return `${shortDate(start)}–${shortDate(end)}`;
}

function Delta({
  comparison,
  direction = "higher_better",
  suffix = "vs prior period",
}: {
  comparison: MetricComparison;
  direction?: "higher_better" | "lower_better" | "neutral";
  suffix?: string;
}) {
  const change = comparison.percentChange;
  if (change == null) {
    return (
      <span className="text-[var(--color-muted)]">
        New <span className="sr-only">with no prior-period baseline</span>
        <span aria-hidden="true">·</span> {suffix}
      </span>
    );
  }

  const rounded = Math.round(Math.abs(change));
  const improving =
    change === 0 || direction === "neutral"
      ? null
      : direction === "higher_better"
        ? change > 0
        : change < 0;
  const arrow = change > 0 ? "▲" : change < 0 ? "▼" : "•";
  const spokenDirection = change > 0 ? "up" : change < 0 ? "down" : "unchanged";

  return (
    <span
      className={cn(
        "font-medium",
        improving === true
          ? "text-[var(--color-good)]"
          : improving === false
            ? "text-[var(--color-bad)]"
            : "text-[var(--color-muted)]",
      )}
    >
      <span aria-hidden="true">{arrow} </span>
      <span className="sr-only">{spokenDirection} </span>
      {rounded}% <span className="font-normal text-[var(--color-muted)]">{suffix}</span>
    </span>
  );
}

function OutcomeCell({
  label,
  value,
  hint,
  comparison,
}: {
  label: string;
  value: string;
  hint: React.ReactNode;
  comparison?: MetricComparison;
}) {
  return (
    <div className="bg-[var(--color-surface)] px-5 py-5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </div>
      <div className="font-display mt-1.5 text-2xl font-semibold tabular-nums text-[var(--color-heading)]">
        {value}
      </div>
      <div className="mt-1 text-xs text-[var(--color-muted)]">
        {comparison ? <Delta comparison={comparison} /> : hint}
      </div>
    </div>
  );
}

function ActivityCell({
  label,
  value,
  comparison,
  hint,
  direction,
}: {
  label: string;
  value: string;
  comparison: MetricComparison;
  hint?: React.ReactNode;
  direction?: "higher_better" | "lower_better" | "neutral";
}) {
  return (
    <div className="bg-[var(--color-surface)] px-4 py-3.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </div>
      <div className="font-display mt-1 text-lg font-semibold tabular-nums text-[var(--color-heading)]">
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
        <Delta comparison={comparison} direction={direction} />
      </div>
      {hint ? <div className="mt-1 text-[11px] text-[var(--color-muted)]">{hint}</div> : null}
    </div>
  );
}

function CohortCell({
  label,
  value,
  hint,
  warn = false,
}: {
  label: string;
  value: string;
  hint: React.ReactNode;
  warn?: boolean;
}) {
  return (
    <div className="bg-[var(--color-surface-2)] px-4 py-3.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </div>
      <div
        className={cn(
          "font-display mt-1 text-lg font-semibold tabular-nums",
          warn ? "text-[var(--color-bad)]" : "text-[var(--color-heading)]",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-muted)]">{hint}</div>
    </div>
  );
}

function AppointmentRow({
  label,
  tone,
  segment,
}: {
  label: string;
  tone: "good" | "neutral";
  segment: AppointmentPeriodSegment;
}) {
  return (
    <tr className="border-t border-[var(--color-border)] first:border-0">
      <th scope="row" className="whitespace-nowrap px-3 py-2.5 text-left font-medium">
        <StatusText tone={tone}>{label}</StatusText>
      </th>
      <td className="px-3 py-2.5 text-right tabular-nums">{integer.format(segment.leads)}</td>
      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-[var(--color-heading)]">
        {integer.format(segment.proposals)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {integer.format(segment.acceptedJobs)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">{percent(segment.acceptanceRate)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{money(segment.bookedRevenueCents)}</td>
    </tr>
  );
}

export function BusinessPulse({ pulse }: { pulse: BusinessPulseData }) {
  const periodLabel = `${compactPeriod(pulse.currentPeriod.start, pulse.currentPeriod.end)} vs ${compactPeriod(pulse.previousPeriod.start, pulse.previousPeriod.end)}`;
  const freshest = [
    pulse.freshness.leads,
    pulse.freshness.proposals,
    pulse.freshness.meta,
    pulse.freshness.accounting,
    pulse.freshness.sales,
    pulse.freshness.setRate,
    pulse.freshness.closing,
  ]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(0) ?? null;

  return (
    <section aria-labelledby="business-pulse-title">
      <Card className="overflow-hidden">
        <CardHeader
          title={<span id="business-pulse-title">Business Pulse</span>}
          subtitle="Booked sales first, then this month's funnel and appointment conversion."
          right={<Badge tone="neutral">As of {fmtDate(pulse.asOf)}</Badge>}
        />

        <div className="grid gap-px bg-[var(--color-border)]">
          <OutcomeCell
            label={pulse.activity.salesBasis === "dripjobs_gross_sales" ? "DripJobs sales · incl. HST" : "Booked sales · before HST"}
            value={money(pulse.activity.salesCents.current)}
            comparison={pulse.activity.salesCents}
            hint={null}
          />
        </div>

        <div className="border-t border-[var(--color-border)]">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pb-2 pt-4">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">
              This month&apos;s activity
            </h4>
            <p className="text-[11px] text-[var(--color-muted)]">
              {periodLabel} · flow, not final results—most recent leads have not matured yet.
            </p>
          </div>
          <div className="grid gap-px bg-[var(--color-border)] sm:grid-cols-2 xl:grid-cols-6">
            <ActivityCell
              label="Meta spend"
              value={money(pulse.activity.metaSpendCents.current)}
              comparison={pulse.activity.metaSpendCents}
              direction="neutral"
              hint={`Current Meta CPL ${money(pulse.activity.metaCostPerLeadCents)}`}
            />
            <ActivityCell
              label="Contacts created"
              value={integer.format(pulse.activity.setRateContacts.current)}
              comparison={pulse.activity.setRateContacts}
            />
            <ActivityCell
              label="Booked contacts"
              value={integer.format(pulse.activity.setRateBookedContacts.current)}
              comparison={pulse.activity.setRateBookedContacts}
              hint={`${rateHint(
                pulse.activity.setRateBasis === "dripjobs_contact_cohort"
                  ? "DripJobs set rate"
                  : "Imported cohort set rate",
                pulse.activity.appointmentSetRate,
              )} · ${integer.format(pulse.activity.setRateBookedContacts.current)} booked / ${integer.format(pulse.activity.setRateContacts.current)} contacts`}
            />
            <ActivityCell
              label="Qualified proposals"
              value={integer.format(pulse.activity.proposals.current)}
              comparison={pulse.activity.proposals}
              hint={`${rateHint("Qualified proposal rate", pulse.activity.proposalRate)} · ${integer.format(pulse.activity.proposals.current)} / ${integer.format(pulse.activity.setRateContacts.current)} contacts`}
            />
            <ActivityCell
              label="Accepted proposals"
              value={integer.format(pulse.activity.acceptedProposals.current)}
              comparison={pulse.activity.acceptedProposals}
              hint={`${rateHint("Closing ratio", pulse.activity.acceptedProposalRate)} · ${integer.format(pulse.activity.acceptedProposals.current)} / ${integer.format(pulse.activity.proposals.current)} qualified`}
            />
            <ActivityCell
              label="Jobs Won"
              value={integer.format(pulse.activity.jobsWon.current)}
              comparison={pulse.activity.jobsWon}
              hint="Accepted proposals in period regardless of sent date; not the closing numerator"
            />
          </div>
        </div>

        <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-2)]">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-2 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">
                Monthly acquisition cost
              </h4>
              <Badge tone="brand">
                {compactPeriod(pulse.currentPeriod.start, pulse.currentPeriod.end)}
              </Badge>
            </div>
            <p className="text-[11px] text-[var(--color-muted)]">
              Spend and accepted jobs use the same dates.
            </p>
          </div>
          <div className="grid gap-px bg-[var(--color-border)] sm:grid-cols-2 xl:grid-cols-4">
            <CohortCell
              label="Meta CAC"
              value={money(pulse.economics.metaCacCents)}
              hint={`${money(pulse.economics.metaSpendCents)} Meta spend ÷ ${integer.format(pulse.economics.metaAcceptedJobs)} Meta-attributed jobs accepted this month`}
            />
            <CohortCell
              label="Blended CAC"
              value={money(pulse.economics.blendedCacCents)}
              hint={`Recorded marketing spend ÷ ${integer.format(pulse.economics.acceptedJobs)} all-channel jobs accepted this month`}
            />
            <CohortCell
              label="Booked ROAS"
              value={roas(pulse.economics.bookedRoas)}
              hint={`${money(pulse.economics.metaBookedRevenueCents)} from Meta-attributed jobs accepted this month ÷ Meta spend`}
              warn={pulse.economics.bookedRoas != null && pulse.economics.bookedRoas < 1}
            />
            <CohortCell
              label="Accepted jobs"
              value={integer.format(pulse.economics.acceptedJobs)}
              hint="Non-cancelled jobs accepted in the displayed month-to-date period"
            />
          </div>
        </div>

        <div className="border-t border-[var(--color-border)]">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pb-2 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">
                Does the appointment matter?
              </h4>
              <Badge tone="neutral">
                {compactPeriod(pulse.currentPeriod.start, pulse.currentPeriod.end)}
              </Badge>
            </div>
            <p className="text-[11px] text-[var(--color-muted)]">
              Operational same-period activity split by appointment history.
            </p>
          </div>
          <div className="overflow-x-auto px-5 pb-1">
            <table className="w-full min-w-[680px] text-xs">
              <caption className="sr-only">
                Month-to-date activity with and without a recorded appointment
              </caption>
              <thead className="bg-[var(--color-surface-2)] text-[var(--color-muted)]">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Path</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Leads</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold text-[var(--color-heading)]">Proposals sent · operational</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Jobs accepted · operational</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Same-period ratio</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Booked revenue</th>
                </tr>
              </thead>
              <tbody>
                <AppointmentRow
                  label="With appointment"
                  tone="good"
                  segment={pulse.appointments.withAppointment}
                />
                <AppointmentRow
                  label="No recorded appointment"
                  tone="neutral"
                  segment={pulse.appointments.withoutAppointment}
                />
              </tbody>
            </table>
          </div>
          <p className="px-5 pb-4 pt-2 text-[13px] text-[var(--color-text)]">
            In this operational view, the with-appointment accepted-job ratio is{" "}
            <span className="font-semibold text-[var(--color-heading)]">
              {multiplier(pulse.appointments.appointmentLift)}
            </span>{" "}
            the no-appointment ratio ·{" "}
            <span className="font-semibold text-[var(--color-heading)]">
              {percent(pulse.appointments.acceptedWithoutAppointmentShare)}
            </span>{" "}
            of accepted jobs had no recorded appointment.
          </p>
        </div>

        <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-3 text-[11px] leading-relaxed text-[var(--color-muted)]">
          Set rate divides booked contacts by contacts created. Qualified proposal rate divides
          qualified proposals by those contacts. Closing ratio divides accepted proposals from the
          same qualified-proposal cohort by qualified proposals. Jobs Won is separate because it
          includes accepted proposals in the selected period regardless of when the proposal was sent.
          Monthly CAC and ROAS use spend and accepted jobs from the same month-to-date period; they do
          not assign later closes back to the lead-created month. The appointment split uses this
          month-to-date period; proposals and accepted jobs are classified by whether DripJobs recorded
          an appointment before that event and are not the official DripJobs closing cohort. Booked
          revenue excludes HST. Blended CAC currently uses recorded Meta acquisition spend because it
          is the connected paid-marketing spend. CAC denominators are accepted, non-cancelled jobs—not
          leads.
          {freshest ? ` Oldest connected source refreshed ${fmtDateTime(freshest)}.` : ""}
        </div>
      </Card>
    </section>
  );
}
