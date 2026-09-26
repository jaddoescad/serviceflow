"use client";

import {useEffect,useRef,useState,type SVGProps} from 'react';
import {fittedPhoto} from '@/lib/annotation-history';
import type {AnnotationDocument,AnnotationShape} from '@/lib/photo-annotations';

type SurfaceProps={src:string;alt:string;document:AnnotationDocument;padding?:number;selected?:string|null;onError?:()=>void;
  handlers?:Pick<SVGProps<SVGSVGElement>,'onPointerDown'|'onPointerMove'|'onPointerUp'|'onPointerCancel'|'onKeyDown'>};
function Drawing({shape,aspect,selected}:{shape:AnnotationShape;aspect:number;selected:boolean}) {
  const h=1000/aspect,unit=Math.min(1000,h),width=shape.width*unit;
  const p=shape.points.map(point=>({x:point.x*1000,y:point.y*h}));const a=p[0],b=p[1]??a;
  let element;
  if(shape.type==='rectangle')element=<rect x={Math.min(a.x,b.x)} y={Math.min(a.y,b.y)} width={Math.abs(b.x-a.x)} height={Math.abs(b.y-a.y)}/>;
  else if(shape.type==='ellipse')element=<ellipse cx={(a.x+b.x)/2} cy={(a.y+b.y)/2} rx={Math.abs(b.x-a.x)/2} ry={Math.abs(b.y-a.y)/2}/>;
  else if(shape.type==='text')element=<text x={a.x} y={a.y} dominantBaseline="hanging" fill={shape.color} stroke="#111827" strokeWidth={Math.max(1,width/3)} paintOrder="stroke" fontSize={(shape.fontSize??.035)*unit} fontFamily="Arial, sans-serif">{shape.text?.split('\n').map((line,index)=><tspan key={index} x={a.x} dy={index?'1.2em':0}>{line}</tspan>)}</text>;
  else {
    let d=p.map((point,index)=>`${index?'L':'M'}${point.x},${point.y}`).join(' ');
    if(shape.type==='arrow') {
      const angle=Math.atan2(b.y-a.y,b.x-a.x),size=Math.max(12,width*5);
      d+=` M${b.x-size*Math.cos(angle-.5)},${b.y-size*Math.sin(angle-.5)} L${b.x},${b.y} L${b.x-size*Math.cos(angle+.5)},${b.y-size*Math.sin(angle+.5)}`;
    }
    element=<path d={d}/>;
  }
  return <g data-shape-id={shape.id} stroke={shape.color} strokeWidth={width} fill="none" strokeLinecap="round" strokeLinejoin="round" style={selected?{filter:'drop-shadow(0 0 3px white)'}:undefined}>{element}</g>;
}
export function PhotoAnnotationSurface({src,alt,document,padding=12,selected=null,onError,handlers}:SurfaceProps) {
  const root=useRef<HTMLDivElement>(null);
  const [size,setSize]=useState({width:0,height:0});
  const [aspect,setAspect]=useState(1);
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{
    if(!root.current)return;
    const observer=new ResizeObserver(entries=>{const rect=entries[0].contentRect;setSize({width:rect.width,height:rect.height});});
    observer.observe(root.current);return()=>observer.disconnect();
  },[]);
  const bounds=fittedPhoto(size.width,size.height,aspect,padding);
  return <div ref={root} className="absolute inset-0">
    <div className="absolute" style={bounds}>
      <img src={src} alt={alt} draggable={false} onError={onError} onLoad={event=>{setAspect(event.currentTarget.naturalWidth/event.currentTarget.naturalHeight);setLoaded(true);}} className="absolute inset-0 h-full w-full"/>
      {loaded?<svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 1000 ${1000/aspect}`} className={`absolute inset-0 h-full w-full ${handlers?'touch-none':'pointer-events-none'}`} role={handlers?'img':undefined} aria-label={handlers?'Photo drawing canvas':undefined} aria-hidden={handlers?undefined:true} tabIndex={handlers?0:undefined} {...handlers}>
        {document.shapes.map(shape=><Drawing key={shape.id} shape={shape} aspect={aspect} selected={selected===shape.id}/>)}</svg>:null}
    </div>
  </div>;
}
