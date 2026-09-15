"use client";
import { useState } from "react";

export function ProjectMediaPreview({src,alt,video=false}:{src:string;alt:string;video?:boolean}) {
  const [attempt,setAttempt]=useState(0);
  if(attempt>1||video&&attempt>0)return <span role="img" aria-label={alt} className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-slate-500">{video?'▶ Open video':'Preview unavailable. Open photo to view.'}</span>;
  return <img src={attempt===0?`${src}?preview=1`:src} alt={alt} loading="lazy" decoding="async"
    onError={()=>setAttempt(current=>current+1)}
    className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"/>;
}
