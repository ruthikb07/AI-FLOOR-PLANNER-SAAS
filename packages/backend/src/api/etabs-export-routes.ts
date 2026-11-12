import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { StructuralExportValidationError } from '@ai-floor-planner/core';
import { configuredETABSExportService, type ETABSStructuralExportService } from '../services/etabs-structural-export.js';
import { ExportError } from '../services/export-selection.js';

interface RouteConfig { token?: string; allowedOrigins: readonly string[] }
type Service = Pick<ETABSStructuralExportService,'exportStructuralProjectToETABS'|'download'>;
export function createETABSExportRoute(
  service:()=>Service=configuredETABSExportService,
  configuration:()=>RouteConfig=()=>({token:process.env.RH_ETABS_EXPORT_TOKEN,
    allowedOrigins:(process.env.RH_ETABS_ALLOWED_ORIGINS??'http://localhost:5173,http://127.0.0.1:5173').split(',')}),
) {
  return async(request:IncomingMessage,response:ServerResponse,url:URL,readBody:(request:IncomingMessage)=>Promise<string>):Promise<boolean>=>{
    const match=url.pathname.match(/^\/api(?:\/v1)?\/export\/etabs(?:\/download\/([^/]+))?$/);
    if(!match)return false;
    const headers:Record<string,string>={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    const json=(status:number,body:unknown)=>{response.writeHead(status,{'Content-Type':'application/json',...headers});response.end(JSON.stringify(body));};
    try{
      const config=configuration(), origin=request.headers.origin;
      if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress??''))throw new ExportError('LOCAL_ONLY','ETABS exports require a local backend connection',403);
      if(!config.token||config.token.length<32)throw new ExportError('ETABS_AUTH_NOT_CONFIGURED','Configure a private export token of at least 32 characters',503);
      if(origin&&!config.allowedOrigins.includes(origin))throw new ExportError('ORIGIN_DENIED','Origin is not allowed',403);
      if(origin){headers['Access-Control-Allow-Origin']=origin;headers.Vary='Origin';headers['Access-Control-Expose-Headers']='Content-Disposition, Content-Length';}
      const authorization=request.headers.authorization;
      const expected=Buffer.from('Bearer '+config.token), supplied=Buffer.from(authorization??'');
      if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw new ExportError('UNAUTHORIZED','Export authorization required',401);
      if(request.method==='GET'&&match[1]){
        const {descriptor,data}=await service().download(match[1]);
        response.writeHead(200,{...headers,'Content-Type':'application/octet-stream','Content-Length':String(data.length),
          'Content-Disposition':'attachment; filename="'+descriptor.fileName+'"'});
        response.end(data);return true;
      }
      if(request.method!=='POST'||match[1])throw new ExportError('METHOD_NOT_ALLOWED','Use POST to export or GET with an artifact ID to download',405);
      if(!request.headers['content-type']?.startsWith('application/json'))throw new ExportError('UNSUPPORTED_MEDIA_TYPE','Use application/json',415);
      const raw=await readBody(request);
      if(Buffer.byteLength(raw)>1048576)throw new ExportError('PROJECT_TOO_LARGE','Request exceeds 1 MiB',413);
      let body:unknown;try{body=JSON.parse(raw);}catch{throw new ExportError('INVALID_JSON','Invalid JSON',400);}
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='project')||!('project'in body))
        throw new ExportError('INVALID_REQUEST','Body must contain only project; paths and native commands are forbidden',400);
      const descriptor=await service().exportStructuralProjectToETABS(body.project);
      json(201,{artifact:descriptor});
    }catch(error){
      if(error instanceof StructuralExportValidationError)json(422,{error:{code:error.code,message:error.message}});
      else if(error instanceof ExportError)json(error.status,{error:{code:error.code,
        message:error.status===502?'Native ETABS export failed; inspect local verification evidence.':error.message}});
      else json(500,{error:{code:'ETABS_EXPORT_FAILED',message:'Export failed; inspect local backend evidence.'}});
    }
    return true;
  };
}
export const handleETABSExportRoute=createETABSExportRoute();
