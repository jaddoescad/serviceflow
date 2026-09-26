import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationUrls = [
  new URL("../supabase/migrations/20260817153716_create_job_media.sql", import.meta.url),
  new URL("../supabase/migrations/20260817173057_add_companycam_source_to_job_media.sql", import.meta.url),
  new URL("../supabase/migrations/20260824144703_restrict_media_deletion_to_uploader.sql", import.meta.url),
];
const migrations = await Promise.all(migrationUrls.map((url) => readFile(url, "utf8")));
const db = new PGlite();

await db.exec(`
  create role anon;
  create role authenticated;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create table public.jobs (id uuid primary key);
  create table public.employees (
    id uuid primary key,
    role text not null,
    is_active boolean not null default true
  );
  create table public.leads (id uuid primary key);
  grant select on public.jobs, public.leads to authenticated;
`);
for (const migration of migrations.slice(0, 2)) await db.exec(migration);
// The production schema's shared-project migration adds lead ownership; this
// focused fixture reproduces only the column needed by the current policy.
await db.exec("alter table public.job_media add column lead_id uuid references public.leads (id)");
await db.exec(migrations[2]);

const uploaderId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const managerId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const jobId = "11111111-2222-4333-8444-555555555555";
const mediaId = "99999999-8888-4777-8666-555555555555";
const importedMediaId = "77777777-8888-4777-8666-555555555555";
const duplicateImportedMediaId = "66666666-8888-4777-8666-555555555555";
await db.query("insert into auth.users (id) values ($1)", [uploaderId]);
await db.query("insert into auth.users (id) values ($1)", [managerId]);
await db.query("insert into public.jobs (id) values ($1)", [jobId]);
await db.query(
  "insert into public.employees (id, role, is_active) values ($1, 'manager', true)",
  [managerId],
);
await db.query(
  `insert into public.job_media
    (id, job_id, object_key, media_type, mime_type, byte_size, uploaded_by)
   values ($1, $2, $3, 'image', 'image/jpeg', 4, $4)`,
  [mediaId, jobId, `jobs/${jobId}/${mediaId}.jpg`, uploaderId],
);

const rows = await db.query("select id, media_type, mime_type from public.job_media");
assert.deepEqual(rows.rows, [{ id: mediaId, media_type: "image", mime_type: "image/jpeg" }]);

await db.exec(`set role authenticated; set request.jwt.claim.sub = '${managerId}';`);
const managerDelete = await db.query("delete from public.job_media where id = $1 returning id", [mediaId]);
assert.equal(managerDelete.rows.length, 0, "a manager cannot delete another uploader's media");
await db.exec("reset role; reset request.jwt.claim.sub;");

await db.query(
  `insert into public.job_media
    (id, job_id, object_key, media_type, mime_type, byte_size, uploaded_by,
     source_provider, source_id, source_project_id, source_metadata)
   values ($1, $2, $3, 'image', 'image/jpeg', 8, null,
     'companycam', 'photo-1', 'project-1', '{"creator_name":"Painter"}'::jsonb)`,
  [importedMediaId, jobId, `jobs/${jobId}/${importedMediaId}.jpg`],
);
await assert.rejects(
  db.query(
    `insert into public.job_media
      (id, job_id, object_key, media_type, mime_type, byte_size, uploaded_by,
       source_provider, source_id, source_project_id)
     values ($1, $2, $3, 'image', 'image/jpeg', 8, null,
       'companycam', 'photo-1', 'project-1')`,
    [
      duplicateImportedMediaId,
      jobId,
      `jobs/${jobId}/${duplicateImportedMediaId}.jpg`,
    ],
  ),
);

await assert.rejects(
  db.query(
    `insert into public.job_media
      (id, job_id, object_key, media_type, mime_type, byte_size, uploaded_by)
     values (gen_random_uuid(), $1, $2, 'image', 'application/pdf', 4, $3)`,
    [jobId, `jobs/${jobId}/bad.pdf`, uploaderId],
  ),
);
await assert.rejects(
  db.query(
    `insert into public.job_media
      (id, job_id, object_key, media_type, mime_type, byte_size, uploaded_by)
     values (gen_random_uuid(), $1, $2, 'image', 'image/jpeg', 4, $3)`,
    [jobId, `jobs/${jobId}/wrong.jpg`, uploaderId],
  ),
);

const policies = await db.query(
  `select policyname, cmd from pg_policies
   where schemaname = 'public' and tablename = 'job_media'
   order by policyname`,
);
assert.deepEqual(policies.rows, [
  { policyname: "job_media_delete", cmd: "DELETE" },
  { policyname: "job_media_insert", cmd: "INSERT" },
  { policyname: "job_media_select", cmd: "SELECT" },
]);

console.log("Project media migration QA passed.");
