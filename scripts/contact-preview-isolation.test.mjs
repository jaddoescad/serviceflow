import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import { createRequire } from 'node:module';import assert from 'node:assert/strict';import test from 'node:test';
const require=createRequire(import.meta.url);
test('contact project links render before a stalled or failed photo request',async()=>{
 let rejectPreview;const previews=new Promise((_,reject)=>{rejectPreview=reject;});const module={exports:{}};
 const fixture={id:'contact',name:'Customer',email:null,phone:null,address:null,createdAt:'2026-09-01',projects:[{id:'project',kind:'job',name:'Project',status:'active',createdAt:'2026-09-01',updatedAt:'2026-09-01',media:[],mediaCount:0}]};
 const mocked=name=>{
  if(name==='@/lib/contacts')return{getContactDetail:async()=>fixture};
  if(name==='@/lib/supabase/server')return{createClient:async()=>({})};
  if(name==='@/lib/project-media-previews')return{getProjectMediaPreviews:()=>previews};
  if(name==='@/lib/format')return{fmtDate:()=>'',fmtMoney:()=>''};
  if(name==='@/components/kpi')return{PageHeader:'header'};
  if(name==='@/components/ui')return{Badge:'span',Card:'section',EmptyState:'div'};
  if(name==='next/link')return{default:'a',__esModule:true};
  if(name==='next/image')return{default:'img',__esModule:true};
  if(name==='next/navigation')return{notFound:()=>{throw Error('not found');}};
  return require(name);
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/(app)/contacts/[id]/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:mocked});
 let timeout;try{
 const tree=await Promise.race([module.exports.default({params:Promise.resolve({id:'contact'})}),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('photos blocked contact')),500);})]);
 const hrefs=[];function walk(node){if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(walk);return;}if(node.props?.href)hrefs.push(node.props.href);walk(node.props?.children);}walk(tree);
 assert.ok(hrefs.includes('/jobs/project'));rejectPreview(Error('media unavailable'));await Promise.resolve();
 }finally{clearTimeout(timeout);}
});
