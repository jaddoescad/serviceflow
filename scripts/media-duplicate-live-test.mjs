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
  copyId: randomUUID(),
  mediaId: randomUUID(),
  checks: [],
};
let actor, token;
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
  const email = `sf-duplicate-qa-${randomUUID()}@example.invalid`,
    password = randomBytes(36).toString("base64url");
  actor = (
    await json(
      await api("/auth/v1/admin/users", key, {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
          user_metadata: { qa_fixture: "serviceflow_media_duplicate" },
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
          full_name: "Media Duplicate QA — TEST ONLY",
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
  const bytes = await readFile(
    new URL("../apps/mobile/assets/serviceflow-icon.png", import.meta.url),
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
        "x-original-filename": "media-duplicate-qa.png",
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
      requested_description: "Duplicate QA metadata",
      requested_tags: ["Duplicate QA"],
    }),
    "details",
  );
  const duplicate = () =>
    fetch(`${worker}/v1/media/${report.mediaId}/duplicate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceId: project,
        copyId: report.copyId,
        expectedKey: uploaded.object_key,
      }),
      signal: AbortSignal.timeout(120000),
    });
  const before = (
    await json(
      await api(`/rest/v1/job_media?id=eq.${report.mediaId}`),
      "original before",
    )
  )[0];
  await json(await duplicate(), "duplicate");
  await json(await duplicate(), "duplicate retry");
  const rows = await json(
    await api(`/rest/v1/job_media?id=in.(${report.mediaId},${report.copyId})`),
    "rows",
  );
  assert.equal(rows.length, 2);
  const copy = rows.find((row) => row.id === report.copyId);
  assert.deepEqual(
    rows.find((row) => row.id === report.mediaId),
    before,
  );
  assert.equal(copy.lead_id, project);
  assert.notEqual(copy.object_key, before.object_key);
  assert.equal(copy.source_metadata.description, "Duplicate QA metadata");
  assert.deepEqual(copy.source_metadata.tags, ["Duplicate QA"]);
  checked(
    "copy retains metadata, leaves original unchanged and retries without extra records",
  );
  for (const suffix of ["", "/thumbnail"]) {
    const result = await fetch(`${worker}/v1/media/${report.copyId}${suffix}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(result.status, 200);
    assert.equal(
      hash(Buffer.from(await result.arrayBuffer())),
      suffix ? previewHash : hash(bytes),
    );
  }
  checked("copied original and thumbnail match source checksums");
  await json(
    await rpc("edit_photo_details", {
      requested_project_id: project,
      requested_media_id: report.copyId,
      expected_revision: copy.source_metadata.photo_revision ?? null,
      requested_revision: randomUUID(),
      requested_description: "Independent duplicate edit",
      requested_tags: ["Copy only"],
    }),
    "edit copy",
  );
  const unchanged = (
    await json(
      await api(`/rest/v1/job_media?id=eq.${report.mediaId}`),
      "original after copy edit",
    )
  )[0];
  assert.deepEqual(unchanged, before);
  checked("editing the duplicate does not change the original");
  report.completed = true;
} catch (error) {
  report.error = error.message;
  console.error("FAIL", error.message);
  process.exitCode = 1;
} finally {
  try {
    if (token) {
      for (const mediaId of [report.mediaId, report.copyId]) {
        const rows = await json(
          await api(
            `/rest/v1/job_media?id=eq.${mediaId}&select=job_id,lead_id,source_metadata`,
          ),
          "cleanup lookup",
        );
        if (rows.length) {
          const row = rows[0];
          assert.ok(project === (row.job_id || row.lead_id));
          const cleanup = await rpc("set_photo_trash", {
            requested_project_id: row.job_id || row.lead_id,
            requested_media_id: mediaId,
            requested_trashed: true,
            expected_revision: row.source_metadata.photo_trash_revision ?? null,
            requested_revision: randomUUID(),
          });
          assert.ok(cleanup.ok, "QA media cleanup");
          report.mediaTrashed = true;
        }
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
    `${directory}/duplicate-${Date.now()}.json`,
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
}
