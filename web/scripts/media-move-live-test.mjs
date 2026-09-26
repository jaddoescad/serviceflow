// Live integration check using only dedicated QA records. Never logs credentials.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import assert from "node:assert/strict";

const source = "https://bwbckdkouqghdadpkjvn.supabase.co";
const worker = "https://project-media-worker.jadslim-fai.workers.dev";
const project = "5cce599f-9d30-49b9-b064-89dccaa17c25";
const credentials = JSON.parse(
  await readFile(
    "/Users/jad/.codex/migration-reports/financial-separation/credentials.json",
    "utf8",
  ),
);
const key = credentials.source_key;
const report = {
  startedAt: new Date().toISOString(),
  project,
  destination: randomUUID(),
  mediaId: randomUUID(),
  checks: [],
};
let actor,
  token,
  destinationCreated = false;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function api(path, auth = key, options = {}) {
  return fetch(source + path, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${auth}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(30000),
  });
}
async function json(response, label) {
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  return response.json();
}
const rpc = (name, body) =>
  api(`/rest/v1/rpc/${name}`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });
function checked(message) {
  report.checks.push(message);
  console.log("PASS", message);
}
try {
  const fixture = await json(
    await api(`/rest/v1/leads?id=eq.${project}&select=metadata,contact_id`),
    "fixture",
  );
  assert.equal(
    fixture[0]?.metadata?.qa_fixture,
    "serviceflow_photo_qa_20260914",
  );
  const email = `sf-move-qa-${randomUUID()}@example.invalid`,
    password = randomBytes(36).toString("base64url");
  actor = (
    await json(
      await api("/auth/v1/admin/users", key, {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
          user_metadata: { qa_fixture: "serviceflow_media_move" },
        }),
      }),
      "QA user",
    )
  ).id;
  report.actor = actor;
  assert.ok(
    (
      await api("/rest/v1/employees", key, {
        method: "POST",
        body: JSON.stringify({
          id: actor,
          email,
          full_name: "Media Move QA — TEST ONLY",
          role: "manager",
          is_active: true,
        }),
      })
    ).ok,
  );
  token = (
    await json(
      await api("/auth/v1/token?grant_type=password", key, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
      "sign in",
    )
  ).access_token;
  await json(
    await rpc("create_workspace_project", {
      requested_id: report.destination,
      requested_name: "Media Move QA — TEST ONLY",
      requested_contact: fixture[0].contact_id,
      requested_address: "",
    }),
    "destination",
  );
  destinationCreated = true;
  const bytes = await readFile(
    new URL("../../mobile/assets/serviceflow-icon.png", import.meta.url),
  );
  const uploaded = await json(
    await fetch(`${worker}/v1/leads/${project}/media`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "image/png",
        "x-media-type": "image",
        "x-file-size": String(bytes.length),
        "x-upload-id": report.mediaId,
        "x-original-filename": "media-move-qa.png",
      },
      body: bytes,
      signal: AbortSignal.timeout(60000),
    }),
    "upload",
  );
  report.originalKey = uploaded.object_key;
  const get = (suffix) =>
    fetch(`${worker}/v1/media/${report.mediaId}${suffix}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60000),
    });
  const preview = await get("/thumbnail");
  assert.equal(preview.status, 200);
  const previewHash = hash(Buffer.from(await preview.arrayBuffer()));
  await json(
    await rpc("edit_photo_details", {
      requested_project_id: project,
      requested_media_id: report.mediaId,
      expected_revision: null,
      requested_revision: randomUUID(),
      requested_description: "Move QA metadata",
      requested_tags: ["Move QA"],
    }),
    "details",
  );
  let revision = randomUUID();
  const move = (from, to, expectedRevision, requestRevision) =>
    fetch(`${worker}/v1/media/${report.mediaId}/move`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceId: from,
        destinationId: to,
        expectedRevision,
        revision: requestRevision,
      }),
      signal: AbortSignal.timeout(120000),
    });
  await json(
    await move(project, report.destination, null, revision),
    "move to destination",
  );
  const row = (
    await json(
      await api(
        `/rest/v1/job_media?id=eq.${report.mediaId}&select=job_id,lead_id,object_key,source_metadata`,
      ),
      "moved row",
    )
  )[0];
  assert.equal(row.job_id, report.destination);
  assert.equal(row.lead_id, null);
  assert.equal(row.source_metadata.description, "Move QA metadata");
  assert.deepEqual(row.source_metadata.tags, ["Move QA"]);
  report.movedKey = row.object_key;
  checked("move reassigns project and preserves description/tags");
  const original = await get("");
  assert.equal(original.status, 200);
  assert.equal(hash(Buffer.from(await original.arrayBuffer())), hash(bytes));
  const movedPreview = await get("/thumbnail");
  assert.equal(movedPreview.status, 200);
  assert.equal(
    hash(Buffer.from(await movedPreview.arrayBuffer())),
    previewHash,
  );
  checked("moved original and cached preview have identical checksums");
  await json(
    await move(project, report.destination, null, revision),
    "move retry",
  );
  checked("same request can be retried safely");
  assert.equal(
    (await move(project, report.destination, null, randomUUID())).status,
    409,
  );
  checked("stale ownership move is rejected");
  const backRevision = randomUUID();
  await json(
    await move(report.destination, project, revision, backRevision),
    "move back",
  );
  const returned = (
    await json(
      await api(
        `/rest/v1/job_media?id=eq.${report.mediaId}&select=job_id,lead_id,object_key`,
      ),
      "returned row",
    )
  )[0];
  assert.equal(returned.lead_id, project);
  assert.equal(returned.job_id, null);
  report.returnedKey = returned.object_key;
  const returnedBytes = await get("");
  assert.equal(returnedBytes.status, 200);
  assert.equal(
    hash(Buffer.from(await returnedBytes.arrayBuffer())),
    hash(bytes),
  );
  checked("move back restores source project with original bytes");
  report.completed = true;
} catch (error) {
  report.error = error.message;
  console.error("FAIL", error.message);
  process.exitCode = 1;
} finally {
  try {
    if (token) {
      const rows = await json(
        await api(
          `/rest/v1/job_media?id=eq.${report.mediaId}&select=job_id,lead_id,source_metadata`,
        ),
        "cleanup lookup",
      );
      if (rows.length) {
        const row = rows[0];
        assert.ok(
          [project, report.destination].includes(row.job_id || row.lead_id),
        );
        const cleanup = await rpc("set_photo_trash", {
          requested_project_id: row.job_id || row.lead_id,
          requested_media_id: report.mediaId,
          requested_trashed: true,
          expected_revision: row.source_metadata.photo_trash_revision ?? null,
          requested_revision: randomUUID(),
        });
        assert.ok(cleanup.ok, "QA media cleanup");
        report.mediaTrashed = true;
      }
      if (destinationCreated) {
        assert.ok(
          (
            await rpc("set_project_lifecycle", {
              requested_id: report.destination,
              requested_action: "archive",
            })
          ).ok,
        );
        assert.ok(
          (
            await rpc("set_project_lifecycle", {
              requested_id: report.destination,
              requested_action: "trash",
            })
          ).ok,
        );
        report.destinationTrashed = true;
      }
    }
  } catch (error) {
    report.cleanupError = error.message;
    process.exitCode = 1;
  }
  if (actor) {
    const disabled = await api(`/rest/v1/employees?id=eq.${actor}`, key, {
      method: "PATCH",
      body: JSON.stringify({ is_active: false }),
    });
    const banned = await api(`/auth/v1/admin/users/${actor}`, key, {
      method: "PUT",
      body: JSON.stringify({ ban_duration: "876000h" }),
    });
    report.accountDisabled = disabled.ok && banned.ok;
    if (!report.accountDisabled) process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  const directory = "/Users/jad/.codex/migration-reports/photo-workflow";
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    `${directory}/move-${Date.now()}.json`,
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
}
