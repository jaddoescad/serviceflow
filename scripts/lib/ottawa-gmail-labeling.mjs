import { readFile } from "node:fs/promises";
import { googleAccessToken } from "./ottawa-customer-rag.mjs";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

function jsonError(response, body, action) {
  const apiMessage = typeof body?.error?.message === "string" ? `: ${body.error.message}` : "";
  return new Error(`${action} failed with HTTP ${response.status}${apiMessage}`);
}

function cleanSelector(value, name) {
  const selector = String(value ?? "").trim();
  if (!selector) throw new Error(`${name} is required`);
  if (selector.length > 225 || /[\u0000-\u001f\u007f]/.test(selector)) throw new Error(`${name} is invalid`);
  return selector;
}

export function parseLabelAllowlist(value) {
  return [...new Set(String(value ?? "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean))];
}

export function configuredGmailScopes(credential) {
  const raw = [credential?.scope, credential?.scopes]
    .flatMap((value) => Array.isArray(value) ? value : String(value ?? "").split(/[\s,]+/))
    .map((scope) => String(scope).trim())
    .filter(Boolean);
  const scopes = [...new Set(raw)];
  return {
    status: scopes.length > 0 ? "known" : "unknown",
    gmail_readonly: scopes.includes("https://www.googleapis.com/auth/gmail.readonly"),
    gmail_modify: scopes.includes("https://www.googleapis.com/auth/gmail.modify"),
  };
}

export async function readGmailScopeStatus(env = process.env) {
  const file = env.GOOGLE_TOKEN_FILE || "/opt/data/google_token.json";
  let credential;
  try {
    credential = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error(`Gmail credential file is unavailable at ${file}`);
  }
  return configuredGmailScopes(credential);
}

export async function listGmailLabels(env = process.env, fetchImpl = fetch, accessToken = null) {
  const token = accessToken ?? await googleAccessToken(env, fetchImpl);
  const response = await fetchImpl(`${GMAIL_API}/labels`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw jsonError(response, body, "Gmail label listing");
  return (body.labels ?? [])
    .filter((label) => label?.id && label?.name)
    .map((label) => ({ id: String(label.id), name: String(label.name), type: String(label.type ?? "unknown").toLowerCase() }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function resolveApprovedUserLabel(labels, selector, allowlistValue) {
  const requested = cleanSelector(selector, "Label");
  const label = labels.find((candidate) => candidate.id === requested)
    ?? labels.find((candidate) => candidate.name.toLocaleLowerCase("en-CA") === requested.toLocaleLowerCase("en-CA"));
  if (!label) throw new Error(`Gmail label "${requested}" does not exist`);
  if (label.type !== "user") throw new Error(`System Gmail label "${label.name}" cannot be applied by Hermes`);

  const allowlist = parseLabelAllowlist(allowlistValue);
  if (allowlist.length === 0) throw new Error("Gmail labeling is disabled until HERMES_GMAIL_LABEL_ALLOWLIST is configured");
  const approved = allowlist.some((allowed) => (
    allowed === label.id || allowed.toLocaleLowerCase("en-CA") === label.name.toLocaleLowerCase("en-CA")
  ));
  if (!approved) throw new Error(`Gmail label "${label.name}" is not in the Hermes allowlist`);
  return label;
}

export async function addGmailLabel({ messageId, labelSelector, dryRun = false, confirmed = false, accessToken = null }, env = process.env, fetchImpl = fetch) {
  const id = cleanSelector(messageId, "Message ID");
  if (!/^[A-Za-z0-9_-]{5,225}$/.test(id)) throw new Error("Message ID is invalid");
  const labels = await listGmailLabels(env, fetchImpl, accessToken);
  const label = resolveApprovedUserLabel(labels, labelSelector, env.HERMES_GMAIL_LABEL_ALLOWLIST);
  if (dryRun) return { status: "dry_run", message_id: id, label: { id: label.id, name: label.name } };
  if (!confirmed) throw new Error("A live label change requires --yes after an explicit user request");

  const token = accessToken ?? await googleAccessToken(env, fetchImpl);
  const response = await fetchImpl(`${GMAIL_API}/messages/${encodeURIComponent(id)}/modify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ addLabelIds: [label.id] }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw jsonError(response, body, "Gmail label update");
  return { status: "labeled", message_id: id, label: { id: label.id, name: label.name } };
}
