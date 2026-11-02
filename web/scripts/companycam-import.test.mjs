import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceUuid, projectMap, sourceUrl, renderPage } from './companycam-import-lib.mjs';

test('ambiguous CompanyCam project links cannot choose a destination', () => {
  const map = projectMap([{id:'first',companycam_project_ids:['123']},{id:'second',companycam_project_ids:['123']}]);
  assert.equal(map.get('123'), null);
  assert.notEqual(sourceUuid('page','123'),sourceUuid('photo','123'));
});
test('copies page photos into authenticated paths and preserves text and checklists', async () => {
  const local = '/api/jobs/11111111-1111-4111-a111-111111111111/documents/22222222-2222-4222-a222-222222222222/images/33333333-3333-4333-a333-333333333333';
  const page = {tiptap_content:{type:'doc',content:[
    {type:'heading',attrs:{level:2},content:[{type:'text',text:'Scope <script>alert(1)</script>'}]},
    {type:'taskList',content:[{type:'taskItem',attrs:{checked:true},content:[{type:'paragraph',content:[{type:'text',text:'Protect floors'}]}]}]},
    {type:'flexGroup',content:[{type:'flexPhoto',attrs:{src:'https://img.companycam.com/photo.jpg'},content:[{type:'flexPhoto_textSlot',content:[{type:'paragraph',content:[{type:'text',text:'Before'}]}]}]}]},
  ]}};
  const result = await renderPage(page, async () => local);
  assert.equal(result.images,1);
  assert.ok(result.html.includes(`<img src="${local}"`));
  assert.ok(result.html.includes('data-checked="true"'));
  assert.ok(result.html.includes('Before'));
  assert.ok(!result.html.includes('<script>'));
  assert.ok(!result.html.includes('https://img.companycam.com'));
});
test('fails visibly on unsupported content and rejects private-network image URLs', async () => {
  for(const url of ['http://img.companycam.com/a','https://127.0.0.1/a','https://companycam.com.evil.test/a']) assert.throws(()=>sourceUrl(url));
  await assert.rejects(renderPage({tiptap_content:{type:'newUnsupportedPhoto'}},async()=>''),/Unsupported/);
});
