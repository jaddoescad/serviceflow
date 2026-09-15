"use client";

import {useCallback,useEffect,useRef,useState,type SetStateAction} from 'react';
import {loadLinkedPhoto} from '@/lib/actions/linked-photo';
import {photoIdFromHash,photoLink} from '@/lib/photo-link';
import type {ProjectMediaItem} from '@/lib/project-data';

export function useLinkedPhoto(projectId:string,items:ProjectMediaItem[],canLeave:()=>boolean) {
  const [id,setId]=useState<string|null>(null);
  const current=useRef<string|null>(null);
  const [result,setResult]=useState<{projectId:string;id:string;item:ProjectMediaItem|null;error?:string}|null>(null);
  const [attempt,setAttempt]=useState(0);
  const found=items.some(item=>item.id===id);
  useEffect(()=>{
    function read() {
      const next=photoIdFromHash(window.location.hash);
      if(next!==current.current&&!canLeave()) {
        window.history.replaceState(window.history.state,'',photoLink(window.location.pathname,window.location.search,current.current));
        return;
      }
      current.current=next;setId(next);
    }
    read();window.addEventListener('hashchange',read);window.addEventListener('popstate',read);
    return ()=>{window.removeEventListener('hashchange',read);window.removeEventListener('popstate',read);};
  },[projectId,canLeave]);
  const select=useCallback((value:SetStateAction<string|null>)=>{
    const next=typeof value==='function'?value(current.current):value;
    current.current=next;setId(next);
    window.history.replaceState(window.history.state,'',photoLink(window.location.pathname,window.location.search,next));
  },[]);
  useEffect(()=>{
    if(!id||found)return;
    let disposed=false;
    setResult(null);
    loadLinkedPhoto(projectId,id).then(item=>{
      if(!disposed)setResult({projectId,id,item,...(!item?{error:'This photo is unavailable or you do not have access.'}:{})});
    }).catch(()=>{if(!disposed)setResult({projectId,id,item:null,error:'Could not open this photo. Try again.'});});
    return ()=>{disposed=true;};
  },[id,found,projectId,attempt]);
  const matching=result?.projectId===projectId&&result.id===id?result:null;
  return {id,select,item:matching?.item??null,error:matching?.error,
    loading:!!id&&!found&&!matching,retry:()=>setAttempt(value=>value+1)};
}
