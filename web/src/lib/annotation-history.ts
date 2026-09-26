import type {AnnotationDocument,AnnotationShape} from './photo-annotations';
export type AnnotationHistory={past:AnnotationDocument[];present:AnnotationDocument;future:AnnotationDocument[]};
export function changeAnnotations(state:AnnotationHistory,document:AnnotationDocument):AnnotationHistory {
  return {past:[...state.past,state.present].slice(-50),present:document,future:[]};
}
export function undoAnnotations(state:AnnotationHistory):AnnotationHistory {
  if(!state.past.length)return state;
  return {past:state.past.slice(0,-1),present:state.past[state.past.length-1],future:[state.present,...state.future]};
}
export function redoAnnotations(state:AnnotationHistory):AnnotationHistory {
  if(!state.future.length)return state;
  return {past:[...state.past,state.present],present:state.future[0],future:state.future.slice(1)};
}
export function moveAnnotation(shape:AnnotationShape,dx:number,dy:number):AnnotationShape {
  dx=Math.max(-Math.min(...shape.points.map(p=>p.x)),Math.min(dx,1-Math.max(...shape.points.map(p=>p.x))));
  dy=Math.max(-Math.min(...shape.points.map(p=>p.y)),Math.min(dy,1-Math.max(...shape.points.map(p=>p.y))));
  return {...shape,points:shape.points.map(p=>({x:p.x+dx,y:p.y+dy}))};
}
export function fittedPhoto(width:number,height:number,aspect:number,padding=12) {
  const w=Math.max(0,width-padding*2),h=Math.max(0,height-padding*2);
  const fittedWidth=Math.min(w,h*aspect),fittedHeight=fittedWidth/aspect;
  return {left:(width-fittedWidth)/2,top:(height-fittedHeight)/2,width:fittedWidth,height:fittedHeight};
}
