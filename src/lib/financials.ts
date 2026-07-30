import { createClient } from "@/lib/supabase/server";

export type FinancialAccount = {
  id: string;
  slug: string;
  institution: string;
  name: string;
  account_type: "chequing" | "savings" | "credit_card" | "cash" | "other";
  last_four: string | null;
  currency: string;
  is_active: boolean;
  current_balance: number | null;
  available_balance: number | null;
  credit_limit: number | null;
  balance_as_of: string | null;
};

export type FinancialImport = {
  id: string;
  original_filename: string;
  source_kind: string;
  period_start: string | null;
  period_end: string | null;
  row_count: number;
  imported_at: string;
};

export type FinancialTransaction = {
  id: string;
  posted_on: string;
  transaction_on: string;
  description: string;
  counterparty: string | null;
  amount: number;
  tax_amount: number;
  net_amount: number;
  currency: string;
  transaction_type: "income" | "expense" | "transfer" | "credit";
  category: string;
  is_transfer: boolean;
  review_status: "unreviewed" | "needs_review" | "reconciled";
  running_balance: number | null;
  financial_accounts: Pick<
    FinancialAccount,
    "id" | "slug" | "name" | "account_type" | "last_four"
  >;
  financial_imports: Pick<FinancialImport, "original_filename" | "source_kind">;
};

export type FinancialLedger = {
  accounts: FinancialAccount[];
  imports: FinancialImport[];
  transactions: FinancialTransaction[];
};

export async function getFinancialLedger(): Promise<FinancialLedger> {
  const supabase = await createClient();
  const fetchTransactions = async () => {
    const transactions: unknown[] = [];
    const pageSize = 1000;

    for (let page = 0; page < 20; page += 1) {
      const from = page * pageSize;
      const result = await supabase
        .from("financial_transactions")
        .select(
          `
            id,
            posted_on,
            transaction_on,
            description,
            counterparty,
            amount,
            tax_amount,
            net_amount,
            currency,
            transaction_type,
            category,
            is_transfer,
            review_status,
            running_balance,
            financial_accounts!inner (
              id,
              slug,
              name,
              account_type,
              last_four
            ),
            financial_imports!inner (
              original_filename,
              source_kind
            )
          `,
        )
        .order("posted_on", { ascending: false })
        .order("transaction_on", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + pageSize - 1);

      if (result.error) throw result.error;
      transactions.push(...(result.data ?? []));
      if ((result.data?.length ?? 0) < pageSize) return transactions;
    }

    throw new Error("Financial ledger exceeded the 20,000-row read limit.");
  };

  const [accountsResult, importsResult, transactions] = await Promise.all([
    supabase
      .from("financial_accounts")
      .select(
        "id,slug,institution,name,account_type,last_four,currency,is_active,current_balance,available_balance,credit_limit,balance_as_of",
      )
      .order("account_type", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("financial_imports")
      .select(
        "id,original_filename,source_kind,period_start,period_end,row_count,imported_at",
      )
      .order("period_start", { ascending: true, nullsFirst: false })
      .order("original_filename", { ascending: true }),
    fetchTransactions(),
  ]);

  if (accountsResult.error) throw accountsResult.error;
  if (importsResult.error) throw importsResult.error;

  return {
    accounts: (accountsResult.data ?? []) as FinancialAccount[],
    imports: (importsResult.data ?? []) as FinancialImport[],
    transactions: transactions as FinancialTransaction[],
  };
}
