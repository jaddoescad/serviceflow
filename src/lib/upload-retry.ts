export class UploadFailure extends Error {
  readonly transient: boolean;
  readonly retryAfterMs: number;
  constructor(message: string, transient = false, retryAfterMs = 0) {
    super(message);
    this.transient = transient;
    this.retryAfterMs = retryAfterMs;
  }
}

export function uploadFailure(message:string,status:number,retryAfter:string|null=null,now=Date.now()) {
  const seconds=retryAfter===null?NaN:Number(retryAfter);
  const delay=Number.isFinite(seconds)?seconds*1000:Date.parse(retryAfter??'')-now;
  return new UploadFailure(message,status===0||status===408||status===429||status>=500,
    Number.isFinite(delay)?Math.min(300000,Math.max(0,delay)):0);
}

/** Three automatic retries, always using the existing file/request identity. */
export function uploadRetryAt(error:unknown,attempts:number,now=Date.now()):number|null {
  if(!(error instanceof UploadFailure)||!error.transient||attempts>=4)return null;
  return now+Math.max([1000,3000,8000][Math.max(0,attempts-1)]??8000,error.retryAfterMs);
}
