import assert from 'node:assert/strict';
import test from 'node:test';
import {annotationDocumentSchema,annotationPoint} from '../src/lib/photo-annotations.ts';
const arrow=()=>({id:crypto.randomUUID(),type:'arrow',points:[{x:.1,y:.2},{x:.8,y:.7}],color:'#ff0000',width:.004});
test('all supported drawing types retain normalized coordinates',()=>{
 for(const type of ['arrow','line','rectangle','ellipse','draw','text']) {
  const item={...arrow(),type};if(type==='text'){item.points=[{x:.1,y:.1}];item.text='Touch up here';item.fontSize=.035;}
  assert.deepEqual(annotationDocumentSchema.parse({version:1,shapes:[item]}),{version:1,shapes:[item]});
 }
});
test('invalid executable styles, malformed geometry and duplicate shapes are rejected',()=>{
 const item=arrow();
 for(const shapes of [[{...item,color:'url(https://example.com)'}],[{...item,points:[{x:2,y:0},{x:1,y:1}]}],[{...item,points:[{x:NaN,y:0},{x:1,y:1}]}],[item,item],[{...item,text:'unexpected'}]])
  assert.equal(annotationDocumentSchema.safeParse({version:1,shapes}).success,false);
});
test('pointer coordinates scale with the displayed original and clamp at its edges',()=>{
 assert.deepEqual(annotationPoint(250,150,{left:50,top:50,width:400,height:200}),{x:.5,y:.5});
 assert.deepEqual(annotationPoint(-10,1000,{left:0,top:0,width:400,height:200}),{x:0,y:1});
});
