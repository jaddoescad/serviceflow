import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

test('contact pagination retains canonical grouping, fallbacks and complete counts beyond 1000 rows', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create table contacts(id text primary key,name text,email text,phone text,kind text,metadata jsonb,created_at timestamptz,updated_at timestamptz);
      create table quotes(id text primary key,status text,accepted_at timestamptz,lead_id text);
      create table leads(id text primary key,contact_id text,address text,city text,province text,postal_code text,created_at timestamptz,updated_at timestamptz);
      create table jobs(id text primary key,contact_id text,accepted_quote_id text,lead_id text,is_feed_visible boolean,status text,city text,province text,postal_code text,created_at timestamptz,updated_at timestamptz);
      insert into contacts select 'contact-'||i,'Customer '||lpad(i::text,4,'0'),null,null,'customer','{}','2026-01-01','2026-01-01' from generate_series(1,1200) i;
      insert into leads values ('lead-a','contact-1200','Main Street',null,null,null,'2026-01-01','2026-01-01'),('lead-b','contact-1200','Second Street',null,null,null,'2026-01-01','2026-02-01');
      insert into quotes values ('quote-a','accepted','2026-01-10','lead-a'),('quote-old','accepted','2026-01-01','lead-a'),('quote-hidden','accepted','2026-03-01','lead-a');
      insert into jobs values ('job-a','contact-1200','quote-a','lead-a',true,'active','Ottawa',null,null,'2026-01-01','2026-01-10'),('job-old','contact-1200','quote-old','lead-a',true,'active',null,null,null,'2026-01-01','2026-01-20'),('job-hidden','contact-1200','quote-hidden','lead-a',false,'active',null,null,null,'2026-01-01','2026-03-01');`);
    // ASCII fixture names do not depend on ICU; PGlite has no en-CA ICU collation.
    await db.exec(fs.readFileSync('supabase/migrations/20260915180938_paginate_contacts_summary.sql','utf8').replaceAll('collate "en-CA-x-icu"','collate "C"'));
    const page = async (search='', number=1) => (await db.query('select get_contacts_page($1,$2) as result',[search,number])).rows[0].result;
    const first=await page(), second=await page('',2);
    assert.equal(first.total,1200); assert.equal(first.rows.length,50);
    assert.ok(second.rows.every(row=>!first.rows.some(other=>other.id===row.id)));
    const target=(await page('Customer 1200')).rows[0];
    assert.equal(target.jobCount,1); assert.equal(target.leadCount,1); assert.equal(target.projectCount,2);
    assert.equal(target.address,'Second Street');
    assert.equal((await page('Second Street')).total,1);
    assert.equal((await page('no such customer')).total,0);
    assert.equal((await page('',99999)).rows.length,50);
    // When the accepted canonical job is archived, the active fallback remains selected.
    await db.exec(`update jobs set status='archived' where id='job-a'; update jobs set updated_at='2026-04-01',city='Toronto' where id='job-old';`);
    assert.equal((await page('Customer 1200')).rows[0].address,'Toronto');
    // A second separate deal/job for the same contact must not collapse into the first.
    await db.exec(`insert into quotes values('quote-b','accepted','2026-05-01','lead-b'); insert into jobs values('job-b','contact-1200','quote-b','lead-b',true,'active','Montreal',null,null,'2026-01-01','2026-05-01');`);
    const both=(await page('Customer 1200')).rows[0];
    assert.equal(both.jobCount,2);assert.equal(both.leadCount,0);assert.equal(both.projectCount,2);
  } finally { await db.close(); }
});
