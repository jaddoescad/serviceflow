import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('account updates recheck actor privileges, protect admins and deny direct client access',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create table employees(id uuid primary key,full_name text,email text,role text,is_active boolean,updated_at timestamptz);
 insert into employees(id,role,is_active) values('${id(1)}','admin',true),('${id(2)}','admin',true),('${id(3)}','manager',true),('${id(4)}','painter',true);`);
 await db.exec(await readFile(new URL('../supabase/migrations/20260916123800_manage_team_account.sql',import.meta.url),'utf8'));
 const run=(actor,target,role=null,active=null)=>db.query('select manage_team_account($1,$2,$3,$4) value',[id(actor),id(target),role,active]);
 await db.exec('set role service_role');
 await assert.rejects(run(3,1,'painter'),/Only admins/);
 await assert.rejects(run(3,1,null,false),/Only admins/);
 await assert.rejects(run(3,4,'admin'),/Only admins/);
 await assert.rejects(run(1,1,'painter'),/Another admin/);
 await assert.rejects(run(1,1,null,false),/Another admin/);
 assert.equal((await run(1,2,null,false)).rows[0].value.is_active,false);
 await assert.rejects(run(2,1,null,false),/Manager access/);
 assert.equal((await run(3,4,'manager')).rows[0].value.role,'manager');
 assert.equal((await run(1,2,null,true)).rows[0].value.is_active,true);
 await assert.rejects(run(1,4,'invalid'),/Invalid role/);
 await db.exec('set role authenticated'); await assert.rejects(run(1,4,'admin'),/permission denied/);
 await db.exec('set role anon'); await assert.rejects(run(1,4,'admin'),/permission denied/);
 } finally {await db.close();}
});
