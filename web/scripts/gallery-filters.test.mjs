import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const project='11111111-2222-4333-8444-555555555555';
test('project gallery combines multiple users/tags and preserves cursor paging and legacy calls',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create schema auth; create role anon; create role authenticated;
 create function auth.uid() returns uuid language sql as $$select '${project}'::uuid$$;
 create table employees(id uuid,full_name text);
 create table job_media(id uuid primary key,job_id uuid,lead_id uuid,captured_at timestamptz,created_at timestamptz,uploaded_by uuid,source_metadata jsonb,media_type text,mime_type text,original_filename text,duration_ms bigint);
 insert into job_media select gen_random_uuid(),'${project}',null,'2026-09-15 12:00:00Z'::timestamptz + n*interval '1 minute',now(),null,
 jsonb_build_object('creator_name',case when n%2=0 then 'Alice' else 'Bob' end,'tags',jsonb_build_array(case when n<3 then 'Before' else 'After' end)),
 'image','image/jpeg','image.jpg',null from generate_series(1,5) n;`);
 await db.exec(await readFile(new URL('../../supabase/migrations/20260915001733_paged_project_gallery.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../supabase/migrations/20260916013000_project_gallery_multifilters.sql',import.meta.url),'utf8'));
 const result=(await db.query('select project_gallery_filtered_page($1,requested_creators=>$2,requested_tags=>$3,requested_limit=>2) page',[project,['Alice','Bob'],['Before','After']])).rows[0].page;
 assert.equal(result.total,5);assert.equal(result.items.length,2);assert.equal(result.hasMore,true);
 const next=(await db.query('select project_gallery_filtered_page($1,cursor_at=>$2,cursor_id=>$3,requested_limit=>2) page',[project,result.cursor.at,result.cursor.id])).rows[0].page;
 assert.equal(next.items.length,2);assert.ok(next.items.every(item=>!result.items.some(first=>first.id===item.id)));
 const filtered=(await db.query('select project_gallery_filtered_page($1,requested_creators=>$2,requested_tags=>$3) page',[project,['Alice'],['Before']])).rows[0].page;
 assert.equal(filtered.total,1);
 const legacy=(await db.query("select project_gallery_page($1,requested_creator=>'Alice',requested_tag=>'Before') page",[project])).rows[0].page;
 assert.deepEqual(legacy.items,filtered.items);
 await db.exec('set role anon');
 await assert.rejects(db.query('select project_gallery_filtered_page($1)',[project]),/permission denied/);
 }finally{await db.close();}
});
