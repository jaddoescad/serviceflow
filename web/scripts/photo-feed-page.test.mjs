import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
test('photo cursors retain null dates, ties, complete filters and RLS past 1000 records',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;
 create table jobs(id uuid primary key,name text,formatted_address text,address_line_1 text);
 create table contacts(id uuid primary key,name text);
 create table leads(id uuid primary key,contact_id uuid,address text,city text,province text,postal_code text);
 create table employees(id uuid primary key,full_name text,email text);
 create table job_media(id uuid primary key,job_id uuid,lead_id uuid,uploaded_by uuid,media_type text,mime_type text,duration_ms int,captured_at timestamptz,created_at timestamptz,source_metadata jsonb);
 insert into jobs values(md5('job')::uuid,'Project','Address',null);
 insert into contacts values(md5('contact')::uuid,'Contact');
 insert into leads values(md5('lead')::uuid,md5('contact')::uuid,'Canada','Ottawa','ON',null);
 insert into job_media select md5(i::text)::uuid,case when i%2=0 then md5('job')::uuid end,case when i%2=1 then md5('lead')::uuid end,null,case when i%3=0 then 'video' else 'image' end,'image/jpeg',null,case when i<=1000 then '2026-09-01T00:00Z'::timestamptz end,'2026-09-02T00:00Z','{"creator_name":"Painter"}' from generate_series(1,1205)i;
 `);
 await db.exec(fs.readFileSync('../supabase/migrations/20260915183402_paginate_photo_feed.sql','utf8').replaceAll('"en-CA-x-icu"','"C"'));
 await db.exec(fs.readFileSync('../supabase/migrations/20260915190833_plan_photo_filters_per_request.sql','utf8').replaceAll('"en-CA-x-icu"','"C"'));
 const page=async(cursor=null,media=null)=>(await db.query('select get_photo_feed_page(null,null,$1,null,$2) r',[media,cursor?JSON.stringify(cursor):null])).rows[0].r;
 const expected=(await db.query('select id from job_media order by captured_at desc nulls last,created_at desc,id desc')).rows.map(r=>r.id);
 let cursor=null,seen=[];
 do{const p=await page(cursor);assert.ok(p.items.length<=60);seen.push(...p.items.map(i=>i.id));cursor=p.nextCursor;}while(cursor);
 assert.deepEqual(seen,expected);assert.equal(new Set(seen).size,1205);
 const videos=await page(null,'video');assert.equal(videos.items.length,60);assert.ok(videos.items.every(i=>i.mediaType==='video'));
 const summary=(await db.query("select get_photo_feed_summary(null,null,'video',null) r")).rows[0].r;
 assert.equal(summary.total,401);assert.equal(summary.creators[0][1],1205);assert.equal(summary.projects.length,2);
 const lead=(await page()).items.find(i=>i.ownerKind==='lead');assert.equal(lead.projectName,'Contact');assert.equal(lead.address,'Ottawa, ON');
 await db.exec(`grant select on jobs,contacts,leads,employees,job_media to authenticated;alter table job_media enable row level security;create policy visible on job_media for select to authenticated using (media_type='image');set role authenticated;`);
 const restricted=(await db.query('select get_photo_feed_summary() r')).rows[0].r;assert.equal(restricted.total,804);assert.equal((await page(null,'video')).items.length,0);
 await db.exec('reset role;');
 assert.equal((await db.query("select has_function_privilege('anon','get_photo_feed_page(uuid,text,text,timestamptz,jsonb)','execute') allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});
