import {
  FinancialFilterBar,
  type FinancialFilters,
} from "@/components/financial-filter-bar";
import { FinancialTransactionsTable } from "@/components/financial-transactions-table";
import {
  FinancialMonthlyChart,
  type FinancialMonthPoint,
} from "@/components/financial-charts";
import { PageHeader, Kpi } from "@/components/kpi";
import { Badge, Card, CardHeader, Stat, StatGrid } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import {
  getFinancialLedger,
  type FinancialAccount,
  type FinancialTransaction,
} from "@/lib/financials";
import { getTransactionSettlementStatus } from "@/lib/financial-settlement-status";
import { getCustomerInvoiceReconciliation } from "@/lib/job-accounting";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const money = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const shortMoney = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});

const percent = new Intl.NumberFormat("en-CA", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const labourCategories = new Set([
  "Colour consultation",
  "Labour",
  "Payroll",
  "Pressure washing",
  "Subcontractors",
  "Wages & salaries",
]);
const materialCategories = new Set(["Materials", "Paint & materials"]);
const advertisingCategories = new Set(["Advertising & marketing"]);

const monthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function isOneOf<const T extends readonly string[]>(
  value: string,
  options: T,
): value is T[number] {
  return options.includes(value);
}

function sum(
  transactions: FinancialTransaction[],
  field: "amount" | "tax_amount" | "net_amount",
) {
  return transactions.reduce(
    (total, transaction) => total + Number(transaction[field]),
    0,
  );
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatCostRatio(amount: number, revenue: number) {
  return revenue > 0 ? percent.format(amount / revenue) : "—";
}

function buildMonthlyData(
  transactions: FinancialTransaction[],
  year: number,
): FinancialMonthPoint[] {
  return monthNames.map((month, index) => {
    const monthKey = `${year}-${String(index + 1).padStart(2, "0")}`;
    const current = transactions.filter(
      (transaction) =>
        transaction.posted_on.startsWith(monthKey) && !transaction.is_transfer,
    );
    const revenue = sum(
      current.filter(
        (transaction) => transaction.transaction_type === "income",
      ),
      "net_amount",
    );
    const expenses = -sum(
      current.filter(
        (transaction) => transaction.transaction_type !== "income",
      ),
      "net_amount",
    );
    return {
      month,
      revenue: roundMoney(revenue),
      expenses: roundMoney(expenses),
      net: roundMoney(revenue - expenses),
    };
  });
}

function latestBalance(
  account: FinancialAccount,
  transactions: FinancialTransaction[],
) {
  return transactions.find(
    (transaction) =>
      transaction.financial_accounts.slug === account.slug &&
      transaction.running_balance != null,
  );
}

function formatAsOf(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function FinancialsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [, ledger, customerInvoiceRows, params] = await Promise.all([
    requireStaff(),
    getFinancialLedger(),
    getCustomerInvoiceReconciliation(),
    searchParams,
  ]);

  const years = [
    ...new Set(
      ledger.transactions.map((transaction) =>
        Number(transaction.posted_on.slice(0, 4)),
      ),
    ),
  ].sort((left, right) => right - left);
  const requestedYear = Number(firstParam(params.year));
  const defaultYear = years[0] ?? new Date().getFullYear();
  const year = years.includes(requestedYear) ? requestedYear : defaultYear;
  const requestedAccount = firstParam(params.account) || "all";
  const account =
    requestedAccount === "all" ||
    ledger.accounts.some((item) => item.slug === requestedAccount)
      ? requestedAccount
      : "all";
  const categories = [
    ...new Set(ledger.transactions.map((transaction) => transaction.category)),
  ].sort((left, right) => left.localeCompare(right, "en-CA"));
  const requestedCategory = firstParam(params.category) || "all";
  const category = categories.includes(requestedCategory)
    ? requestedCategory
    : "all";
  const subcontractors = [
    ...new Set(
      ledger.transactions
        .filter(
          (transaction) =>
            transaction.category === "Subcontractors" &&
            transaction.payment_verification?.recipient_status === "confirmed",
        )
        .map((transaction) => transaction.counterparty?.trim())
        .filter((subcontractor): subcontractor is string =>
          Boolean(subcontractor),
        ),
    ),
  ].sort((left, right) => left.localeCompare(right, "en-CA"));
  const requestedCounterparty = firstParam(params.counterparty) || "all";
  const counterparty = subcontractors.includes(requestedCounterparty)
    ? requestedCounterparty
    : "all";
  const query = firstParam(params.q).trim().slice(0, 120);
  const requestedStatus = firstParam(params.status) || "all";
  const statusOptions = [
    "all",
    "needs_review",
    "fully_matched",
    "custom",
  ] as const;
  const status = isOneOf(requestedStatus, statusOptions)
    ? requestedStatus
    : "all";
  const requestedTransactionType = firstParam(params.type) || "all";
  const transactionTypeOptions = [
    "all",
    "income",
    "expense",
    "transfer",
    "credit",
  ] as const;
  const transactionType = isOneOf(
    requestedTransactionType,
    transactionTypeOptions,
  )
    ? requestedTransactionType
    : "all";
  const requestedEvidence = firstParam(params.evidence) || "all";
  const evidenceOptions = ["all", "matched", "no_document", "missing"] as const;
  const evidence = isOneOf(requestedEvidence, evidenceOptions)
    ? requestedEvidence
    : "all";
  const filters: FinancialFilters = {
    year,
    account,
    category,
    counterparty,
    query,
    status,
    transactionType,
    evidence,
  };

  const periodTransactions = ledger.transactions.filter(
    (transaction) =>
      transaction.posted_on.startsWith(`${year}-`) &&
      (account === "all" || transaction.financial_accounts.slug === account),
  );
  const normalizedQuery = query.toLocaleLowerCase("en-CA");
  const displayedTransactions = periodTransactions.filter((transaction) => {
    const settlement = getTransactionSettlementStatus(transaction);
    const hasMatchedEvidence =
      Number(transaction.payment_verification?.total_allocated_amount ?? 0) > 0 ||
      transaction.evidence.some(
        (item) =>
          item.status === "confirmed" &&
          item.kind !== "no_document_required",
      );
    const hasNoDocumentRequired = transaction.evidence.some(
      (item) => item.kind === "no_document_required",
    );
    const isMissingEvidence = !hasMatchedEvidence && !hasNoDocumentRequired;
    const matchesStatus =
      status === "all" ||
      settlement.bucket === status;
    const matchesEvidence =
      evidence === "all" ||
      (evidence === "matched" && hasMatchedEvidence) ||
      (evidence === "no_document" && hasNoDocumentRequired) ||
      (evidence === "missing" && isMissingEvidence);

    return (
      (category === "all" || transaction.category === category) &&
      (counterparty === "all" || transaction.counterparty === counterparty) &&
      (transactionType === "all" ||
        transaction.transaction_type === transactionType) &&
      matchesStatus &&
      matchesEvidence &&
      (!normalizedQuery ||
        [
          transaction.counterparty,
          transaction.description,
          transaction.category,
          transaction.financial_accounts.name,
        ].some((value) =>
          String(value ?? "")
            .toLocaleLowerCase("en-CA")
            .includes(normalizedQuery),
        ))
    );
  });

  const operatingTransactions = periodTransactions.filter(
    (transaction) => !transaction.is_transfer,
  );
  const revenueTransactions = operatingTransactions.filter(
    (transaction) => transaction.transaction_type === "income",
  );
  const expenseTransactions = operatingTransactions.filter(
    (transaction) => transaction.transaction_type !== "income",
  );
  const netRevenue = roundMoney(sum(revenueTransactions, "net_amount"));
  const netExpenses = roundMoney(-sum(expenseTransactions, "net_amount"));
  const netIncome = roundMoney(sum(operatingTransactions, "net_amount"));
  const labourCost = roundMoney(
    -sum(
      expenseTransactions.filter((transaction) =>
        labourCategories.has(transaction.category),
      ),
      "net_amount",
    ),
  );
  const materialCost = roundMoney(
    -sum(
      expenseTransactions.filter((transaction) =>
        materialCategories.has(transaction.category),
      ),
      "net_amount",
    ),
  );
  const advertisingCost = roundMoney(
    -sum(
      expenseTransactions.filter((transaction) =>
        advertisingCategories.has(transaction.category),
      ),
      "net_amount",
    ),
  );
  const overheadCost = roundMoney(
    netExpenses - labourCost - materialCost - advertisingCost,
  );
  const inputTaxCredits = roundMoney(-sum(expenseTransactions, "tax_amount"));
  const yearInvoiceRows = customerInvoiceRows.filter(
    (invoice) => invoice.invoice_date?.startsWith(String(year)),
  );
  const customerInvoiceBeforeHst = roundMoney(
    yearInvoiceRows.reduce(
      (total, invoice) => total + invoice.billed_before_hst,
      0,
    ),
  );
  const customerInvoiceHst = roundMoney(
    yearInvoiceRows.reduce((total, invoice) => total + invoice.billed_hst, 0),
  );
  const customerInvoiceTotal = roundMoney(
    yearInvoiceRows.reduce(
      (total, invoice) => total + invoice.billed_after_hst,
      0,
    ),
  );
  const customerInvoiceBankCash = roundMoney(
    yearInvoiceRows.reduce(
      (total, invoice) => total + invoice.bank_cash_received,
      0,
    ),
  );
  const customerInvoiceReceivable = roundMoney(
    yearInvoiceRows.reduce(
      (total, invoice) => total + invoice.amount_receivable,
      0,
    ),
  );
  const customerProcessingFees = roundMoney(
    yearInvoiceRows.reduce(
      (total, invoice) => total + invoice.processing_fee_amount,
      0,
    ),
  );
  const unallocatedCustomerIncome = roundMoney(
    revenueTransactions
      .filter((transaction) => transaction.category === "Painting revenue")
      .reduce(
        (total, transaction) =>
          total +
          Number(transaction.customer_revenue_verification?.unallocated_amount ?? 0),
        0,
      ),
  );
  const monthlyData = buildMonthlyData(periodTransactions, year);

  const categoryTotals = [
    ...new Set(expenseTransactions.map((item) => item.category)),
  ]
    .map((name) => {
      const rows = expenseTransactions.filter((item) => item.category === name);
      return {
        name,
        count: rows.length,
        amount: roundMoney(-sum(rows, "net_amount")),
      };
    })
    .sort((left, right) => right.amount - left.amount);
  const largestExpense = Math.max(
    0,
    ...categoryTotals.map((item) => item.amount),
  );
  const settlementCounts = periodTransactions.reduce(
    (counts, transaction) => {
      counts[getTransactionSettlementStatus(transaction).bucket] += 1;
      return counts;
    },
    { fully_matched: 0, needs_review: 0, custom: 0 },
  );
  const fullyMatched = settlementCounts.fully_matched;
  const needsReview = settlementCounts.needs_review;
  const customResolved = settlementCounts.custom;

  return (
    <>
      <PageHeader
        title="Financials"
        subtitle="Consolidated chequing, e-transfer, TD Visa, and live bank-feed activity"
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {needsReview ? (
              <Badge tone="warn">Live feed · {needsReview} to review</Badge>
            ) : (
              <Badge tone="good">No unresolved reviews</Badge>
            )}
            {customResolved ? (
              <Badge tone="neutral">
                {customResolved} custom resolved
              </Badge>
            ) : null}
          </div>
        }
      />

      {needsReview ? (
        <Card className="mb-4 border-[var(--color-warn)] p-4">
          <div className="text-sm font-medium text-[var(--color-heading)]">
            Live bank activity through July 24, 2026
          </div>
          <div className="mt-1 text-sm text-[var(--color-muted)]">
            Balances and posted amounts are current. New categories and HST are
            provisional until reviewed; identifiable credit-card payments are
            excluded from income and expenses.
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi
          label="Bank income received"
          value={money.format(netRevenue)}
          hint="posted cash and credits · HST is not inferred"
          tone="good"
        />
        <Kpi
          label="Bank expenses paid"
          value={money.format(netExpenses)}
          hint={`${money.format(inputTaxCredits)} tax explicitly coded on bank rows`}
          tone="warn"
        />
        <Kpi
          label="Net bank movement"
          value={money.format(netIncome)}
          hint="operating cash basis · transfers excluded"
          tone={netIncome >= 0 ? "good" : "bad"}
        />
        <Kpi
          label="Unallocated customer income"
          value={money.format(unallocatedCustomerIncome)}
          hint="bank cash still needing an invoice link"
          tone={unallocatedCustomerIncome > 0 ? "warn" : "good"}
        />
        <Kpi
          label="Ledger coverage"
          value={periodTransactions.length}
          hint={`${fullyMatched} fully matched · ${needsReview} to review · ${customResolved} custom`}
          tone={needsReview === 0 ? "good" : "warn"}
        />
      </div>

      <Card className="mt-4 overflow-hidden">
        <CardHeader
          title={`${year} customer invoice reconciliation`}
          subtitle="Invoice amounts use invoice date; bank income above uses bank posting date, so timing differences remain visible"
        />
        <StatGrid columns={4}>
          <Stat
            label="Invoices before HST"
            value={money.format(customerInvoiceBeforeHst)}
            hint={`${yearInvoiceRows.length} customer invoices`}
          />
          <Stat
            label="HST billed"
            value={money.format(customerInvoiceHst)}
            hint="from archived customer invoices"
          />
          <Stat
            label="Invoice total"
            value={money.format(customerInvoiceTotal)}
            hint="before HST + HST"
          />
          <Stat
            label="Bank cash linked"
            value={money.format(customerInvoiceBankCash)}
            hint={`${money.format(customerProcessingFees)} processing fees · ${money.format(customerInvoiceReceivable)} open`}
          />
        </StatGrid>
      </Card>

      <div className="my-4">
        <div className="mb-2">
          <h2 className="font-display text-sm font-semibold text-[var(--color-heading)]">
            Cost & profit percentages
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">
            Share of bank income received · cash basis · overhead excludes
            labour, materials, and advertising
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Kpi
            label="Labour %"
            value={formatCostRatio(labourCost, netRevenue)}
            hint={`${money.format(labourCost)} labour`}
          />
          <Kpi
            label="Materials %"
            value={formatCostRatio(materialCost, netRevenue)}
            hint={`${money.format(materialCost)} materials`}
          />
          <Kpi
            label="Advertising & marketing %"
            value={formatCostRatio(advertisingCost, netRevenue)}
            hint={`${money.format(advertisingCost)} advertising & marketing`}
          />
          <Kpi
            label="Overhead %"
            value={formatCostRatio(overheadCost, netRevenue)}
            hint={`${money.format(overheadCost)} other operating costs`}
          />
          <Kpi
            label="Profit %"
            value={formatCostRatio(netIncome, netRevenue)}
            hint={`${money.format(netIncome)} net income`}
          />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(360px,1fr)]">
        <Card>
          <CardHeader
            title={`${year} monthly performance`}
            subtitle="Before HST · transfers excluded"
          />
          <div className="p-4">
            <FinancialMonthlyChart data={monthlyData} />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Expense categories"
            subtitle={`${shortMoney.format(netExpenses)} before HST`}
          />
          <div className="space-y-4 p-5">
            {categoryTotals.map((item) => (
              <div key={item.name}>
                <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium text-[var(--color-heading)]">
                      {item.name}
                    </span>
                    <span className="ml-2 text-xs text-[var(--color-muted)]">
                      {item.count}
                    </span>
                  </div>
                  <span className="shrink-0 font-medium tabular-nums">
                    {money.format(item.amount)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-chip-muted)]">
                  <div
                    className="h-full rounded-full bg-[var(--color-brand)]"
                    style={{
                      width: `${largestExpense > 0 ? Math.max(2, (item.amount / largestExpense) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
            {!categoryTotals.length ? (
              <div className="py-8 text-center text-sm text-[var(--color-muted)]">
                No expense activity for this period.
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="my-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {ledger.accounts.map((financialAccount) => {
          const statementBalance = latestBalance(
            financialAccount,
            ledger.transactions,
          );
          const hasLiveBalance = financialAccount.current_balance != null;
          const balance = hasLiveBalance
            ? Number(financialAccount.current_balance)
            : statementBalance?.running_balance != null
              ? Number(statementBalance.running_balance)
              : null;
          const balanceAsOf = financialAccount.balance_as_of
            ? financialAccount.balance_as_of.slice(0, 10)
            : statementBalance?.posted_on;
          const isCard = financialAccount.account_type === "credit_card";
          return (
            <Card key={financialAccount.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
                    {isCard ? "Credit card" : "Bank account"}
                  </div>
                  <div className="mt-1 font-medium text-[var(--color-heading)]">
                    {financialAccount.name}
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                    {financialAccount.institution} · ••••{" "}
                    {financialAccount.last_four ?? "—"}
                  </div>
                </div>
                <Badge tone={balance != null ? "brand" : "neutral"}>
                  {
                    ledger.transactions.filter(
                      (item) =>
                        item.financial_accounts.slug === financialAccount.slug,
                    ).length
                  }{" "}
                  rows
                </Badge>
              </div>
              <div className="mt-4 font-display text-2xl font-semibold tabular-nums text-[var(--color-heading)]">
                {balance != null ? money.format(balance) : "—"}
              </div>
              <div className="mt-1 text-xs text-[var(--color-muted)]">
                {balanceAsOf
                  ? `${isCard ? "Balance owed" : hasLiveBalance ? "Current balance" : "Closing balance"} · ${formatAsOf(balanceAsOf)}`
                  : "No running balance supplied"}
              </div>
            </Card>
          );
        })}
      </div>

      <FinancialFilterBar
        filters={filters}
        years={years}
        accounts={ledger.accounts}
        categories={categories}
        subcontractors={subcontractors}
      />

      <FinancialTransactionsTable
        transactions={displayedTransactions}
        totalForPeriod={periodTransactions.length}
      />
    </>
  );
}
