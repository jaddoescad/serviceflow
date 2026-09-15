import assert from 'node:assert/strict';
import test from 'node:test';
import {changeAnnotations,undoAnnotations,redoAnnotations,moveAnnotation,fittedPhoto} from '../src/lib/annotation-history.ts';
const empty={version:1,shapes:[]};
const shape={id:crypto.randomUUID(),type:'arrow',points:[{x:.2,y:.3},{x:.8,y:.9}],color:'#ff0000',width:.005};
test('undo and redo preserve drawings; a new edit discards the redo branch',()=>{
 const start={past:[],present:empty,future:[]};const doc={version:1,shapes:[shape]};
 const changed=changeAnnotations(start,doc);const undone=undoAnnotations(changed);
 assert.deepEqual(undone.present,empty);assert.deepEqual(redoAnnotations(undone).present,doc);
 assert.equal(changeAnnotations(undone,empty).future.length,0);assert.deepEqual(start.present,empty);
});
test('moving a drawing clamps the whole geometry without distorting it',()=>{
 const moved=moveAnnotation(shape,1,-1);
 assert.equal(moved.points[1].x,1);assert.equal(moved.points[0].y,0);
 assert.ok(Math.abs((moved.points[1].x-moved.points[0].x)-.6)<1e-9);
 assert.deepEqual(shape.points,[{x:.2,y:.3},{x:.8,y:.9}]);
});
test('overlay fits landscape and portrait photos in the same image rectangle',()=>{
 assert.deepEqual(fittedPhoto(1000,500,2,0),{left:0,top:0,width:1000,height:500});
 assert.deepEqual(fittedPhoto(1000,500,.5,0),{left:375,top:0,width:250,height:500});
});
