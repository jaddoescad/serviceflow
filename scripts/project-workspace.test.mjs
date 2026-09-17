import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const project = "00000000-0000-4000-8000-000000000002";
const other = "00000000-0000-4000-8000-000000000003";
test("project lifecycle requires archive, retains 90-day restore, and scopes media hiding", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth; create schema private;
      grant usage on schema auth to authenticated;
      create function auth.uid() returns uuid language sql as $$ select '00000000-0000-4000-8000-000000000001'::uuid $$;
      create table employees(id uuid,is_active boolean,role text,full_name text,email text);
      insert into employees values(auth.uid(),true,'manager','QA','qa@example.test');
      create table contacts(id uuid primary key,name text);
      create table jobs(id uuid primary key,contact_id uuid,name text,formatted_address text,address_line_1 text,created_at timestamptz default now(),updated_at timestamptz default now(),is_feed_visible boolean default true,lead_id uuid,accepted_quote_id uuid, status text,source text,metadata jsonb);
      create table leads(id uuid primary key,contact_id uuid,address text,city text,province text,postal_code text,created_at timestamptz,updated_at timestamptz);
      create table quotes(id uuid primary key,lead_id uuid);
      create table job_media(id uuid primary key,job_id uuid,lead_id uuid,media_type text,captured_at timestamptz,created_at timestamptz,mime_type text,duration_ms bigint,uploaded_by uuid,source_metadata jsonb default '{}');
      alter table job_media enable row level security;
      create policy media_read on job_media for select to authenticated using(true);
      grant select on employees,contacts,jobs,leads,quotes,job_media to authenticated;
      insert into contacts values(auth.uid(),'Test contact');
      insert into jobs(id,contact_id,name) values('${project}',auth.uid(),'Test project'),('${other}',auth.uid(),'Other project');
      insert into job_media(id,job_id,lead_id,media_type,captured_at,created_at) values(gen_random_uuid(),'${project}',null,'image',now(),now()),(gen_random_uuid(),'${other}',null,'video',now(),now());
      create function save_project_profile(uuid,text,text default null,text default null,text default null,text default null,text default null,text default null) returns boolean language sql as $$ select true $$;
      create view admin_photo_feed as select null::uuid id,null::uuid owner_id,null::text owner_kind,null::text project_name,null::text address,null::text media_type,null::text mime_type,null::bigint duration_ms,null::timestamptz display_at,null::timestamptz captured_at,null::timestamptz created_at,null::text creator_name,null::text description where false;
    `);
    let migration = await readFile(
      new URL(
        "../supabase/migrations/20260915203410_project_workspace.sql",
        import.meta.url,
      ),
      "utf8",
    );
    migration = migration.replaceAll('collate "en-CA-x-icu"', "");
    await db.exec(migration);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20260915204818_project_workspace_refinements.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20260915235345_workspace_media_filters.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20260916001000_project_label_workflows.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query(
        "select create_workspace_project(gen_random_uuid(),'No contact',null,'' )",
      ),
      /contact is required/,
    );
    const created = "00000000-0000-4000-8000-000000000009";
    await db.query(
      "select create_workspace_project($1,'New project',auth.uid(),'Test address')",
      [created],
    );
    await db.query(
      "select create_workspace_project($1,'New project',auth.uid(),'Test address')",
      [created],
    );
    assert.equal(
      (
        await db.query("select count(*)::int n from jobs where id=$1", [
          created,
        ])
      ).rows[0].n,
      1,
    );

    const label = "00000000-0000-4000-8000-000000000010";
    await db.query(
      "insert into project_labels(id,name,color) values($1,'Test label','#31a03c')",
      [label],
    );
    await db.query("select set_project_labels($1,$2)", [project, [label]]);
    assert.equal(
      (await db.query("select count(*)::int n from project_label_links"))
        .rows[0].n,
      1,
    );
    await assert.rejects(
      db.query("select set_project_labels($1,$2)", [
        project,
        ["00000000-0000-4000-8000-000000000099"],
      ]),
      /foreign key/,
    );
    assert.equal(
      (await db.query("select count(*)::int n from project_label_links"))
        .rows[0].n,
      1,
      "invalid selection rolls back removal",
    );
    await db.query("select set_project_labels($1,$2)", [project, []]);
    assert.equal(
      (await db.query("select count(*)::int n from project_label_links"))
        .rows[0].n,
      0,
    );
    const filtered = (
      await db.query(
        "select get_workspace_media_page(project_filters=>$1,oldest_first=>true) page",
        [[other]],
      )
    ).rows[0].page;
    assert.equal(filtered.items.length, 1);
    assert.equal(filtered.items[0].ownerProjectId, other);
    await assert.rejects(
      db.query("select set_project_lifecycle($1,'trash')", [project]),
      /Archive/,
    );
    const before = (
      await db.query("select to_jsonb(j) snapshot from jobs j where id=$1", [
        project,
      ])
    ).rows[0].snapshot;
    const mediaBefore = (
      await db.query(
        "select to_jsonb(m) snapshot from job_media m where job_id=$1",
        [project],
      )
    ).rows[0].snapshot;
    await db.query("select set_project_labels($1,$2)", [project, [label]]);
    await db.query("select set_project_lifecycle($1,'archive')", [project]);
    await db.query("select set_project_lifecycle($1,'trash')", [project]);
    await assert.rejects(
      db.query("select set_project_labels($1,$2)", [project, [label]]),
      /trash/,
    );
    await assert.rejects(
      db.query(
        "update project_workspace set trashed_at=now()+interval '1 day' where project_id=$1",
        [project],
      ),
      /retention cannot be extended/,
    );
    assert.equal(
      (await db.query("select count(*)::int n from job_media")).rows[0].n,
      1,
    );
    assert.equal(
      (await db.query("select job_id from job_media")).rows[0].job_id,
      other,
    );
    await assert.rejects(
      db.query("select set_project_lifecycle($1,'unarchive')", [project]),
      /Archive/,
    );
    await db.query("select set_project_lifecycle($1,'restore')", [project]);
    assert.equal(
      (await db.query("select count(*)::int n from job_media")).rows[0].n,
      2,
    );
    assert.deepEqual(
      (
        await db.query("select to_jsonb(j) snapshot from jobs j where id=$1", [
          project,
        ])
      ).rows[0].snapshot,
      before,
      "archive/trash/restore leave contact and accounting job fields unchanged",
    );
    assert.deepEqual(
      (
        await db.query(
          "select to_jsonb(m) snapshot from job_media m where job_id=$1",
          [project],
        )
      ).rows[0].snapshot,
      mediaBefore,
      "restoring reveals the same media record and metadata",
    );
    assert.equal(
      (
        await db.query(
          "select label_id from project_label_links where project_id=$1",
          [project],
        )
      ).rows[0].label_id,
      label,
    );
    assert.ok(
      (
        await db.query(
          "select archived_at from project_workspace where project_id=$1",
          [project],
        )
      ).rows[0].archived_at,
      "restore preserves archived status",
    );
    await db.exec(
      `update project_workspace set trashed_at=now()-interval '89 days 23 hours' where project_id='${project}'`,
    );
    await db.query("select set_project_lifecycle($1,'restore')", [project]);
    await db.exec(
      `update project_workspace set trashed_at=now()-interval '90 days' where project_id='${project}'`,
    );
    await assert.rejects(
      db.query("select set_project_lifecycle($1,'restore')", [project]),
      /90/,
    );
    await assert.rejects(
      db.query(
        `update project_workspace set trashed_at=null where project_id=$1`,
        [project],
      ),
      /90/,
    );
    await db.exec("reset role");
    await db.exec("update employees set role='painter'");
    await db.exec("set role authenticated");
    assert.equal(
      (await db.query("select count(*)::int n from project_directory")).rows[0]
        .n,
      3,
    );
    await assert.rejects(
      db.query("select set_project_labels($1,$2)", [other, [label]]),
      /managers/,
    );
    await assert.rejects(
      db.query("select set_project_lifecycle($1,'archive')", [other]),
      /row-level security/,
    );
    await db.exec("set role anon");
    await assert.rejects(
      db.query("select * from project_directory"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select set_project_lifecycle($1,'archive')", [other]),
      /permission denied/,
    );
    await db.exec("reset role");
    await assert.rejects(
      db.query(
        "insert into jobs(id,name) values(gen_random_uuid(),'No contact')",
      ),
      /null value/,
    );
  } finally {
    await db.close();
  }
});
