"use client";
import { useRef, useState } from "react";

export function ProjectPhotoCanvas({src,alt}:{src:string;alt:string}) {
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
    <div className="absolute inset-x-0 top-3 z-10 flex justify-center gap-1">
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
        <img key={retry} src={retry?`${src}?retry=${retry}`:src} alt={alt} draggable={false} decoding="async" onError={()=>setFailed(true)} className="absolute inset-0 h-full w-full max-w-none object-contain p-3"/>}
      </div>
    </div>
  </div>;
}
