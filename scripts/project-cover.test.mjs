import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const project='11111111-2222-4333-8444-555555555555';
const other='66666666-7777-4888-8999-000000000000';
const media=index=>`aaaaaaaa-bbbb-4ccc-8ddd-${String(index).padStart(12,'0')}`;
test('cover selection persists, rejects invalid media, and falls back after trash or move',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create schema private; create role anon; create role authenticated;
   create function private.is_manager() returns boolean language sql as $$select coalesce(current_setting('test.manager',true),'yes') <> 'no'$$;
   create table project_workspace(project_id uuid primary key,job_id uuid,lead_id uuid,trashed_at timestamptz);
   create table projects(id uuid,kind text);
   insert into projects values('${project}','job'),('${other}','lead');
   create view project_directory as select * from projects;
   create table job_media(id uuid primary key,job_id uuid,lead_id uuid,media_type text,source_metadata jsonb default '{}',captured_at timestamptz,created_at timestamptz default now());`);
  for(let index=1;index<=5;index++) await db.query('insert into job_media(id,job_id,media_type,captured_at) values($1,$2,$3,$4)',[media(index),project,index===5?'video':'image',`2026-09-0${index}`]);
  await db.exec(await readFile(new URL('../supabase/migrations/20260916021000_project_cover_photo.sql',import.meta.url),'utf8'));
  const previews=async()=> (await db.query('select * from project_directory_previews($1)',[[project]])).rows.map(row=>row.id);
  await db.query('select set_project_cover($1,$2)',[project,media(1)]);
  assert.deepEqual(await previews(),[media(1),media(5),media(4)]);
  await assert.rejects(db.query('select set_project_cover($1,$2)',[project,media(5)]),/available photo/);
  await assert.rejects(db.query('select set_project_cover($1,$2)',[other,media(1)]),/available photo/);
  await db.query("update job_media set source_metadata=' {\"photo_trashed_at\":\"2026-09-16\"}' where id=$1",[media(1)]);
  assert.deepEqual(await previews(),[media(5),media(4),media(3)]);
  await db.query('select set_project_cover($1,$2)',[project,media(2)]);
  await db.query('update job_media set job_id=null,lead_id=$1 where id=$2',[other,media(2)]);
  assert.deepEqual(await previews(),[media(5),media(4),media(3)]);
  await db.query('select set_project_cover($1,$2)',[project,media(3)]);
  await db.query('delete from job_media where id=$1',[media(3)]);
  assert.equal((await db.query('select cover_media_id from project_workspace where project_id=$1',[project])).rows[0].cover_media_id,null);
  await db.exec("set test.manager='no'");
  await assert.rejects(db.query('select set_project_cover($1,$2)',[project,media(4)]),/managers/);
  await db.exec('set role anon');
  await assert.rejects(db.query('select set_project_cover($1,$2)',[project,media(4)]),/permission denied/);
 } finally {await db.close();}
});
