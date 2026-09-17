import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const project='11111111-1111-4111-8111-111111111111';
const source='22222222-2222-4222-8222-222222222222';
const copy='33333333-3333-4333-8333-333333333333';
const actor='44444444-4444-4444-8444-444444444444';
const key=`jobs/${project}/${source}.jpg`;
test('duplicate prepares, commits independently and retries without creating another copy', async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role authenticated; create role anon; create schema auth; create schema private;
 create function auth.uid() returns uuid language sql as $$select '${actor}'::uuid$$;
 create function private.is_manager() returns boolean language sql as $$select current_setting('test.manager',true)='true'$$;
 create table project_directory(id uuid,kind text);
 create table project_workspace(project_id uuid primary key,job_id uuid,lead_id uuid,trashed_at timestamptz);
 create table job_media(id uuid primary key,job_id uuid,lead_id uuid,object_key text not null,media_type text,mime_type text,
 original_filename text,byte_size bigint,width int,height int,duration_ms bigint,captured_at timestamptz,uploaded_by uuid,
 created_at timestamptz default now(),updated_at timestamptz default now(),source_provider text,source_metadata jsonb);
 insert into project_directory values('${project}','job');
 insert into job_media(id,job_id,object_key,media_type,mime_type,byte_size,source_metadata) values('${source}','${project}','${key}','image','image/jpeg',123,'{"description":"Keep","tags":["Before"],"photo_move_revision":"old"}');
 set test.manager='true';`);
 await db.exec(await readFile(new URL('../supabase/migrations/20260916050000_duplicate_project_media.sql',import.meta.url),'utf8'));
 const original=(await db.query('select to_jsonb(m) value from job_media m where id=$1',[source])).rows[0].value;
 const run=async(commit=false,copyId=copy,objectKey=key,attempt=actor)=>(await db.query('select duplicate_project_media($1,$2,$3,$4,$5,$6) plan',[source,copyId,project,objectKey,attempt,commit])).rows[0].plan;
 await db.exec('set role authenticated');
 const plan=await run(); assert.equal(plan.already_copied,false); assert.equal(plan.target_key,`jobs/${project}/${copy}~${actor}.jpg`);
 await assert.rejects(run(true,copy,'stale-key'),/changed/);
 const competing = await run(false,copy,key,source);
 assert.notEqual(competing.target_key,plan.target_key);
 await run(true); assert.equal((await run(true,copy,key,source)).already_copied,true);
 await db.exec('reset role');
 assert.equal((await db.query('select count(*)::int n from job_media')).rows[0].n,2);
 assert.deepEqual((await db.query('select to_jsonb(m) value from job_media m where id=$1',[source])).rows[0].value,original);
 const duplicate=(await db.query('select * from job_media where id=$1',[copy])).rows[0];
 assert.equal(duplicate.object_key,plan.target_key);
 assert.equal(duplicate.source_metadata.description,'Keep'); assert.deepEqual(duplicate.source_metadata.tags,['Before']);
 assert.equal(duplicate.source_metadata.photo_move_revision,undefined); assert.equal(duplicate.source_metadata.duplicated_from,source);
 await db.query("update job_media set source_metadata=source_metadata || '{\"photo_trashed_at\":\"2026-09-16\"}' where id=$1",[source]);
 await db.exec('set role authenticated');
 await assert.rejects(run(true,actor),/available photo/);
 await db.exec("set test.manager='false'"); await assert.rejects(run(),/managers/);
 await db.exec('set role anon'); await assert.rejects(run(),/permission denied/);
 } finally {await db.close();}
});
