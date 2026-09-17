import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const firstUser = "11111111-1111-4111-8111-111111111111";
const secondUser = "22222222-2222-4222-8222-222222222222";

test("user feed keeps exact identity through filters and pagination; legacy feed still works", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create table job_media (id uuid primary key, uploaded_by uuid, source_metadata jsonb default '{}');
      create table admin_photo_feed (
        id uuid primary key, owner_id uuid, owner_kind text, project_name text,
        address text, media_type text, mime_type text, duration_ms bigint,
        display_at timestamptz, captured_at timestamptz, created_at timestamptz,
        creator_name text, description text
      );
      insert into admin_photo_feed
      select gen_random_uuid(), '${firstUser}', 'job', 'Test', null,
        case when n % 2 = 0 then 'video' else 'image' end, 'image/jpeg', null,
        '2026-09-15'::timestamptz + n * interval '1 minute',
        '2026-09-15'::timestamptz + n * interval '1 minute',
        '2026-09-15'::timestamptz, 'Same Name', null
      from generate_series(1,125) n;
      insert into job_media(id,uploaded_by) select id, case when row_number() over(order by captured_at) <= 65
        then '${firstUser}'::uuid else '${secondUser}'::uuid end from admin_photo_feed;
    `);
    for (const migration of [
      "20260915235345_workspace_media_filters",
      "20260916030000_user_photo_feed",
      "20260916125035_workspace_photo_tags",
    ]) {
      await db.exec(
        await readFile(
          new URL(`../supabase/migrations/${migration}.sql`, import.meta.url),
          "utf8",
        ),
      );
    }
    const page = async (args = "", values = []) =>
      (
        await db.query(
          `select get_workspace_media_page(${args}) result`,
          values,
        )
      ).rows[0].result;
    await db.query("update job_media set source_metadata=$1 where uploaded_by=$2",[JSON.stringify({tags:['Kitchen, main floor','Before']}),firstUser]);
    const tagged = await page("tag_filters => $1",[['Kitchen, main floor']]);
    assert.equal(tagged.items.length,60);
    const taggedNext = await page("tag_filters => $1, after_cursor => $2",[['Kitchen, main floor'],JSON.stringify(tagged.nextCursor)]);
    assert.equal(taggedNext.items.length,5);
    assert.equal((await page("tag_filters => $1, uploader_filter => $2",[['Before'],secondUser])).items.length,0);
    assert.deepEqual((await db.query('select get_workspace_photo_tags() tags')).rows[0].tags,['Before','Kitchen, main floor']);
    const first = await page("uploader_filter => $1", [firstUser]);
    assert.equal(first.items.length, 60);
    assert.ok(first.nextCursor);
    const second = await page("uploader_filter => $1, after_cursor => $2", [
      firstUser,
      first.nextCursor,
    ]);
    assert.equal(second.items.length, 5);
    assert.equal(second.nextCursor, null);
    const ids = [...first.items, ...second.items].map((item) => item.id);
    assert.equal(new Set(ids).size, 65);
    const owners = (
      await db.query(
        "select distinct uploaded_by from job_media where id = any($1)",
        [ids],
      )
    ).rows;
    assert.deepEqual(owners, [{ uploaded_by: firstUser }]);
    const videos = await page(
      "uploader_filter => $1, media_filter => 'video', oldest_first => true",
      [firstUser],
    );
    assert.ok(videos.items.length > 0);
    assert.ok(videos.items.every((item) => item.mediaType === "video"));
    assert.ok(videos.items[0].capturedAt < videos.items.at(-1).capturedAt);
    assert.equal((await page()).items.length, 60);
    assert.equal(
      (
        await page("uploader_filter => $1", [
          "33333333-3333-4333-8333-333333333333",
        ])
      ).items.length,
      0,
    );
    await db.exec("set role anon");
    await assert.rejects(
      page("uploader_filter => $1", [firstUser]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
