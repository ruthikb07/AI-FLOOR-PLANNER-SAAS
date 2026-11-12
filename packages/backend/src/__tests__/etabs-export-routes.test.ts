import { afterEach,it,expect,vi } from 'vitest';
import { createServer, type Server, type IncomingMessage } from 'node:http';
import { createETABSExportRoute } from '../api/etabs-export-routes';
import type { ETABSExportDescriptor } from '@ai-floor-planner/core';

const token='EXPLICIT-TEST-TOKEN-01234567890123456789';
const servers:Server[]=[];
afterEach(async()=>{for(const s of servers.splice(0))await new Promise<void>(resolve=>s.close(()=>resolve()));});
async function setup(){
  const data=Buffer.from('MOCK HTTP PAYLOAD - NOT A NATIVE EDB');
  const descriptor:ETABSExportDescriptor={artifactId:'a'.repeat(32),projectId:'MOCK',sourceArchitecturalRevisionId:'mock-r1',
    fileName:'RH_Planner_MOCK.edb',byteLength:data.length,sha256:'MOCK',downloadUrl:'/api/v1/export/etabs/download/'+'a'.repeat(32),
    applicationVersion:'MOCK',verification:'NATIVE_REOPEN_MATCH',engineeringApproval:'NOT_PROVIDED',
    counts:{storeys:1,nodes:4,columns:2,beams:1,slabs:0}};
  const service={exportStructuralProjectToETABS:vi.fn(async()=>descriptor),download:vi.fn(async()=>({descriptor,data}))};
  const route=createETABSExportRoute(()=>service,()=>({token,allowedOrigins:['http://localhost:5173']}));
  const readBody=async(req:IncomingMessage)=>{let data='';for await(const chunk of req)data+=chunk;return data;};
  const server=createServer((req,res)=>{void route(req,res,new URL(req.url!,'http://localhost'),readBody).then(handled=>{if(!handled){res.writeHead(404);res.end();}});});
  servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const addr=server.address();if(!addr||typeof addr==='string')throw new Error('No listener');
  return {base:'http://127.0.0.1:'+addr.port,service,data,descriptor};
}
it('requires authorization for both model execution and download',async()=>{
  const {base,service}=await setup();
  for(const suffix of ['', '/download/'+'a'.repeat(32)]){
    const r=await fetch(base+'/api/v1/export/etabs'+suffix,{method:suffix?'GET':'POST'});
    expect(r.status).toBe(401);
  }
  expect(service.exportStructuralProjectToETABS).not.toHaveBeenCalled();expect(service.download).not.toHaveBeenCalled();
});
it('blocks foreign origins even with an otherwise valid token',async()=>{
  const {base,service}=await setup();
  const r=await fetch(base+'/api/v1/export/etabs',{method:'POST',headers:{authorization:'Bearer '+token,origin:'https://untrusted.example'}});
  expect(r.status).toBe(403);expect(r.headers.get('access-control-allow-origin')).toBeNull();
  expect(service.exportStructuralProjectToETABS).not.toHaveBeenCalled();
});
it('rejects arbitrary paths/options/native commands before dispatch',async()=>{
  const {base,service}=await setup();
  const r=await fetch(base+'/api/v1/export/etabs',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify({project:{},fileName:'D:/private.edb',operation:'open'})});
  expect(r.status).toBe(400);expect(service.exportStructuralProjectToETABS).not.toHaveBeenCalled();
});
it('exports a descriptor then downloads bytes with safe attachment headers (mock service)',async()=>{
  const {base,service,data,descriptor}=await setup();
  const headers={authorization:'Bearer '+token,'content-type':'application/json',origin:'http://localhost:5173'};
  const r=await fetch(base+'/api/v1/export/etabs',{method:'POST',headers,body:JSON.stringify({project:{id:'MOCK'}})});
  expect(r.status).toBe(201);expect(await r.json()).toEqual({artifact:descriptor});
  expect(service.exportStructuralProjectToETABS).toHaveBeenCalledWith({id:'MOCK'});
  const download=await fetch(base+descriptor.downloadUrl,{headers});
  expect(download.status).toBe(200);expect(Buffer.from(await download.arrayBuffer())).toEqual(data);
  expect(download.headers.get('content-disposition')).toBe('attachment; filename="RH_Planner_MOCK.edb"');
  expect(download.headers.get('x-cad-disk-path')).toBeNull();
  expect(download.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
});
it('does not disclose filesystem paths on unexpected backend failures',async()=>{
  const {base,service}=await setup();
  service.exportStructuralProjectToETABS.mockRejectedValueOnce(new Error('secret C:/private/client/file.edb'));
  const r=await fetch(base+'/api/v1/export/etabs',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:'{"project":{}}'});
  expect(r.status).toBe(500);expect(await r.text()).not.toContain('C:/private');
});
