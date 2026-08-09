const COMMANDS = Object.freeze({
  briefing: { functionName: "hermes_briefing", positional: false, days: true, defaultLimit: 20 },
  labour: { functionName: "hermes_labour", positional: false, date: true, defaultLimit: 100 },
  job: { functionName: "hermes_job_360", positional: true, defaultLimit: 10 },
  customer: { functionName: "hermes_customer_360", positional: true, defaultLimit: 10 },
  followups: { functionName: "hermes_followups", positional: false, days: true, defaultLimit: 50 },
  readiness: { functionName: "hermes_job_readiness", positional: false, days: true, defaultLimit: 50 },
  cash: { functionName: "hermes_cash_summary", positional: false, defaultLimit: 50 },
  "data-quality": { functionName: "hermes_data_quality", positional: false, defaultLimit: 50 },
});

export const HELP = `Ottawa Painters read-only operations reports

Usage:
  ottawa briefing [--days 14] [--limit 20] [--json]
  ottawa labour [--date yesterday|today|YYYY-MM-DD] [--limit 100] [--json]
  ottawa job <name|address|email|phone|uuid> [--limit 10] [--json]
  ottawa customer <name|email|phone|uuid> [--limit 10] [--json]
  ottawa customer-brief <name|email|phone|uuid> [--max-evidence 30] [--timeout-ms 6500] [--json]
  ottawa followups [--days 7] [--limit 50] [--json]
  ottawa readiness [--days 14] [--limit 50] [--json]
  ottawa cash [--limit 50] [--json]
  ottawa data-quality [--limit 50] [--json]

The standard reports make exactly one read-only database call. customer-brief
adds bounded parallel Gmail, Quo, and CompanyCam retrieval. Use ottawa-db
directly only when the user explicitly requests a deep audit or raw schema work.`;

function parseInteger(value, option, minimum, maximum) {
  if (!/^\d+$/.test(value ?? "")) {
    throw new Error(`${option} must be an integer between ${minimum} and ${maximum}`);
  }
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum) {
    throw new Error(`${option} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function sqlText(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function parseDateSpec(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "today" || normalized === "yesterday") return normalized;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error("--date must be today, yesterday, or YYYY-MM-DD");
  }
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new Error("--date must be a valid calendar date");
  }
  return normalized;
}

export function parseReportArgs(argv) {
  const [command, ...tokens] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    return { help: true };
  }

  const definition = COMMANDS[command];
  if (!definition) {
    throw new Error(`Unknown command: ${command}`);
  }

  const options = { command, json: false, limit: definition.defaultLimit };
  const positional = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--json") {
      options.json = true;
    } else if (token === "--limit") {
      options.limit = parseInteger(tokens[++index], "--limit", 1, 200);
    } else if (token === "--days") {
      if (!definition.days) throw new Error(`${command} does not accept --days`);
      options.days = parseInteger(tokens[++index], "--days", 1, 90);
    } else if (token === "--date") {
      if (!definition.date) throw new Error(`${command} does not accept --date`);
      options.date = parseDateSpec(tokens[++index]);
    } else if (token.startsWith("-")) {
      throw new Error(`Unknown option: ${token}`);
    } else {
      positional.push(token);
    }
  }

  if (definition.positional) {
    options.query = positional.join(" ").trim();
    if (!options.query) throw new Error(`${command} requires a search value`);
  } else if (positional.length > 0) {
    throw new Error(`${command} does not accept a search value`);
  }

  if (definition.days && options.days === undefined) {
    options.days = command === "followups" ? 7 : 14;
  }
  if (definition.date && options.date === undefined) options.date = "yesterday";
  return options;
}

export function buildReportSql(options) {
  const definition = COMMANDS[options.command];
  if (!definition) throw new Error(`Unknown command: ${options.command}`);

  let args;
  if (definition.positional) {
    args = `${sqlText(options.query)}, ${options.limit}`;
  } else if (definition.date) {
    args = `${sqlText(options.date)}, ${options.limit}`;
  } else if (definition.days) {
    args = `${options.days}, ${options.limit}`;
  } else {
    args = `${options.limit}`;
  }

  return `select public.${definition.functionName}(${args}) as report`;
}

export function buildOttawaDbInvocation(options, executable = process.env.OTTAWA_DB_CLI || "ottawa-db") {
  // ottawa-db treats output formatting as a global option, so it must precede
  // the query subcommand. Query-specific bounds remain after the SQL text.
  const args = options.json ? ["--json"] : [];
  args.push("query", buildReportSql(options), "--limit", "1");
  return { executable, args };
}
