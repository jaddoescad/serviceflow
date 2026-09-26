import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const actor='00000000-0000-4000-8000-000000000001';
const target='00000000-0000-4000-8000-000000000002';
test('profile edits preserve account access and reject stale or unauthorized changes',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon; create role authenticated; create schema auth;
 create function auth.uid() returns uuid language sql as $$select '${actor}'::uuid$$;
 create table employees(id uuid primary key,email text,full_name text,role text,is_active boolean,updated_at timestamptz);
 insert into employees values('${actor}','admin@example.invalid','Admin','admin',true,now()),('${target}','qa@example.invalid','QA','painter',false,'2026-09-16');`);
 await db.exec(await readFile(new URL('../../supabase/migrations/20260916124441_edit_team_profile.sql',import.meta.url),'utf8'));
 const run=(name=' QA Edited ')=>(db.query('select edit_team_profile($1,$2,$3,$4,$5)',[target,name,' 613-555-0100 ',' Painter ','2026-09-16']));
 await db.exec('set role authenticated');
 await assert.rejects(run(' '),/Check the profile/);
 await run(); await assert.rejects(run(),/profile changed/);
 await db.exec('reset role');
 const row=(await db.query('select * from employees where id=$1',[target])).rows[0];
 assert.equal(row.full_name,'QA Edited'); assert.equal(row.phone,'613-555-0100');assert.equal(row.job_title,'Painter');
 assert.equal(row.email,'qa@example.invalid');assert.equal(row.role,'painter');assert.equal(row.is_active,false);
 await db.exec(`update employees set role='manager' where id='${actor}';set role authenticated`);
 await assert.rejects(run(),/Admin access/);
 await db.exec('set role anon');await assert.rejects(run(),/permission denied/);
 } finally {await db.close();}
});
