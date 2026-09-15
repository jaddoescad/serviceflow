import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
test('crew totals include all related rows, old active clocks and effective rates without history payload',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;
 create table employees(id uuid primary key,full_name text,email text,role text,is_active boolean);
 create table time_entries(employee_id uuid,status text,started_at timestamptz,ended_at timestamptz);
 create table job_assignments(employee_id uuid,status text);
 create table employee_pay_rates(id uuid,employee_id uuid,effective_from date,hourly_rate_cents int);
 insert into employees select md5(i::text)::uuid,'Painter '||i,null,'painter',true from generate_series(1,1200)i;
 insert into time_entries select md5('1')::uuid,'completed','2026-09-01 10:00Z','2026-09-01 11:00Z' from generate_series(1,1200);
 insert into time_entries values(md5('2')::uuid,'active','2026-01-01 00:00Z',null),(md5('1')::uuid,'completed','2026-01-01 00:00Z','2026-01-01 01:00Z');
 insert into job_assignments select md5('1')::uuid,'active' from generate_series(1,1200);
 insert into employee_pay_rates values(md5('r1')::uuid,md5('1')::uuid,'2026-01-01',2500),(md5('r2')::uuid,md5('1')::uuid,'2026-09-01',3000),(md5('r3')::uuid,md5('1')::uuid,'2026-10-01',4000);
 `);
 await db.exec(fs.readFileSync('supabase/migrations/20260915184127_summarize_crew.sql','utf8'));
 const rows=(await db.query("select get_crew_summary('2026-09-15T00:00Z') r")).rows[0].r;
 assert.equal(rows.length,1200);const first=rows.find(r=>r.name==='Painter 1');assert.equal(first.loggedHours,1200);assert.equal(first.assignedCount,1200);assert.equal(first.currentPayRate,30);assert.ok(!('payRates' in first));
 assert.equal(rows.find(r=>r.name==='Painter 2').loggedHours,(Date.parse('2026-09-15')-Date.parse('2026-01-01'))/3600000);
 const history=(await db.query('select get_crew_pay_history($1) r',[first.userId])).rows[0].r;assert.equal(history.length,3);assert.equal(history[0].hourly_rate,40);assert.ok(history.every(r=>r.user_id===first.userId));
 assert.equal((await db.query("select has_function_privilege('anon','get_crew_summary(timestamptz)','execute') allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});
