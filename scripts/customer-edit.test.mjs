import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('customer editing preserves metadata, normalizes fields and rejects stale or unauthorized writes', async () => {
  const db = new PGlite();
  const id = '11111111-1111-4111-8111-111111111111';
  try {
    await db.exec(`create role anon; create role authenticated; create schema private;
      create function private.is_manager() returns boolean language sql as $$select current_setting('test.manager',true)='true'$$;
      create table contacts(id uuid, kind text, name text, email text, phone text, normalized_email text, normalized_phone text, metadata jsonb, updated_at timestamptz);
      insert into contacts values('${id}','customer','QA',null,null,null,null,'{"source":"fixture","customer_notes":"Preserve me"}','2026-09-15');
      set test.manager='true';`);
    await db.exec(await readFile(new URL('../supabase/migrations/20260916040000_update_customer_contact.sql', import.meta.url),'utf8'));
    await db.exec('set role authenticated');
    await db.query('select update_customer_contact($1,$2,$3,$4,$5,$6)',[id,'2026-09-15',' New name ','QA@EXAMPLE.COM','(613) 555-0100',' Address ']);
    await db.exec('reset role');
    const row=(await db.query('select * from contacts')).rows[0];
    assert.equal(row.name,'New name'); assert.equal(row.normalized_email,'qa@example.com'); assert.equal(row.normalized_phone,'6135550100');
    assert.deepEqual(row.metadata,{source:'fixture',customer_notes:'Preserve me',address:'Address'});
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select update_customer_contact($1,$2,$3,$4,$5,$6)',[id,'2026-09-15','Stale','','','']),/changed/);
    await db.exec("set test.manager='false'");
    await assert.rejects(db.query('select update_customer_contact($1,$2,$3,$4,$5,$6)',[id,row.updated_at,'Blocked','','','']),/manager/);
    await db.exec('set role anon');
    await assert.rejects(db.query('select update_customer_contact($1,$2,$3,$4,$5,$6)',[id,row.updated_at,'Blocked','','','']),/permission denied/);
  } finally { await db.close(); }
});
