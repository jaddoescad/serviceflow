import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationUrls = [
  new URL("../supabase/migrations/20260817153716_create_job_media.sql", import.meta.url),
  new URL("../supabase/migrations/20260817173057_add_companycam_source_to_job_media.sql", import.meta.url),
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
`);
for (const migration of migrations) await db.exec(migration);

const uploaderId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const jobId = "11111111-2222-4333-8444-555555555555";
const mediaId = "99999999-8888-4777-8666-555555555555";
const importedMediaId = "77777777-8888-4777-8666-555555555555";
const duplicateImportedMediaId = "66666666-8888-4777-8666-555555555555";
await db.query("insert into auth.users (id) values ($1)", [uploaderId]);
await db.query("insert into public.jobs (id) values ($1)", [jobId]);
await db.query(
  `insert into public.job_media
    (id, job_id, object_key, media_type, mime_type, byte_size, uploaded_by)
   values ($1, $2, $3, 'image', 'image/jpeg', 4, $4)`,
  [mediaId, jobId, `jobs/${jobId}/${mediaId}.jpg`, uploaderId],
);

const rows = await db.query("select id, media_type, mime_type from public.job_media");
assert.deepEqual(rows.rows, [{ id: mediaId, media_type: "image", mime_type: "image/jpeg" }]);

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
