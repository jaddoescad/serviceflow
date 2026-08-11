import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { parseArgs } from "./ottawa-gmail-label-cli.mjs";
import {
  addGmailLabel,
  configuredGmailScopes,
  gmailLabelAllowlist,
  parseLabelAllowlist,
  resolveApprovedUserLabel,
} from "./lib/ottawa-gmail-labeling.mjs";

const labels = [
  { id: "INBOX", name: "INBOX", type: "system" },
  { id: "Label_42", name: "Painting Estimate Lead", type: "user" },
];

test("CLI parses bounded add arguments", () => {
  assert.deepEqual(parseArgs(["add", "--message-id", "18abcde123", "--label", "Painting Estimate Lead", "--dry-run", "--json"]), {
    command: "add", messageId: "18abcde123", label: "Painting Estimate Lead", dryRun: true, yes: false, json: true, help: false,
  });
  assert.throws(() => parseArgs(["add", "--message-id", "18abcde123"]), /requires --message-id and --label/);
  assert.throws(() => parseArgs(["add", "--message-id", "18abcde123", "--label", "Lead", "--dry-run", "--yes"]), /either --dry-run or --yes/);
});

test("allowlist parsing is compact and deterministic", () => {
  assert.deepEqual(parseLabelAllowlist("Painting Estimate Lead,Label_42\nPainting Estimate Lead"), ["Painting Estimate Lead", "Label_42"]);
});

test("allowlist falls back to Hermes persisted env without loading other keys", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "gmail-label-env-"));
  const file = path.join(directory, ".env");
  try {
    await writeFile(file, "UNRELATED_SECRET=do-not-load\nHERMES_GMAIL_LABEL_ALLOWLIST='Quotes,Review'\n", "utf8");
    assert.equal(await gmailLabelAllowlist({ HERMES_ENV_FILE: file }), "Quotes,Review");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("only allowlisted user labels resolve", () => {
  assert.equal(resolveApprovedUserLabel(labels, "painting estimate lead", "Painting Estimate Lead").id, "Label_42");
  assert.throws(() => resolveApprovedUserLabel(labels, "INBOX", "INBOX"), /System Gmail label/);
  assert.throws(() => resolveApprovedUserLabel(labels, "Painting Estimate Lead", "Another Label"), /not in the Hermes allowlist/);
  assert.throws(() => resolveApprovedUserLabel(labels, "Painting Estimate Lead", ""), /labeling is disabled/);
});

test("configured scope reporting never returns credentials", () => {
  assert.deepEqual(configuredGmailScopes({
    client_secret: "do-not-return",
    refresh_token: "do-not-return",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  }), { status: "known", gmail_readonly: true, gmail_modify: false });
});

test("dry-run validates the approved label without a write request", async () => {
  const calls = [];
  const result = await addGmailLabel({ messageId: "18abcde123", labelSelector: "Painting Estimate Lead", dryRun: true, accessToken: "test-token" }, {
    HERMES_GMAIL_LABEL_ALLOWLIST: "Painting Estimate Lead",
    GOOGLE_TOKEN_FILE: "/not-used",
  }, async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    return new Response(JSON.stringify({ labels }), { status: 200 });
  });
  assert.equal(result.status, "dry_run");
  assert.deepEqual(calls.map((call) => call.method), ["GET"]);
});

test("live change sends addLabelIds only", async () => {
  const requests = [];
  const env = { HERMES_GMAIL_LABEL_ALLOWLIST: "Label_42", GOOGLE_TOKEN_FILE: "/not-used" };
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), ...init });
    if (init.method === "GET") return new Response(JSON.stringify({ labels }), { status: 200 });
    return new Response(JSON.stringify({ id: "18abcde123", labelIds: ["Label_42"] }), { status: 200 });
  };
  const result = await addGmailLabel({ messageId: "18abcde123", labelSelector: "Label_42", confirmed: true, accessToken: "test-token" }, env, fetchImpl);
  assert.equal(result.status, "labeled");
  assert.equal(requests.at(-1).method, "POST");
  assert.deepEqual(JSON.parse(requests.at(-1).body), { addLabelIds: ["Label_42"] });
  assert.match(requests.at(-1).url, /\/messages\/18abcde123\/modify$/);
});
