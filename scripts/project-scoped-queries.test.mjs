import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function moduleAt(path, require) {
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, require, console });
  return module.exports;
}
function fixture() {
  const budgets = moduleAt('src/lib/job-budget-selection.ts', () => { throw Error('Unexpected import'); });
  const tables = { jobs: [], job_budgets: [], job_assignments: [] };
  for (let i = 0; i < 1200; i++) {
    const id = `job-${i}`;
    tables.jobs.push({ id, contract_amount_cents: 50000, updated_at: '2026-09-01' });
    tables.job_budgets.push({ job_id: id, source: 'manual', status: 'active', version: 1, updated_at: '2026-09-01', amount_including_tax_cents: 12345, budget_minutes: 120, hourly_rate_cents: 3500 });
    tables.job_assignments.push({ id: `assignment-${i}`, job_id: id, employee_id: 'employee', status: 'active' });
  }
  const reads = [];
  const client = { from(table) {
    let data = tables[table];
    const filters = [];
    const builder = {
      select() { return builder; },
      eq(key, value) { filters.push([key, value]); data = data.filter(row => row[key] === value); return builder; },
      in(key, values) { data = data.filter(row => values.includes(row[key])); return builder; },
      order() { return builder; },
      then(resolve, reject) { reads.push({ table, filters, rows: data.length }); return Promise.resolve({ data: data.slice(0,1000), error: null }).then(resolve, reject); },
    };
    return builder;
  }};
  const queries = moduleAt('src/lib/queries.ts', name => {
    if (name === '@/lib/supabase/server') return { createClient: async () => client };
    if (name === '@/lib/job-budget-selection') return budgets;
    throw Error(`Unexpected import: ${name}`);
  });
  return { queries, tables, reads };
}
test('project beyond the API row cap gets its own budget and assignments', async () => {
  const { queries, reads } = fixture();
  const budget = await queries.getProjectBudgetRows('job-1199');
  const assignments = await queries.getProjectAssignments('job-1199');
  assert.equal(budget.length, 1);
  assert.equal(budget[0].amount_including_tax, 123.45);
  assert.equal(budget[0].budgeted_hours, 2);
  assert.equal(budget[0].hourly_rate, 35);
  assert.equal(assignments.length, 1);
  assert.ok(reads.every(read => read.rows === 1 && read.filters.some(([,value]) => value === 'job-1199')));
});
test('scoping preserves budget precedence and ignores published task budgets', async () => {
  const { queries, tables } = fixture();
  tables.job_budgets.push({ job_id: 'job-1199', source: 'project_budget', status: 'closed', version: 2, updated_at: '2026-09-02', budget_minutes: 180, amount_including_tax_cents: 23456 });
  tables.job_budgets.push({ job_id: 'job-1199', source: 'published', status: 'active', version: 3, updated_at: '2026-09-03', budget_minutes: 99999 });
  const [budget] = await queries.getProjectBudgetRows('job-1199');
  assert.equal(budget.budgeted_hours, 3);
  assert.equal(budget.amount_including_tax, 234.56);
  assert.equal((await queries.getProjectBudgetRows('missing')).length, 0);
});
