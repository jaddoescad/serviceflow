import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const employee = '11111111-1111-4111-8111-111111111111';
const migration = await readFile(new URL('../supabase/migrations/20260916130423_link_verified_photo_creator.sql', import.meta.url), 'utf8');
for (const ambiguous of [false,true]) test(`imported creator filter preserves attribution (ambiguous email: ${ambiguous})`, async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create table employees(id uuid primary key, email text);
      insert into employees values ('${employee}','info@paintersottawa.com');
      create table job_media(id uuid primary key, uploaded_by uuid, source_provider text, source_metadata jsonb);
      create table admin_photo_feed (
        id uuid primary key, owner_id uuid, owner_kind text, project_name text,
        address text, media_type text, mime_type text, duration_ms bigint,
        display_at timestamptz, captured_at timestamptz, created_at timestamptz,
        creator_name text, description text
      );
      insert into admin_photo_feed
      select gen_random_uuid(),'${employee}','job','Test',null,'image','image/jpeg',null,
        '2026-09-16'::timestamptz,'2026-09-16'::timestamptz,'2026-09-16'::timestamptz,'Jad Slim',null
      from generate_series(1,70);
      insert into job_media select id,null,'companycam',jsonb_build_object('creator_id',
        case when row_number() over(order by id)<=65 then '4005454' else '4048197' end)
        from admin_photo_feed;
    `);
    if(ambiguous) await db.exec("insert into employees values(gen_random_uuid(),'INFO@PAINTERSOTTAWA.COM');");
    await db.exec(migration);
    const page = async(cursor=null)=>(await db.query('select get_workspace_media_page(uploader_filter=>$1,after_cursor=>$2) result',[employee,cursor])).rows[0].result;
    const first=await page();
    assert.equal(first.items.length,ambiguous?0:60);
    if(!ambiguous){
      const second=await page(first.nextCursor);
      assert.equal(second.items.length,5);
      assert.equal(second.nextCursor,null);
      assert.equal(new Set([...first.items,...second.items].map(p=>p.id)).size,65);
    }
    assert.equal((await db.query('select count(*)::int n from job_media where uploaded_by is not null')).rows[0].n,0);
    assert.equal((await db.query("select has_table_privilege('authenticated','media_creator_links','UPDATE') allowed")).rows[0].allowed,false);
  } finally { await db.close(); }
});
