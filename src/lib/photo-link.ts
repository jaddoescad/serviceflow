const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function photoIdFromHash(hash:string):string|null {
  const id=new URLSearchParams(hash.replace(/^#/, '')).get('photo');
  return id&&UUID.test(id)?id:null;
}
export function photoLink(path:string,search:string,id:string|null):string {
  return `${path}${search}${id&&UUID.test(id)?`#photo=${id}`:''}`;
}
export function validPhotoId(id:string):boolean { return UUID.test(id); }
