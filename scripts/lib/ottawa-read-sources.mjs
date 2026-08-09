import {
  filterAllowedQuoPhoneNumberBody,
  requireAllowedQuoPhoneNumberId,
} from "./ottawa-quo-scope.mjs";

const QUO_BASE = "https://api.quo.com/v1";
const COMPANYCAM_BASE = "https://api.companycam.com/v2";

function boundedInteger(value, name, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  const number = Number(value);
  if (number < 1 || number > maximum) throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  return number;
}

function required(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function parseOptions(tokens) {
  const options = { positional: [] };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      options.positional.push(token);
      continue;
    }
    const name = token.slice(2);
    const value = tokens[++index];
    if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
    if (options[name] === undefined) options[name] = value;
    else options[name] = Array.isArray(options[name]) ? [...options[name], value] : [options[name], value];
  }
  return options;
}

export function buildSourceRequest(argv, env = process.env) {
  const [source, command, ...tokens] = argv;
  const options = parseOptions(tokens);

  if (source === "quo" && command === "phone-numbers") {
    return {
      source,
      url: new URL("phone-numbers", `${env.QUO_API_BASE || QUO_BASE}/`),
      headers: { Authorization: required(env.QUO_API_KEY, "QUO_API_KEY is required") },
      responseFilter: "approved-quo-phone-numbers",
    };
  }

  if (source === "quo" && command === "messages") {
    const phoneNumberId = requireAllowedQuoPhoneNumberId(
      required(options["phone-number-id"], "--phone-number-id is required"),
    );
    const participants = Array.isArray(options.participant)
      ? options.participant
      : options.participant ? [options.participant] : [];
    if (participants.length === 0) throw new Error("at least one --participant in E.164 format is required");
    if (participants.some((value) => !/^\+[1-9]\d{1,14}$/.test(value))) throw new Error("--participant must use E.164 format");
    const url = new URL("messages", `${env.QUO_API_BASE || QUO_BASE}/`);
    url.searchParams.set("phoneNumberId", phoneNumberId);
    for (const participant of participants) url.searchParams.append("participants", participant);
    url.searchParams.set("maxResults", String(boundedInteger(options.limit, "--limit", 50, 100)));
    if (options["created-after"]) url.searchParams.set("createdAfter", options["created-after"]);
    if (options["created-before"]) url.searchParams.set("createdBefore", options["created-before"]);
    if (options["page-token"]) url.searchParams.set("pageToken", options["page-token"]);
    return {
      source,
      url,
      headers: { Authorization: required(env.QUO_API_KEY, "QUO_API_KEY is required") },
    };
  }

  if (source === "companycam" && command === "project") {
    const projectId = required(options.positional[0], "companycam project requires a project id");
    if (options.positional.length !== 1) throw new Error("companycam project accepts one project id");
    return {
      source,
      url: new URL(`projects/${encodeURIComponent(projectId)}`, `${env.COMPANYCAM_API_BASE || COMPANYCAM_BASE}/`),
      headers: { Authorization: `Bearer ${required(env.COMPANYCAM_API_KEY, "COMPANYCAM_API_KEY is required")}` },
    };
  }

  if (source === "companycam" && command === "photos") {
    const projectId = required(options.positional[0], "companycam photos requires a project id");
    if (options.positional.length !== 1) throw new Error("companycam photos accepts one project id");
    const url = new URL(`projects/${encodeURIComponent(projectId)}/photos`, `${env.COMPANYCAM_API_BASE || COMPANYCAM_BASE}/`);
    url.searchParams.set("per_page", String(boundedInteger(options.limit, "--limit", 50, 100)));
    if (options.after) url.searchParams.set("after", options.after);
    if (options.before) url.searchParams.set("before", options.before);
    return {
      source,
      url,
      headers: { Authorization: `Bearer ${required(env.COMPANYCAM_API_KEY, "COMPANYCAM_API_KEY is required")}` },
    };
  }

  throw new Error("unknown read-only source command");
}

export async function fetchSource(request, fetchImpl = fetch) {
  const response = await fetchImpl(request.url, {
    method: "GET",
    headers: { Accept: "application/json", ...request.headers },
    redirect: "error",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`${request.source} request failed with HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const filteredBody = request.responseFilter === "approved-quo-phone-numbers"
    ? filterAllowedQuoPhoneNumberBody(body)
    : body;
  return {
    source: request.source,
    fetched_at: new Date().toISOString(),
    next_cursor: response.headers.get("x-next-cursor"),
    previous_cursor: response.headers.get("x-prev-cursor"),
    data: filteredBody,
  };
}
