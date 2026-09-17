import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('calculator publish commits together and rolls back when a downstream mutation fails', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
      create table writes(kind text);
      create table public.jobs(id uuid primary key, started_on date, status text);
      insert into public.jobs values ('00000000-0000-0000-0000-000000000001', '2026-09-01', 'active');
      create function public.save_job_task(uuid,uuid,text,text,integer,integer) returns void language sql as $$ insert into public.writes values ('task') $$;
      create function public.save_job_budget(uuid,integer,integer,bigint,text) returns void language sql as $$ insert into public.writes values ('budget') $$;
      create function public.publish_quote(uuid,uuid,text,bigint,jsonb,text) returns void language plpgsql as $$ begin
        if $6 = 'fail' then raise exception 'Quote rejected'; end if;
        insert into public.writes values ('quote');
      end $$;
    `);
    await db.exec(readFileSync(new URL('../supabase/migrations/20260917182928_publish_calculator_budget_atomically.sql', import.meta.url), 'utf8'));
    const payload = { tasks: [{ title: 'Paint', minutes: 60, sortOrder: 0 }, { title: 'Prep', minutes: 30, sortOrder: 1 }], minutes: 90, amountCents: 10000, quoteAmountCents: 10000, quoteStatus: 'draft', doc: {} };
    const publish = (value) => db.query('select publish_calculator_budget($1,$2)', ['00000000-0000-0000-0000-000000000001', JSON.stringify(value)]);
    await publish(payload);
    assert.deepEqual((await db.query('select kind from writes')).rows.map(row => row.kind), ['task', 'task', 'budget', 'quote']);
    await db.exec('truncate writes');
    await assert.rejects(publish({ ...payload, quoteStatus: 'fail' }), /Quote rejected/);
    assert.equal((await db.query('select count(*)::int as count from writes')).rows[0].count, 0);
    await db.exec("update public.jobs set started_on='2026-05-01'");
    await assert.rejects(publish(payload), /Historical job accounting is locked/);
    assert.equal((await db.query('select count(*)::int as count from writes')).rows[0].count, 0);
    assert.equal((await db.query("select has_function_privilege('anon','public.publish_calculator_budget(uuid,jsonb)','EXECUTE') as allowed")).rows[0].allowed, false);
  } finally { await db.close(); }
});
