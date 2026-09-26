import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import test from 'node:test';
function moduleAt(path,require){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require});return module.exports;}
const hours=moduleAt('src/lib/hours.ts',()=>({}));
const format=moduleAt('src/lib/format.ts',()=>({}));
const metrics=moduleAt('src/lib/metrics.ts',name=>name.endsWith('/hours')?hours:format);
test('overview clock and location segment summaries match existing calculations',async()=>{
const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;
 create table employees(id uuid primary key,full_name text,email text,is_active boolean);
 create table jobs(id uuid primary key,name text,is_feed_visible boolean,source text,contract_amount_cents bigint,accepted_quote_id uuid,metadata jsonb);
 create table time_entries(id uuid primary key,employee_id uuid,employee_name text,employee_email text,job_id uuid,job_name text,job_address text,client_entry_id text,started_at timestamptz,ended_at timestamptz,status text,segments jsonb,is_on_site boolean,last_distance_meters double precision,clock_in_latitude double precision,clock_in_longitude double precision);
 insert into employees values(md5('emp')::uuid,'Painter',null,true);
 insert into jobs values(md5('job')::uuid,'Project',true,null,0,null,'{}');
 insert into time_entries(id,employee_id,employee_name,job_id,job_name,started_at,ended_at,status) select md5(i::text)::uuid,md5('emp')::uuid,'Painter',md5('job')::uuid,'Project','2026-09-14 10:00Z','2026-09-14 11:00Z','completed' from generate_series(1,1200)i;
 `);
 await db.exec(fs.readFileSync('../supabase/migrations/20260915184531_summarize_overview.sql','utf8').replaceAll('"en-CA-x-icu"','"C"'));
 const now=Date.parse('2026-09-15T12:00:00Z');
 const base={started_at:'2026-09-15T10:00:00.123Z',ended_at:'2026-09-15T11:00:00.789Z',status:'complete',is_on_site:true};
 const cases=[{...base,segments:[]},{...base,is_on_site:false,segments:null},{...base,segments:[{mode:'on_site',startedAt:'2026-09-15T09:00Z',endedAt:'2026-09-15T12:00Z'},{mode:'off_site',startedAt:'2026-09-15T10:00Z',endedAt:'2026-09-15T12:00Z'}]},{...base,status:'active',ended_at:null,segments:[{mode:'off_site',startedAt:'2026-09-15T10:00Z',endedAt:'2026-09-15T10:10Z'}]},{...base,segments:[{mode:'off_site',startedAt:'invalid',endedAt:'invalid'}]},{...base,segments:{}},{...base,segments:[{mode:'off_site',startedAt:'2026-09-15T10:00Z',endedAt:'2026-09-15T10:20Z'}]}];
 for(const e of cases){const actual=(await db.query('select * from admin_entry_durations($1,$2,$3,$4,$5,$6)',[e.started_at,e.ended_at,e.status,JSON.stringify(e.segments),e.is_on_site,new Date(now).toISOString()])).rows[0];const expected=hours.computeDurations(e,now);for(const [a,b] of [['total_ms','totalMs'],['on_site_ms','onSiteMs'],['off_site_ms','offSiteMs']])assert.ok(Math.abs(actual[a]-expected[b])<1e-7,`${a} ${actual[a]} vs ${expected[b]}`);}
 const result=(await db.query('select get_overview_summary($1) r',[new Date(now).toISOString()])).rows[0].r;
 assert.equal(result.hoursThisWeek,1200);assert.equal(result.hoursLastWeek,0);assert.equal(result.onSitePct,100);assert.equal(result.activityEntries.length,1200);assert.equal(result.topProjects[0].hours,1200);assert.equal(result.topEmployees[0].hours,1200);assert.equal(result.dayData.length,14);
 const entries=(await db.query('select * from time_entries')).rows.map(e=>({...e,started_at:new Date(e.started_at).toISOString(),ended_at:new Date(e.ended_at).toISOString()}));
 assert.deepEqual(result.dayData,JSON.parse(JSON.stringify(metrics.hoursByDay(entries,14,now))));
 assert.equal((await db.query("select has_function_privilege('anon','get_overview_summary(timestamptz)','execute') allowed")).rows[0].allowed,false);
}finally{await db.close();}});
