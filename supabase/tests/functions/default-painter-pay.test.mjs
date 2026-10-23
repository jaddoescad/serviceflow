import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from '../../../web/node_modules/typescript/lib/typescript.js';

const source = readFileSync(new URL('../../functions/project-assignments/index.ts', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('async function createEmployee('));
const compiled = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const createEmployee = new Function(`${compiled}; return createEmployee;`)();

function fixture(rateError = null) {
  const rates = [];
  const deleted = [];
  const employee = { id: 'new-painter', role: 'painter' };
  const client = {
    auth: { admin: {
      createUser: async () => ({ data: { user: { id: employee.id, created_at: '2026-10-11T14:00:00Z' } }, error: null }),
      deleteUser: async (id) => { deleted.push(id); },
    } },
    from(table) {
      if (table === 'employees') return { upsert: () => ({ select: () => ({ single: async () => ({ data: employee, error: null }) }) }) };
      assert.equal(table, 'employee_pay_rates');
      return { insert: async (rate) => { rates.push(rate); return { error: rateError }; } };
    },
  };
  return { client, rates, deleted };
}
const input = { email: 'test@example.com', fullName: 'Test Painter', password: 'test-password' };

test('new painters receive $30/hour effective on account creation date', async () => {
  const f = fixture();
  await createEmployee(f.client, input, { role: 'admin' });
  assert.deepEqual(f.rates, [{ employee_id: 'new-painter', hourly_rate_cents: 3000, effective_from: '2026-10-11' }]);
  assert.deepEqual(f.deleted, []);
});

test('manager creation does not assign a painter pay rate', async () => {
  const f = fixture();
  await createEmployee(f.client, { ...input, role: 'manager' }, { role: 'admin' });
  assert.deepEqual(f.rates, []);
});

test('a pay rate failure fails creation and cleans up the new account', async () => {
  const f = fixture({ message: 'Rate save failed' });
  await assert.rejects(createEmployee(f.client, input, { role: 'admin' }), /Rate save failed/);
  assert.deepEqual(f.deleted, ['new-painter']);
});
