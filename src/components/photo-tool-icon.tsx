export function PhotoToolIcon({name}:{name:'edit'|'fullscreen'|'minus'|'plus'|'download'|'trash'}) {
  const paths={edit:'M4 16L16 4l4 4L8 20H4zM14 6l4 4',fullscreen:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',minus:'M8 12h8',plus:'M8 12h8M12 8v8',download:'M12 3v13M7 11l5 5 5-5M5 21h14',trash:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7'};
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{name==='minus'||name==='plus'?<circle cx="12" cy="12" r="9"/>:null}<path d={paths[name]}/></svg>;
}
