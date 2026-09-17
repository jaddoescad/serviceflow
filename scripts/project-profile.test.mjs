import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('retiring project notes preserves descriptions, contact notes, and manager permissions', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      grant usage on schema auth to authenticated;
      create function auth.uid() returns uuid language sql as $$
        select '00000000-0000-4000-8000-000000000001'::uuid
      $$;
      create table employees (id uuid, is_active boolean, role text);
      insert into employees values (auth.uid(), true, 'manager');
      create table contacts (id uuid primary key, kind text, name text, email text,
        phone text, normalized_email text, normalized_phone text, metadata jsonb,
        created_at timestamptz, updated_at timestamptz);
      create table leads (id uuid primary key, contact_id uuid, address text,
        city text, province text, postal_code text, metadata jsonb, updated_at timestamptz);
      create table jobs (id uuid primary key, lead_id uuid, contact_id uuid,
        formatted_address text, address_line_1 text, city text, province text,
        postal_code text, metadata jsonb, updated_at timestamptz);
      insert into contacts (id, name, metadata) values (auth.uid(), 'Fixture', '{"customer_notes":"Keep contact notes"}');
      insert into leads (id, contact_id, metadata) values (auth.uid(), auth.uid(),
        '{"project_notes":"Remove lead notes","project_description":"Lead description","other":"keep"}');
      insert into jobs (id, lead_id, contact_id, metadata) values
        ('00000000-0000-4000-8000-000000000002', auth.uid(), auth.uid(),
        '{"project_notes":"Remove job notes","project_description":"Job description","other":"keep"}');
    `);
    const oldMigration = await readFile(new URL('../supabase/migrations/20260818131638_shared_project_profile_and_lead_media.sql', import.meta.url), 'utf8');
    await db.exec(oldMigration.slice(oldMigration.indexOf('create or replace function public.save_project_profile(')));
    await db.exec(await readFile(new URL('../supabase/migrations/20260914234011_remove_project_notes.sql', import.meta.url), 'utf8'));
    for (const [table, description] of [['jobs', 'Job description'], ['leads', 'Lead description']]) {
      assert.deepEqual((await db.query(`select metadata from ${table}`)).rows[0].metadata,
        { project_description: description, other: 'keep' });
    }
    await db.exec('set role authenticated');
    for (const id of ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']) {
      await db.query(`select public.save_project_profile($1, 'description', requested_description => 'Updated description')`, [id]);
      await assert.rejects(db.query(`select public.save_project_profile($1, 'notes')`, [id]), /Unsupported project section/);
    }
    await assert.rejects(db.query(`select public.save_project_profile(auth.uid(), 'notes', requested_project_notes => 'retired')`), /does not exist/);
    await db.exec('reset role');
    for (const table of ['jobs', 'leads']) {
      assert.deepEqual((await db.query(`select metadata from ${table}`)).rows[0].metadata,
        { project_description: 'Updated description', other: 'keep' });
    }
    assert.deepEqual((await db.query('select metadata from contacts')).rows[0].metadata,
      { customer_notes: 'Keep contact notes' });
    await db.exec("update employees set role = 'painter'");
    await assert.rejects(db.query(`select public.save_project_profile(auth.uid(), 'description', requested_description => 'Denied')`), /Only active managers/);
    await db.exec('set role anon');
    await assert.rejects(db.query(`select public.save_project_profile('00000000-0000-4000-8000-000000000001', 'description')`), /permission denied/);
  } finally {
    await db.close();
  }
});
