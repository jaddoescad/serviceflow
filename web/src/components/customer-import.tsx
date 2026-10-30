"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { findCustomerMatches, importCustomers, type ImportResult, type ImportRow } from "@/lib/actions/contacts";
import { parseCsv } from "@/lib/csv";
import type { CustomerListOptions } from "@/lib/customer-list";
import { ModalFooter, ProjectModal } from "./project-profile-panel";
import { FilterPills } from "./table-ui";
import { Button, Select, Tag, cn, type TagTone } from "./ui";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;
const CHUNK = 200;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FIELDS = [
  ["name", "Name", /^(full[\s_-]*)?name$|^(customer|client|contact)([\s_-]*name)?$/i],
  ["firstName", "First name", /^first([\s_-]*name)?$|^given/i],
  ["lastName", "Last name", /^last([\s_-]*name)?$|^surname|^family/i],
  ["email", "Email", /e-?mail/i],
  ["phone", "Phone", /phone|mobile|cell|^tel/i],
  ["street", "Street address", /^(street[\s_-]*)?address([\s_-]*(1|line[\s_-]*1))?$|^street/i],
  ["city", "City", /^(city|town)$/i],
  ["province", "Province / state", /^(province|state|region)$/i],
  ["postal", "Postal code", /postal|zip/i],
  ["source", "Lead source", /source|channel|referr/i],
] as const;

type Field = (typeof FIELDS)[number][0];
type Mapping = Record<Field, number>;
type Sheet = { fileName: string; headers: string[]; rows: string[][] };
type Status = "new" | "existing" | "repeat" | "invalid";
type PreviewRow = { row: ImportRow; status: Status; note: string };

const STATUS: Record<Status, [string, TagTone]> = {
  new: ["New", "green"],
  existing: ["Already a customer", "gray"],
  repeat: ["Repeated in file", "gray"],
  invalid: ["Can't import", "red"],
};

const phoneKey = (value: string) => {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : "";
};

function guessMapping(headers: string[]): Mapping {
  const used = new Set<number>();
  const mapping = {} as Mapping;
  for (const [field, , pattern] of FIELDS) {
    const index = headers.findIndex((header, position) => !used.has(position) && pattern.test(header.trim()));
    mapping[field] = index;
    if (index >= 0) used.add(index);
  }
  return mapping;
}

function toRow(cells: string[], mapping: Mapping): ImportRow {
  const cell = (field: Field) => (mapping[field] >= 0 ? (cells[mapping[field]] ?? "").trim() : "");
  const region = [cell("province"), cell("postal")].filter(Boolean).join(" ");
  return {
    id: crypto.randomUUID(),
    name: cell("name") || [cell("firstName"), cell("lastName")].filter(Boolean).join(" "),
    email: cell("email"),
    phone: cell("phone"),
    address: [cell("street"), cell("city"), region].filter(Boolean).join(", "),
    source: cell("source"),
  };
}

function invalidReason(row: ImportRow): string {
  if (!row.name) return "No name";
  if (row.name.length > 160) return "Name is too long";
  if (row.email && (!EMAIL.test(row.email) || row.email.length > 320)) return "Email is not valid";
  if (row.phone.length > 60 || row.address.length > 500 || row.source.length > 120) return "A value is too long";
  return "";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[13px] font-semibold text-[var(--color-heading)]">{title}</h3>
      {children}
    </section>
  );
}

const plural = (count: number, noun: string) => `${count.toLocaleString("en-CA")} ${noun}${count === 1 ? "" : "s"}`;

/** Header button and dialog for importing customers from a CSV file. */
export function CustomerImport({ options }: { options: CustomerListOptions }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Import
      </Button>
      {open ? <ImportDialog options={options} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ImportDialog({ options, onClose }: { options: CustomerListOptions; onClose: () => void }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const batchId = useRef(crypto.randomUUID());
  const [step, setStep] = useState<"file" | "map" | "preview" | "done">("file");
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [createDeals, setCreateDeals] = useState(false);
  const [stageId, setStageId] = useState(options.stages[0]?.id ?? "");
  const [sendDrips, setSendDrips] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [show, setShow] = useState<Status | "all">("all");
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const stage = options.stages.find((item) => item.id === stageId);
  const importing = progress !== null && step === "preview";

  async function readFile(file: File | undefined) {
    setError("");
    if (!file) return;
    if (file.size > MAX_BYTES) return setError("Choose a CSV file under 5 MB.");
    const [headers, ...rows] = parseCsv(await file.text());
    if (!headers || !rows.length) return setError("That file has no rows under its header row.");
    if (rows.length > MAX_ROWS) return setError(`Import up to ${MAX_ROWS.toLocaleString("en-CA")} rows at a time; split the file.`);
    setSheet({ fileName: file.name, headers: headers.map((header) => header.trim()), rows });
    setMapping(guessMapping(headers));
    setStep("map");
  }

  async function review() {
    if (!sheet || !mapping) return;
    setError("");
    setBusy(true);
    const rows = sheet.rows.map((cells) => toRow(cells, mapping));
    const emails = [...new Set(rows.map((row) => row.email.toLowerCase()).filter(Boolean))];
    const phones = [...new Set(rows.map((row) => phoneKey(row.phone)).filter(Boolean))];
    const found = await findCustomerMatches({ emails, phones }).catch(() => ({ error: "Could not check for duplicates. Try again." }));
    setBusy(false);
    if (!("matches" in found) || !found.matches) return setError(found.error ?? "Could not check for duplicates.");
    const byEmail = new Map(found.matches.filter((match) => match.email).map((match) => [match.email!, match.name]));
    const byPhone = new Map(found.matches.filter((match) => match.phoneKey).map((match) => [match.phoneKey!, match.name]));
    const seen = new Set<string>();
    setPreview(
      rows.map((row) => {
        const email = row.email.toLowerCase();
        const phone = phoneKey(row.phone);
        const reason = invalidReason(row);
        if (reason) return { row, status: "invalid", note: reason };
        const existing = (email && byEmail.get(email)) || (phone && byPhone.get(phone));
        if (existing) return { row, status: "existing", note: `Matches ${existing}` };
        const keys = [email && `e:${email}`, phone && `p:${phone}`].filter(Boolean) as string[];
        if (keys.some((key) => seen.has(key))) return { row, status: "repeat", note: "Same email or phone as an earlier row" };
        keys.forEach((key) => seen.add(key));
        return { row, status: "new", note: "" };
      }),
    );
    setShow("all");
    setStep("preview");
  }

  const counts = useMemo(() => {
    const totals: Record<Status, number> = { new: 0, existing: 0, repeat: 0, invalid: 0 };
    for (const item of preview) totals[item.status]++;
    return totals;
  }, [preview]);
  const toImport = useMemo(() => preview.filter((item) => item.status === "new").map((item) => item.row), [preview]);

  async function runImport() {
    setError("");
    const start = progress?.sent ?? 0;
    setProgress({ sent: start, total: toImport.length });
    const totals: ImportResult = result ?? { created: 0, duplicates: 0, invalid: 0, deals: 0 };
    for (let offset = start; offset < toImport.length; offset += CHUNK) {
      const response = await importCustomers({
        batchId: batchId.current,
        rows: toImport.slice(offset, offset + CHUNK),
        stageId: createDeals ? stageId || null : null,
        sendDrips: createDeals && sendDrips,
      }).catch(() => ({ error: "The connection dropped. Retry to continue; rows already imported are not repeated." }));
      if (!("result" in response) || !response.result) {
        setResult(totals);
        setError(response.error ?? "Could not import. Retry to continue.");
        return;
      }
      for (const key of Object.keys(totals) as (keyof ImportResult)[]) totals[key] += response.result[key];
      setProgress({ sent: Math.min(offset + CHUNK, toImport.length), total: toImport.length });
    }
    setResult(totals);
    setStep("done");
    router.refresh();
  }

  const close = () => {
    if (busy || (importing && !error)) return;
    if (result) router.refresh();
    onClose();
  };

  const visible = show === "all" ? preview : preview.filter((item) => item.status === show);

  return (
    <ProjectModal title="Import customers" subtitle={sheet?.fileName} wide onClose={close}>
      {step === "file" ? (
        <div className="p-5">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              void readFile(event.dataTransfer.files[0]);
            }}
            className={cn(
              "flex flex-col items-center gap-3 rounded-[var(--radius)] border border-dashed border-[var(--color-border-strong)] px-6 py-10 text-center",
              dragOver && "border-[var(--color-brand)] bg-[var(--color-brand-soft)]",
            )}
          >
            <p className="text-[13px] text-[var(--color-text)]">Drop a CSV file here, with column names in the first row.</p>
            <Button variant="secondary" onClick={() => fileInput.current?.click()}>
              Choose file
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => void readFile(event.target.files?.[0])}
            />
          </div>
          <ErrorLine error={error} />
        </div>
      ) : null}

      {step === "map" && sheet && mapping ? (
        <>
          <div className="space-y-5 p-5">
            <Section title={`Columns · ${plural(sheet.rows.length, "row")}`}>
              <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
                {FIELDS.map(([field, label]) => (
                  <div key={field} className="grid min-h-10 grid-cols-[140px_minmax(0,220px)_minmax(0,1fr)] items-center gap-3 py-1">
                    <span className="text-xs text-[var(--color-muted)]">{label}</span>
                    <Select
                      aria-label={label}
                      value={mapping[field]}
                      onChange={(event) => setMapping({ ...mapping, [field]: Number(event.target.value) })}
                      className="w-full"
                    >
                      <option value={-1}>—</option>
                      {sheet.headers.map((header, index) => (
                        <option key={index} value={index}>
                          {header || `Column ${index + 1}`}
                        </option>
                      ))}
                    </Select>
                    <span className="truncate text-xs text-[var(--color-faint)]">
                      {mapping[field] >= 0 ? sheet.rows[0]?.[mapping[field]] : ""}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
            <Section title="Deals">
              <label className="flex items-center gap-2 text-[13px] text-[var(--color-text)]">
                <input
                  type="checkbox"
                  checked={createDeals}
                  disabled={!options.stages.length}
                  onChange={(event) => setCreateDeals(event.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--color-primary)]"
                />
                Create a deal for each new customer
              </label>
              {createDeals ? (
                <div className="mt-2 space-y-2 pl-5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--color-muted)]">In</span>
                    <Select aria-label="Pipeline column" value={stageId} onChange={(event) => setStageId(event.target.value)} className="w-64">
                      {options.stages.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  {stage?.dripsEnabled ? (
                    <label className="flex items-center gap-2 text-[13px] text-[var(--color-text)]">
                      <input
                        type="checkbox"
                        checked={sendDrips}
                        onChange={(event) => setSendDrips(event.target.checked)}
                        className="h-3.5 w-3.5 accent-[var(--color-primary)]"
                      />
                      Send {stage.name} drips to these customers
                    </label>
                  ) : null}
                </div>
              ) : null}
            </Section>
            <ErrorLine error={error} />
          </div>
          <ModalFooter>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setSheet(null);
                setError("");
                setStep("file");
              }}
            >
              Back
            </Button>
            <Button disabled={busy || (mapping.name < 0 && mapping.firstName < 0 && mapping.lastName < 0)} onClick={() => void review()}>
              {busy ? "Checking for duplicates…" : "Review"}
            </Button>
          </ModalFooter>
        </>
      ) : null}

      {step === "preview" ? (
        <>
          <div className="space-y-3 p-5">
            <FilterPills
              label="Rows"
              value={show}
              onChange={(value) => setShow(value as Status | "all")}
              options={[
                { value: "all", label: `All ${preview.length.toLocaleString("en-CA")}` },
                ...(Object.keys(STATUS) as Status[])
                  .filter((status) => counts[status])
                  .map((status) => ({ value: status, label: `${STATUS[status][0]} ${counts[status].toLocaleString("en-CA")}` })),
              ]}
            />
            <div className="max-h-80 overflow-auto rounded-[var(--radius)] border border-[var(--color-border)]">
              <table className="w-full min-w-[680px] text-left text-[13px]">
                <thead>
                  <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:h-8 [&>th]:bg-[var(--color-surface)] [&>th]:px-3 [&>th]:text-xs [&>th]:font-medium [&>th]:text-[var(--color-muted)] [&>th]:shadow-[inset_0_-1px_0_var(--color-border)]">
                    <th>Name</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Address</th>
                    <th>Source</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.slice(0, 200).map(({ row, status, note }) => (
                    <tr
                      key={row.id}
                      className={cn(
                        "border-b border-[var(--color-border)] last:border-b-0 [&>td]:h-9 [&>td]:max-w-48 [&>td]:truncate [&>td]:px-3",
                        status !== "new" && "text-[var(--color-muted)]",
                      )}
                    >
                      <td className={status === "new" ? "font-medium text-[var(--color-heading)]" : undefined}>{row.name || "—"}</td>
                      <td>{row.email || "—"}</td>
                      <td className="whitespace-nowrap">{row.phone || "—"}</td>
                      <td>{row.address || "—"}</td>
                      <td>{row.source || "—"}</td>
                      <td title={note}>
                        <Tag tone={STATUS[status][1]}>{note || STATUS[status][0]}</Tag>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {visible.length > 200 ? (
              <p className="text-xs text-[var(--color-faint)]">First 200 of {visible.length.toLocaleString("en-CA")} rows shown.</p>
            ) : null}
            <p className="text-[13px] text-[var(--color-text)]">
              {toImport.length ? (
                <>
                  Adds {plural(toImport.length, "customer")}
                  {createDeals && stage ? ` and ${plural(toImport.length, "deal")} in ${stage.name}` : ""} to{" "}
                  <span className="font-semibold text-[var(--color-heading)]">{options.company.name}</span>
                  {createDeals && stage?.dripsEnabled ? (sendDrips ? ", with its drips on" : ", with drips paused") : ""}. Other rows are
                  skipped.
                </>
              ) : (
                "Every row is already a customer or can't be imported."
              )}
            </p>
            {progress ? (
              <p role="status" className="text-xs tabular-nums text-[var(--color-muted)]">
                Imported {progress.sent.toLocaleString("en-CA")} of {progress.total.toLocaleString("en-CA")}
              </p>
            ) : null}
            <ErrorLine error={error} />
          </div>
          <ModalFooter>
            <Button variant="secondary" disabled={importing} onClick={() => setStep("map")}>
              Back
            </Button>
            <Button disabled={!toImport.length || (importing && !error)} onClick={() => void runImport()}>
              {importing && !error ? "Importing…" : error && progress ? "Retry" : `Import ${plural(toImport.length, "customer")}`}
            </Button>
          </ModalFooter>
        </>
      ) : null}

      {step === "done" && result ? (
        <>
          <div className="p-5 text-[13px] text-[var(--color-text)]">
            <p>
              Imported {plural(result.created, "customer")}
              {result.deals ? ` and ${plural(result.deals, "deal")}` : ""} into {options.company.name}.
            </p>
            {result.duplicates || result.invalid ? (
              <p className="mt-1 text-[var(--color-muted)]">
                {[
                  result.duplicates ? `${plural(result.duplicates, "row")} matched an existing customer` : "",
                  result.invalid ? `${plural(result.invalid, "row")} couldn't be imported` : "",
                ]
                  .filter(Boolean)
                  .join("; ")}
                .
              </p>
            ) : null}
          </div>
          <ModalFooter>
            <Button onClick={close}>Done</Button>
          </ModalFooter>
        </>
      ) : null}
    </ProjectModal>
  );
}

function ErrorLine({ error }: { error: string }) {
  return error ? (
    <p role="alert" className="mt-3 rounded-[var(--radius-control)] bg-[var(--tag-red-bg)] px-3 py-2 text-[13px] text-[var(--tag-red-text)]">
      {error}
    </p>
  ) : null;
}
