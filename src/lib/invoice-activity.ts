type InvoiceRecord = {
  invoiceNumber: string;
  invoiceDate: string;
  projects: Array<{
    name: string;
    hours?: number;
    wagesBeforeTax?: number;
  }>;
};

type ProjectInvoiceSummary = {
  latestActivity: string;
  invoicedHours: number;
  invoicedWagesBeforeTax: number;
};

// Jobs remain included by default. Keep this explicit allow-list mechanism for
// any future management-directed exclusions, but do not suppress legitimate
// budgets, clocked wages, or invoices.
const LABOUR_EXCLUDED_PROJECTS = new Set<string>();

// XDesign invoices verified from the downloaded PDFs and invoice 8599 supplied
// on July 13, 2026. Hours are left blank when a multi-job invoice does not say
// how its quantity is split between those jobs.
// A single invoice can record activity for more than one CompanyCam job.
const INVOICE_RECORDS: InvoiceRecord[] = [
  { invoiceNumber: "8584", invoiceDate: "2026-05-29", projects: [{ name: "Mike Ralph" }] },
  { invoiceNumber: "8585", invoiceDate: "2026-06-05", projects: [{ name: "Christian Boulet", hours: 47, wagesBeforeTax: 1410 }] },
  { invoiceNumber: "8586", invoiceDate: "2026-06-06", projects: [{ name: "Danielle Hards", hours: 11, wagesBeforeTax: 330 }] },
  { invoiceNumber: "8587", invoiceDate: "2026-06-10", projects: [{ name: "Mehaly Marinakis", hours: 19, wagesBeforeTax: 570 }] },
  { invoiceNumber: "8588", invoiceDate: "2026-06-12", projects: [{ name: "Donna Quigley", hours: 26, wagesBeforeTax: 780 }] },
  { invoiceNumber: "8589", invoiceDate: "2026-06-14", projects: [{ name: "Jen Payne", hours: 11, wagesBeforeTax: 330 }] },
  {
    invoiceNumber: "8590",
    invoiceDate: "2026-06-17",
    projects: [
      { name: "Tyler Duncan", hours: 17, wagesBeforeTax: 510 },
      { name: "Milana Karaganis", hours: 1, wagesBeforeTax: 30 },
    ],
  },
  { invoiceNumber: "8591", invoiceDate: "2026-06-27", projects: [{ name: "Georgesc Focsaneanu", hours: 50, wagesBeforeTax: 1500 }] },
  { invoiceNumber: "8592", invoiceDate: "2026-06-28", projects: [{ name: "Milana Karaganis", hours: 7, wagesBeforeTax: 210 }] },
  { invoiceNumber: "8593", invoiceDate: "2026-06-30", projects: [{ name: "Martin Huot", hours: 9, wagesBeforeTax: 270 }] },
  { invoiceNumber: "8594", invoiceDate: "2026-07-03", projects: [{ name: "Patrick Lenouvel", hours: 13, wagesBeforeTax: 390 }] },
  { invoiceNumber: "8595", invoiceDate: "2026-07-03", projects: [{ name: "Paul Toonders", hours: 20, wagesBeforeTax: 600 }] },
  { invoiceNumber: "8596", invoiceDate: "2026-07-07", projects: [{ name: "Diane Benoit", hours: 20, wagesBeforeTax: 600 }] },
  {
    invoiceNumber: "8597",
    invoiceDate: "2026-07-11",
    projects: [
      { name: "Paul Toonders" },
      { name: "Christine Leclair" },
      { name: "Diane Benoit" },
    ],
  },
  { invoiceNumber: "8598", invoiceDate: "2026-07-11", projects: [{ name: "Phil Anido", hours: 19, wagesBeforeTax: 570 }] },
  { invoiceNumber: "8599", invoiceDate: "2026-07-13", projects: [{ name: "Sheila McSwiggan", hours: 15, wagesBeforeTax: 450 }] },
];

const invoiceSummaryByProject = new Map<string, ProjectInvoiceSummary>();

for (const record of INVOICE_RECORDS) {
  // Noon UTC keeps a date-only invoice value on the same Ottawa calendar day.
  const invoiceActivity = `${record.invoiceDate}T12:00:00.000Z`;
  for (const project of record.projects) {
    const key = normalizeProjectName(project.name);
    const current = invoiceSummaryByProject.get(key) ?? {
      latestActivity: invoiceActivity,
      invoicedHours: 0,
      invoicedWagesBeforeTax: 0,
    };
    if (new Date(invoiceActivity) > new Date(current.latestActivity)) {
      current.latestActivity = invoiceActivity;
    }
    current.invoicedHours += project.hours ?? 0;
    current.invoicedWagesBeforeTax += project.wagesBeforeTax ?? 0;
    invoiceSummaryByProject.set(key, current);
  }
}

/** Latest activity from either crew time or a received invoice. */
export function latestProjectActivity(
  projectName: string,
  timeEntryActivity: string | null | undefined,
): string | null {
  const invoiceActivity = invoiceSummaryByProject.get(normalizeProjectName(projectName))?.latestActivity ?? null;
  if (!timeEntryActivity) return invoiceActivity;
  if (!invoiceActivity) return timeEntryActivity;
  return new Date(invoiceActivity) > new Date(timeEntryActivity) ? invoiceActivity : timeEntryActivity;
}

export function invoicedProjectHours(projectName: string): number {
  return invoiceSummaryByProject.get(normalizeProjectName(projectName))?.invoicedHours ?? 0;
}

/** Painter invoice subtotal for the job. HST is deliberately excluded. */
export function invoicedProjectWagesBeforeTax(projectName: string): number {
  return invoiceSummaryByProject.get(normalizeProjectName(projectName))?.invoicedWagesBeforeTax ?? 0;
}

/** Jobs whose labour figures were explicitly removed by management. */
export function isLabourExcludedProject(projectName: string): boolean {
  return LABOUR_EXCLUDED_PROJECTS.has(normalizeProjectName(projectName));
}

function normalizeProjectName(value: string): string {
  return value.trim().toLocaleLowerCase("en-CA");
}
