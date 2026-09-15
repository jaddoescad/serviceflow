"use client";
import { useEffect, useRef, useState } from "react";

import {PhotoAnnotationSurface} from './photo-annotation-surface';
import dynamic from 'next/dynamic';
import {loadPhotoAnnotations} from '@/lib/actions/photo-annotations';
import {emptyAnnotations,type AnnotationDocument} from '@/lib/photo-annotations';

const PhotoAnnotationEditor=dynamic(()=>import('./photo-annotation-editor').then(module=>module.PhotoAnnotationEditor),{ssr:false});

export function ProjectPhotoCanvas({src,alt,projectId,mediaId}:{src:string;alt:string;projectId:string;mediaId:string}) {
  const [annotations,setAnnotations]=useState<AnnotationDocument>(emptyAnnotations);
  const [revision,setRevision]=useState<string|null>(null);
  const [loaded,setLoaded]=useState(false);
  const [annotationError,setAnnotationError]=useState(false);
  const [editing,setEditing]=useState(false);
  const [loadAttempt,setLoadAttempt]=useState(0);
  useEffect(()=>{let disposed=false;setLoaded(false);setAnnotationError(false);
    void loadPhotoAnnotations(projectId,mediaId).then(result=>{if(disposed)return;if(result.ok){setAnnotations(result.document);setRevision(result.revision);setLoaded(true);}else setAnnotationError(true);}).catch(()=>{if(!disposed)setAnnotationError(true);});
    return()=>{disposed=true;};
  },[projectId,mediaId,loadAttempt]);
  const [zoom,setZoom]=useState(1);
  const [failed,setFailed]=useState(false);
  const [retry,setRetry]=useState(0);
  const viewport=useRef<HTMLDivElement>(null);
  const scroll=useRef<HTMLDivElement>(null);
  const drag=useRef<{x:number;y:number;left:number;top:number}|null>(null);
  async function fullscreen() {
    try {if(document.fullscreenElement)await document.exitFullscreen();else await viewport.current?.requestFullscreen();} catch {/* Browser can refuse fullscreen; normal viewer remains available. */}
  }
  return <div ref={viewport} className="relative h-full w-full bg-black" onTouchStart={event=>{if(zoom>1)event.stopPropagation();}}>
    {editing?<PhotoAnnotationEditor src={src} alt={alt} projectId={projectId} mediaId={mediaId} initial={annotations} revision={revision} onClose={()=>setEditing(false)} onSaved={(document,nextRevision)=>{setAnnotations(document);setRevision(nextRevision);setEditing(false);}}/>:null}
    <div className="absolute inset-x-0 top-3 z-10 flex flex-wrap justify-center gap-1">
      <button disabled={!loaded||failed} onClick={async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();setEditing(true);}catch{setAnnotationError(true);}}} className="rounded bg-black/75 px-3 py-2 text-xs text-white disabled:opacity-40">Edit photo</button>
      {annotationError?<button onClick={()=>setLoadAttempt(value=>value+1)} className="rounded bg-black/75 px-3 py-2 text-xs text-amber-200">Drawings unavailable · Retry</button>:null}
      <button onClick={()=>setZoom(value=>Math.max(1,value-0.5))} disabled={zoom===1} aria-label="Zoom out" className="rounded bg-black/75 px-3 py-2 text-white disabled:opacity-40">−</button>
      <button onClick={()=>{setZoom(1);scroll.current?.scrollTo(0,0);}} aria-label="Reset zoom" className="rounded bg-black/75 px-3 py-2 text-xs text-white">{Math.round(zoom*100)}%</button>
      <button onClick={()=>setZoom(value=>Math.min(4,value+0.5))} disabled={zoom===4} aria-label="Zoom in" className="rounded bg-black/75 px-3 py-2 text-white disabled:opacity-40">＋</button>
      <button onClick={()=>void fullscreen()} aria-label="Toggle fullscreen photo" className="rounded bg-black/75 px-3 py-2 text-xs text-white">Fullscreen</button>
    </div>
    <div ref={scroll} className={`h-full w-full overflow-auto ${zoom>1?'touch-auto cursor-grab active:cursor-grabbing':''}`}
      onPointerDown={event=>{if(zoom<=1||event.pointerType!=='mouse')return;const el=event.currentTarget;drag.current={x:event.clientX,y:event.clientY,left:el.scrollLeft,top:el.scrollTop};el.setPointerCapture(event.pointerId);}}
      onPointerMove={event=>{if(!drag.current)return;event.currentTarget.scrollLeft=drag.current.left+drag.current.x-event.clientX;event.currentTarget.scrollTop=drag.current.top+drag.current.y-event.clientY;}}
      onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
      <div className="relative min-h-full min-w-full" style={{width:`${zoom*100}%`,height:`${zoom*100}%`}}>
        {failed?<div role="alert" className="absolute inset-0 flex items-center justify-center gap-3 text-sm text-white">Photo could not load.<button onClick={()=>{setFailed(false);setRetry(value=>value+1);}} className="underline">Retry</button></div>:
        <PhotoAnnotationSurface key={retry} src={retry?`${src}?retry=${retry}`:src} alt={alt} document={annotations} onError={()=>setFailed(true)}/>}
      </div>
    </div>
  </div>;
}
