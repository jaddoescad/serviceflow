import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((rawLine) => rawLine.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        return [key, value];
      }),
  );
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing Supabase credentials");

const ids = process.argv.slice(2);
if (ids.length === 0) throw new Error("Pass one or more invoice ids");

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [invoiceResult, lineResult] = await Promise.all([
  db.from("labour_invoices").select("*").in("id", ids).order("invoice_date"),
  db
    .from("labour_invoice_lines")
    .select("*,labour_invoice_line_allocations(*)")
    .in("invoice_id", ids)
    .order("invoice_id")
    .order("line_number"),
]);
if (invoiceResult.error) throw invoiceResult.error;
if (lineResult.error) throw lineResult.error;

const outputRoot = path.resolve(repoRoot, "tmp/pdfs/invoice-document-inspection");
mkdirSync(outputRoot, { recursive: true });
for (const invoice of invoiceResult.data ?? []) {
  const extension = path.extname(invoice.storage_path) || ".bin";
  const outputPath = path.resolve(outputRoot, `${invoice.id}${extension}`);
  if (!existsSync(outputPath)) {
    const downloaded = await db.storage
      .from(invoice.storage_bucket)
      .download(invoice.storage_path);
    if (downloaded.error) throw downloaded.error;
    writeFileSync(outputPath, Buffer.from(await downloaded.data.arrayBuffer()));
  }
  invoice.downloaded_path = path.relative(repoRoot, outputPath);
  invoice.lines = (lineResult.data ?? []).filter(
    (line) => line.invoice_id === invoice.id,
  );
}

console.log(JSON.stringify(invoiceResult.data, null, 2));
