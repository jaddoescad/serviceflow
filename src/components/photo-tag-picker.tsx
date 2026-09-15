"use client";

import { useId, useRef, useState } from 'react';

export function PhotoTagPicker({value,options,onChange,disabled=false,allowCreate=true}: {
  value:string[];options:string[];onChange:(tags:string[])=>void;disabled?:boolean;allowCreate?:boolean;
}) {
  const id=useId();
  const input=useRef<HTMLInputElement>(null);
  const [query,setQuery]=useState('');
  const [open,setOpen]=useState(false);
  const [active,setActive]=useState(0);
  const search=query.trim();
  const available=[...new Set([...options,...value])];
  const matches=available.filter(tag=>!value.includes(tag)&&tag.toLowerCase().includes(search.toLowerCase()));
  const create=allowCreate&&search.length>0&&search.length<=60&&!available.some(tag=>tag.toLowerCase()===search.toLowerCase());
  const choices=[...matches.map(tag=>({tag,label:tag})),...(create?[{tag:search,label:`Create tag "${search}"`}]:[])];
  const highlighted=Math.min(active,Math.max(0,choices.length-1));
  function select(tag:string) {
    if(disabled||value.length>=30)return;
    onChange([...value,tag]);setQuery('');setActive(0);setOpen(false);input.current?.focus();
  }
  return <div className="relative" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setOpen(false);}}>
    <div className="flex min-h-11 flex-wrap items-center gap-1 rounded-md border border-slate-300 bg-white p-2 focus-within:border-blue-600">
      {value.map(tag=><span key={tag} className="inline-flex max-w-full items-center gap-1 rounded bg-slate-100 px-2 py-1 text-sm text-slate-700"><span className="truncate">{tag}</span><button type="button" aria-label={`Remove tag ${tag}`} disabled={disabled} onClick={()=>onChange(value.filter(item=>item!==tag))} className="px-1 text-slate-500">×</button></span>)}
      <input ref={input} autoFocus role="combobox" aria-label="Find tags" aria-autocomplete="list" aria-expanded={open&&!disabled} aria-controls={`${id}-list`} aria-activedescendant={open&&choices.length?`${id}-${highlighted}`:undefined} value={query} disabled={disabled} maxLength={60} placeholder={value.length?'':allowCreate?'Find tags or create them…':'Find tags…'} onFocus={()=>setOpen(true)} onChange={event=>{setQuery(event.target.value);setActive(0);setOpen(true);}} onKeyDown={event=>{
        if(event.key==='ArrowDown'||event.key==='ArrowUp') {event.preventDefault();event.stopPropagation();setOpen(true);setActive(current=>Math.max(0,Math.min(choices.length-1,current+(event.key==='ArrowDown'?1:-1))));}
        else if(event.key==='Enter') {event.preventDefault();event.stopPropagation();if(open&&choices[highlighted])select(choices[highlighted].tag);}
        else if(event.key==='Escape'&&open) {event.preventDefault();event.stopPropagation();setOpen(false);}
      }} className="min-w-24 flex-1 bg-transparent py-1 text-sm outline-none"/>
    </div>
    {open&&!disabled?<div id={`${id}-list`} role="listbox" aria-label="Matching tags" className="absolute left-0 right-0 top-full z-40 mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
      {choices.map((choice,index)=><div key={choice.tag} id={`${id}-${index}`} role="option" aria-selected={index===highlighted} onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>setActive(index)} onClick={()=>select(choice.tag)} className={`cursor-pointer px-3 py-2 text-sm ${index===highlighted?'bg-blue-600 text-white':'text-slate-700'}`}>{choice.label}</div>)}
      {!choices.length?<p className="px-3 py-2 text-sm text-slate-500">No matching tags</p>:null}
    </div>:null}
  </div>;
}
