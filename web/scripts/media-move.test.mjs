import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const source='11111111-2222-4333-8444-555555555555';
const destination='66666666-7777-4888-8999-000000000000';
const media='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const revision='bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
test('media move preserves content metadata, commits atomically, and rejects stale/reused requests',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create schema private; create schema auth; create role anon; create role authenticated;
 create function auth.uid() returns uuid language sql as $$select '${media}'::uuid$$;
 create function private.is_manager() returns boolean language sql as $$select coalesce(current_setting('test.manager',true),'yes') <> 'no'$$;
 create table project_workspace(project_id uuid primary key,job_id uuid,lead_id uuid,archived_at timestamptz,trashed_at timestamptz);
 create table projects(id uuid primary key,kind text);
 insert into projects values('${source}','job'),('${destination}','lead');
 create view project_directory as select * from projects;
 create table job_media(id uuid primary key,job_id uuid,lead_id uuid,object_key text,byte_size bigint,media_type text,mime_type text,source_metadata jsonb,updated_at timestamptz);
 insert into job_media values('${media}','${source}',null,'jobs/${source}/${media}.jpg',123,'image','image/jpeg','{"description":"Keep this","tags":["Before"]}',now());`);
 await db.exec(await readFile(new URL('../../supabase/migrations/20260916010000_move_project_media.sql',import.meta.url),'utf8'));
 const args=[media,source,destination,null,revision];
 const call=commit=>db.query('select public.move_project_media($1,$2,$3,$4,$5,$6) plan',[...args,commit]);
 const plan=(await call(false)).rows[0].plan;
 assert.equal(plan.target_key,`leads/${destination}/${media}~${revision}.jpg`);
 assert.equal((await db.query('select job_id from job_media')).rows[0].job_id,source);
 await call(true);
 const row=(await db.query('select * from job_media')).rows[0];
 assert.equal(row.job_id,null);assert.equal(row.lead_id,destination);
 assert.equal(row.source_metadata.description,'Keep this');assert.deepEqual(row.source_metadata.tags,['Before']);
 assert.equal((await call(true)).rows[0].plan.already_moved,true);
 await assert.rejects(db.query('select public.move_project_media($1,$2,$3,$4,$5,false)',[media,destination,source,null,revision]),/already used/);
 args[4]='cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee';
 await assert.rejects(call(true),/elsewhere/);
 args[1]=destination;args[2]=source;args[3]=revision;
 await db.exec(`update project_workspace set archived_at=now() where project_id='${source}'`);
 await assert.rejects(call(false),/active destination/);
 await db.exec("set test.manager='no'");
 await assert.rejects(call(false),/managers/);
 await db.exec('set role anon');
 await assert.rejects(call(false),/permission denied/);
 } finally {await db.close();}
});
