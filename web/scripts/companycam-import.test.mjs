import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceUuid, projectMap, sourceUrl, renderPage, leadMatchesProject } from './companycam-import-lib.mjs';

test('lead matching requires corroborating identity and creation time', () => {
  const lead = {created_at:'2026-03-30T05:47:26Z',contacts:{email:'person@example.com',phone:'6135550123'}};
  const project = {name:'Person Example - 2026-03-29T21:47:26.52',created_at:'2026-10-30T23:51:42Z',primary_contact:{name:'Person Example',email:'person@example.com',phone_number:'6135550123'}};
  assert.equal(leadMatchesProject(lead,project),true);
  assert.equal(leadMatchesProject(lead,{...project,primary_contact:{...project.primary_contact,phone_number:'6135559999'}}),false);
  assert.equal(leadMatchesProject({...lead,contacts:{...lead.contacts,phone:'343364431'}},{...project,primary_contact:{...project.primary_contact,phone_number:'343364431'}}),true);
  assert.equal(leadMatchesProject(lead,{...project,primary_contact:{...project.primary_contact,email:'other@example.com'}}),false);
  assert.equal(leadMatchesProject({...lead,created_at:'2026-10-30T23:51:30Z'},project),true);
  assert.equal(leadMatchesProject({...lead,created_at:'2026-03-29T21:47:26Z'},project),true);
  assert.equal(leadMatchesProject({...lead,created_at:'2026-10-31T03:51:35Z'},project),true);
  assert.equal(leadMatchesProject({...lead,created_at:'2026-03-29T04:00:00Z'},project),true);
  assert.equal(leadMatchesProject({...lead,created_at:'2026-10-30T23:49:00Z'},project),false);
});

test('lead matching without a source contact requires address, name, and nearby creation time', () => {
  const lead = {created_at:'2026-08-31T15:56:48Z',address:'305 Cresthaven Dr, Ottawa, ON, K2G 4R5',contacts:{name:'Usha Usha'}};
  const project = {name:'Usha',created_at:'2026-08-31T19:42:23Z',address:{street_address_1:'305 Cresthaven Dr',city:'Ottawa',postal_code:'K2G 4R5'}};
  assert.equal(leadMatchesProject(lead,project),true);
  assert.equal(leadMatchesProject({...lead,address:'306 Cresthaven Dr, Ottawa, ON, K2G 4R5'},project),false);
  assert.equal(leadMatchesProject({...lead,contacts:{name:'Other Person'}},project),false);
  assert.equal(leadMatchesProject({...lead,created_at:'2026-08-30T15:56:48Z'},project),false);
});

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
