import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

test('timesheet pages preserve full-filter hours, old active entries and status filters beyond 1000 rows', async () => {
 const db = new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;
   create table time_entries(id uuid primary key,employee_id uuid,job_id uuid,employee_name text,job_name text,status text,started_at timestamptz,ended_at timestamptz);
   insert into time_entries select md5(i::text)::uuid,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','Painter','Project','completed','2026-09-01 10:00Z','2026-09-01 11:00Z' from generate_series(1,1200)i;
   insert into time_entries values(md5('active')::uuid,null,null,'Old active','Other','active','2026-01-01T00:00:00Z',null),(md5('excluded')::uuid,null,null,'Old complete','Other','completed','2026-01-01T00:00:00Z','2026-01-01 01:00Z');`);
  await db.exec(fs.readFileSync('../supabase/migrations/20260915181813_paginate_timesheets.sql','utf8'));
  const page=async (q='',employee=null,project=null,status='all',number=1)=>(await db.query('select get_timesheets_page($1,$2,$3,$4,$5,$6) as r',[q,employee,project,status,number,'2026-09-15T00:00:00Z'])).rows[0].r;
  const first=await page(),second=await page('',null,null,'all',2);
  assert.equal(first.total,1201);assert.equal(first.rows.length,50);assert.equal(first.activeCount,1);
  const activeHours=(Date.parse('2026-09-15')-Date.parse('2026-01-01'))/3600000;
  assert.equal(first.totalHours,1200+activeHours);assert.equal(first.totalHours,second.totalHours);
  assert.ok(second.rows.every(row=>!first.rows.some(other=>other.id===row.id)));
  assert.equal((await page('',null,null,'all',99999)).rows.length,1);
  assert.equal((await page('',null,null,'complete')).total,1200);
  assert.equal((await page('Old active')).totalHours,activeHours);
  assert.equal((await page('no match')).totalHours,0);
  assert.equal((await page('Painter','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002')).totalHours,1200);
  await db.exec(`insert into time_entries values(md5('negative')::uuid,null,null,'Negative','Other','completed','2026-09-01 11:00Z','2026-09-01 10:00Z');`);
  assert.equal((await page('Negative')).totalHours,0);
 } finally {await db.close();}
});
