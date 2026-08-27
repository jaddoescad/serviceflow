import { createClient } from "@/lib/supabase/server";
import {
  buildCashProfit,
  type CashProfit,
  type CashTransactionRow,
} from "@/lib/cash-profit-metrics";
import type { MetricsPeriodSelection } from "@/lib/metrics-period";

export async function getCashProfit(selection: MetricsPeriodSelection): Promise<CashProfit> {
  const supabase = await createClient();
  const start = [selection.current.start, selection.previous.start].sort()[0]!;
  const end = [selection.current.end, selection.previous.end].sort().at(-1)!;
  const rows: CashTransactionRow[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id,posted_on,description,amount_cents,category,counterparty,transaction_type,is_transfer,review_status,updated_at")
      .gte("posted_on", start)
      .lte("posted_on", end)
      .order("posted_on", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`transactions: ${error.message}`);
    const page = (data ?? []) as CashTransactionRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return buildCashProfit(selection, rows);
}
