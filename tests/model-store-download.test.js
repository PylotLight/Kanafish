import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { downloadVerifiedFile } from '../src/main/tts/modelStore.js'
const bytes = Buffer.from('tiny verified fixture')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const file = { path: 'fixture.bin', size: bytes.length, sha256 }
function response(status, body, headers = {}) { return { status, headers: new Headers(headers), body: body ? new Blob([body]).stream() : null } }
async function fixture(fn) { const dir = await mkdtemp(join(tmpdir(),'kanafish-download-')); try { await fn(dir) } finally { await rm(dir,{recursive:true,force:true}) } }
describe('verified model file downloader', () => {
 test('retries transient failures and resumes valid partial bytes with Range', async () => fixture(async dir => {
  const path=join(dir,'f'), part=path+'.part'; await writeFile(part,bytes.subarray(0,5)); let calls=0, range
  await downloadVerifiedFile({url:'mock:',file,path,fetchImpl:async (_u,opt)=>{ calls++; range=opt.headers.Range; if(calls===1) throw Object.assign(new Error('reset'),{code:'ECONNRESET'}); if(calls===2){const failure=new TypeError('fetch failed');failure.cause=Object.assign(new Error('socket closed'),{code:'UND_ERR_SOCKET'});throw failure} return response(206,bytes.subarray(5),{'content-range':`bytes 5-${bytes.length-1}/${bytes.length}`}) },inactivityTimeoutMs:1000})
  expect(calls).toBe(3); expect(range).toBe('bytes=5-'); expect(await readFile(path)).toEqual(bytes); expect(await stat(part).catch(()=>null)).toBeNull()
 }))
 test('restarts from zero when Range is ignored and emits terminal progress', async () => fixture(async dir => {
  const path=join(dir,'f'); await writeFile(path+'.part',bytes.subarray(0,3)); const progress=[]; let range
  await downloadVerifiedFile({url:'mock:',file,path,fetchImpl:async (_u,opt)=>{range=opt.headers.Range; return response(200,bytes)},onProgress:p=>progress.push(p),completedFiles:2,totalFiles:9,inactivityTimeoutMs:1000})
  expect(range).toBe('bytes=3-'); expect(await readFile(path)).toEqual(bytes); expect(progress.at(-1).terminal).toBe(true); expect(progress.at(-1).completedFiles).toBe(2); expect(progress.at(-1).totalFiles).toBe(9)
 }))
 test('preserves partial content on cancellation and removes complete bad hashes', async () => fixture(async dir => {
  const path=join(dir,'f'), part=path+'.part', controller=new AbortController(); let bodyCancelled=false
  const body=new ReadableStream({start(c){c.enqueue(bytes.subarray(0,4))},cancel(){bodyCancelled=true}})
  const task=downloadVerifiedFile({url:'mock:',file,path,signal:controller.signal,fetchImpl:async()=>({status:200,headers:new Headers(),body}),inactivityTimeoutMs:1000})
  await new Promise(r=>setTimeout(r,10)); controller.abort(new Error('cancel')); await expect(task).rejects.toThrow('cancel'); expect((await stat(part)).size).toBe(4); expect(bodyCancelled).toBe(true)
  const bad={...file,sha256:'0'.repeat(64)}
  await expect(downloadVerifiedFile({url:'mock:',file:bad,path,fetchImpl:async()=>response(200,bytes),inactivityTimeoutMs:1000})).rejects.toThrow(/SHA-256/)
  expect(await stat(part).catch(()=>null)).toBeNull()
 }))
 test('discards malformed Content-Range and retries as clean full download', async () => fixture(async dir => {
  const path=join(dir,'f'); await writeFile(path+'.part',bytes.subarray(0,2)); let calls=0
  await downloadVerifiedFile({url:'mock:',file,path,fetchImpl:async()=>{calls++; return calls===1?response(206,bytes.subarray(2),{'content-range':'bytes 1-20/21'}):response(200,bytes)},inactivityTimeoutMs:1000})
  expect(calls).toBe(2); expect(await readFile(path)).toEqual(bytes)
 }))
 test('allows a continuously active slow stream to exceed the inactivity timeout window', async () => fixture(async dir => {
  const path=join(dir,'f'); let index=0
  const body=new ReadableStream({async pull(controller){
   if(index>=bytes.length){controller.close();return}
   await new Promise(resolve=>setTimeout(resolve,8))
   controller.enqueue(bytes.subarray(index,index+1)); index++
  }})
  await downloadVerifiedFile({url:'mock:',file,path,fetchImpl:async()=>({status:200,headers:new Headers(),body}),inactivityTimeoutMs:30})
  expect(await readFile(path)).toEqual(bytes)
 }))
})
