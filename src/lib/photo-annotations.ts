import {z} from 'zod';

const point=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1)}).strict();
const shape=z.object({
  id:z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  type:z.enum(['arrow','line','rectangle','ellipse','draw','text']),
  points:z.array(point).min(1).max(2000),
  color:z.string().regex(/^#[0-9a-fA-F]{6}$/),
  width:z.number().min(0.001).max(0.05),
  text:z.string().min(1).max(1000).optional(),
  fontSize:z.number().min(0.01).max(0.2).optional(),
}).strict().superRefine((value,ctx)=>{
  if(value.type==='text') {
    if(value.points.length!==1||value.text===undefined||value.fontSize===undefined)
      ctx.addIssue({code:'custom',message:'Text requires one position, text and font size.'});
  } else {
    if(value.text!==undefined||value.fontSize!==undefined)
      ctx.addIssue({code:'custom',message:'Only text annotations may contain text.'});
    if(value.type==='draw'?value.points.length<2:value.points.length!==2)
      ctx.addIssue({code:'custom',message:'Invalid shape points.'});
  }
});
export const annotationDocumentSchema=z.object({version:z.literal(1),shapes:z.array(shape).max(200)}).strict()
  .superRefine((value,ctx)=>{
    if(new Set(value.shapes.map(item=>item.id)).size!==value.shapes.length)
      ctx.addIssue({code:'custom',message:'Duplicate shape IDs.'});
    if(new TextEncoder().encode(JSON.stringify(value)).byteLength>262144)
      ctx.addIssue({code:'custom',message:'Drawing is too large.'});
  });
export type AnnotationDocument=z.infer<typeof annotationDocumentSchema>;
export type AnnotationShape=AnnotationDocument['shapes'][number];
export type AnnotationPoint=AnnotationShape['points'][number];
export const emptyAnnotations=():AnnotationDocument=>({version:1,shapes:[]});

/** Store normalized coordinates so drawings follow the original at every size. */
export function annotationPoint(clientX:number,clientY:number,rect:{left:number;top:number;width:number;height:number}):AnnotationPoint {
  return {x:Math.min(1,Math.max(0,(clientX-rect.left)/Math.max(1,rect.width))),
    y:Math.min(1,Math.max(0,(clientY-rect.top)/Math.max(1,rect.height)))};
}
