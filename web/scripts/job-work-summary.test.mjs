import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import test from 'node:test';
function moduleAt(path, require) {
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require});
 return module.exports;
}
const hours=moduleAt('src/lib/hours.ts',()=>({}));
const metrics=moduleAt('src/lib/metrics.ts',name=>name.endsWith('/hours')?hours:{});
// The Labour table's job order, which the database pages must reproduce:
// open jobs with clock activity first (latest first), then by start date, then name.
const timestamp=value=>{const parsed=value?Date.parse(value):0;return Number.isFinite(parsed)?parsed:0;};
function compareJobsTableRows(left,right){
 const leftActive=!left.labourClosedAt&&Boolean(left.lastClockIn);
 const rightActive=!right.labourClosedAt&&Boolean(right.lastClockIn);
 if(leftActive!==rightActive)return leftActive?-1:1;
 if(leftActive&&rightActive){const delta=timestamp(right.lastClockIn)-timestamp(left.lastClockIn);if(delta!==0)return delta;}
 const started=timestamp(right.jobStartedOn)-timestamp(left.jobStartedOn);
 if(started!==0)return started;
 return left.name.localeCompare(right.name,'en-CA');
}
test('database labour summaries and pages match existing clock/rate calculations beyond 1000 rows',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon;create role authenticated;
 create table jobs(id uuid primary key,name text,is_feed_visible boolean,source text,contract_amount_cents bigint,accepted_quote_id uuid,metadata jsonb,formatted_address text,address_line_1 text,started_on date,production_month date);
 create table job_budgets(job_id uuid,source text,status text,updated_at timestamptz,version int,closed_at timestamptz,budget_minutes int,hourly_rate_cents int,amount_including_tax_cents bigint);
 create table time_entries(id uuid primary key,job_id uuid,employee_id uuid,job_name text,started_at timestamptz,ended_at timestamptz,status text);
 create table employee_pay_rates(employee_id uuid,effective_from date,hourly_rate_cents int);
 create table job_assignments(job_id uuid,status text);
 insert into jobs select md5(i::text)::uuid,'Job '||lpad(i::text,4,'0'),true,null,100000,null,'{}',null,null,'2026-09-01',null from generate_series(1,1200)i;
 insert into time_entries select md5(i::text)::uuid,md5('1')::uuid,md5('employee')::uuid,'Job 0001','2026-09-01 10:00Z','2026-09-01 11:00Z','completed' from generate_series(1,1200)i;
 insert into employee_pay_rates values(md5('employee')::uuid,'2026-01-01',2500),(md5('employee')::uuid,'2026-09-02',3000),(md5('zero')::uuid,'2026-01-01',0);
 insert into time_entries values
 (md5('active')::uuid,md5('2')::uuid,md5('employee')::uuid,'Job 0002','2026-09-15 10:00:00.123Z',null,'active'),
 (md5('old')::uuid,md5('2')::uuid,md5('employee')::uuid,'Job 0002','2026-09-01 10:00Z','2026-09-01 11:00Z','completed'),
 (md5('unpriced')::uuid,md5('3')::uuid,null,'Job 0003','2026-09-01 10:00Z','2026-09-01 11:00Z','completed'),
 (md5('zero')::uuid,md5('3')::uuid,md5('zero')::uuid,'Job 0003','2026-09-01 10:00Z','2026-09-01 11:00Z','completed');
 insert into job_assignments values(md5('2')::uuid,'active'),(md5('2')::uuid,'inactive');
 insert into job_budgets values(md5('2')::uuid,'manual','active','2026-09-01',1,null,120,3500,200000),(md5('2')::uuid,'project_budget','closed','2026-09-01',9,'2026-09-01',999,9000,999999);
 `);
 for(const file of ['20260915182306_summarize_job_work.sql','20260915182926_paginate_labour_budgets.sql']) await db.exec(fs.readFileSync('../supabase/migrations/'+file,'utf8').replaceAll('"en-CA-x-icu"','"C"'));
 await db.exec("alter table jobs add column updated_at timestamptz default now();create table employees(id uuid primary key,full_name text,email text);");
 await db.exec(fs.readFileSync('../supabase/migrations/20260915190659_summarize_timesheet_options.sql','utf8'));
 const options=(await db.query('select get_timesheet_options() r')).rows[0].r;assert.equal(options.projects.length,1200);assert.deepEqual(Object.keys(options.projects[0]).sort(),['companycam_id','name']);
 const at='2026-09-15T12:00:00.456Z',now=Date.parse(at);
 const summaries=(await db.query('select get_job_work_summary($1) r',[at])).rows[0].r.rows;
 const raw=(await db.query('select * from time_entries order by started_at desc,id')).rows.map(e=>({...e,started_at:new Date(e.started_at).toISOString(),ended_at:e.ended_at?new Date(e.ended_at).toISOString():null,companycam_project_id:e.job_id,user_id:e.employee_id,project_name:e.job_name}));
 const rates=(await db.query('select * from employee_pay_rates')).rows.map(r=>({...r,effective_from:new Date(r.effective_from).toISOString().slice(0,10),user_id:r.employee_id,hourly_rate:r.hourly_rate_cents/100}));
 const projects=(await db.query('select * from jobs')).rows.map(p=>({companycam_id:p.id,name:p.name,started_on:'2026-09-01',production_month:null,formatted_address:null}));
 const budgets=projects.map(p=>({companycam_project_id:p.companycam_id,amount_including_tax:p.name==='Job 0002'?2000:1000,budgeted_hours:p.name==='Job 0002'?2:null,hourly_rate:p.name==='Job 0002'?35:null,labour_closed_at:null}));
 const assignments=[{companycam_project_id:projects.find(p=>p.name==='Job 0002').companycam_id}];
 const old=metrics.rollupProjects(raw,projects,budgets,assignments,rates,now).sort(compareJobsTableRows);
 const fresh=metrics.rollupProjects([],projects,budgets,[],[],now,summaries).sort(compareJobsTableRows);
 for(let i=0;i<old.length;i++){
 assert.equal(fresh[i].projectId,old[i].projectId);
 for(const key of ['loggedHours','wageCost','unpricedHours','assignedCount'])assert.ok(Math.abs(fresh[i][key]-old[i][key])<1e-8,`${key}: ${fresh[i][key]} vs ${old[i][key]}`);
 }
 const page=async(q='',n=1)=>(await db.query('select get_labour_budgets_page($1,$2,$3) r',[q,n,at])).rows[0].r;
 const seen=[];
 for(let n=1;n<=24;n++) {const p=await page('',n);assert.equal(p.total,1200);assert.equal(p.rows.length,50);seen.push(...p.rows.map(r=>r.projectId));assert.equal(p.totals.overCount,metrics.summarizeLabour(old,now).overCount);}
 assert.deepEqual(seen,Array.from(old,r=>r.projectId));assert.equal(new Set(seen).size,1200);
 assert.equal((await page('Job 0002')).rows[0].budgetedHours,2);
 assert.equal((await page('not present')).total,0);
 assert.equal((await page('',999)).rows.length,50);
 const perms=(await db.query("select has_function_privilege('anon','get_labour_budgets_page(text,integer,timestamptz)','execute') allowed")).rows[0];assert.equal(perms.allowed,false);
 }finally{await db.close();}
});
