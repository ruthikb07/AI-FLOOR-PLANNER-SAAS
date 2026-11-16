import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { parseStructuralProjectForExport, structuralProjectReviewJson, type ETABSConnector, type ETABSCommand, type ETABSResponse, type ETABSExportDescriptor, type StructuralProject } from '@ai-floor-planner/core';
import { LocalETABSBridgeTransport, LocalETABSConnector, type LocalETABSBridgeOptions } from './etabs-connector.js';
import { validateStructuralExportGeometry } from './structural-export-geometry.js';
import { compareETABSStructuralModel } from './etabs-structural-comparison.js';
import { ExportError } from './export-selection.js';
import { createETABSSidecar, verifyETABSSidecar } from './etabs-provenance.js';

export interface ETABSStructuralExportOptions {
  artifactRoot: string; bridgeExecutable: string; installDirectory: string;
  allowVerificationFixtures?: boolean;
  /** Test injection only; never taken from the HTTP request. */
  connectorFactory?: (options: LocalETABSBridgeOptions) => ETABSConnector & { close(): void };
}
async function noLinks(p:string) {
  for(let current=path.resolve(p);;current=path.dirname(current)){
    try{if((await lstat(current)).isSymbolicLink())throw new ExportError('UNSAFE_ARTIFACT_PATH','Linked artifact paths are forbidden',409);}
    catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    if(path.dirname(current)===current)break;
  }
}
const digest=(data:Buffer)=>createHash('sha256').update(data).digest('hex');

export class ETABSStructuralExportService {
  private busy=false;
  private retainedSession=false;
  constructor(private readonly options:ETABSStructuralExportOptions) {}
  async exportStructuralProjectToETABS(input:unknown):Promise<ETABSExportDescriptor> {
    if(this.retainedSession)throw new ExportError('ETABS_SESSION_RETAINED','A previous native session could not be closed. Inspect and recover the owned session before restarting this service; automatic retry is disabled.',409);
    const project=parseStructuralProjectForExport(input,{allowVerificationFixtures:this.options.allowVerificationFixtures});
    if(project.exportReview!.status!=='API_VERIFICATION_FIXTURE' && createHash('sha256').update(structuralProjectReviewJson(project)).digest('hex')!==project.exportReview!.inputSha256)
      throw new ExportError('ENGINEERING_INPUTS_REQUIRED','Structural input changed after review. Review the current input hash before export.',422);
    validateStructuralExportGeometry(project);
    if(Buffer.byteLength(JSON.stringify(project))>900000)throw new ExportError('PROJECT_TOO_LARGE','Structural project exceeds transport limit',413);
    if(this.busy)throw new ExportError('ETABS_BUSY','Another native export is running',409);
    this.busy=true;
    const artifactId=randomBytes(16).toString('hex');
    const directory=path.resolve(this.options.artifactRoot,artifactId);
    const fileName='RH_Planner_'+project.id.replace(/[^A-Za-z0-9_-]/g,'_')+'.edb';
    const evidence:{operation:string;response:ETABSResponse}[]=[];
    let connector:(ETABSConnector&{close():void})|undefined;
    let disconnected=false;
    let created=false;
    let report:Record<string,unknown>={projectId:project.id,sourceArchitecturalRevisionId:project.sourceArchitecturalRevisionId,verification:'NOT_VERIFIED'};
    try{
      await noLinks(directory);await mkdir(directory,{recursive:true});
      created=true;
      await writeFile(path.join(directory,'structural-project.json'),JSON.stringify(project,null,2),{flag:'wx'});
      connector=this.options.connectorFactory?.({bridgeExecutable:this.options.bridgeExecutable,installDirectory:this.options.installDirectory,modelDirectory:directory}) ??
        new LocalETABSConnector(new LocalETABSBridgeTransport({bridgeExecutable:this.options.bridgeExecutable,installDirectory:this.options.installDirectory,modelDirectory:directory,timeoutMs:180000}));
      const call=async(command:ETABSCommand)=>{
        await writeFile(path.join(directory,'progress.json'),JSON.stringify({operation:command.operation,state:'STARTED',timestamp:new Date().toISOString()},null,2));
        const response=await connector!.execute(command);evidence.push({operation:command.operation,response});
        await writeFile(path.join(directory,'verification.json'),JSON.stringify({...report,evidence},null,2));
        await writeFile(path.join(directory,'progress.json'),JSON.stringify({operation:command.operation,state:response.ok?'COMPLETED':'FAILED',timestamp:new Date().toISOString()},null,2));
        if(!response.ok)throw new ExportError(response.error.code,'ETABS '+command.operation+' failed: '+response.error.message,502);
        if(!response.apiCalls?.length || response.apiCalls.some(c=>c.code!==0))throw new ExportError('MISSING_NATIVE_EVIDENCE','Native API return-code evidence missing or failed',502);
        return response.data;
      };
      const connected=await call({operation:'connect'});
      await call({operation:'importStructural',project});
      await call({operation:'inspectStructural'});
      await call({operation:'save',fileName});
      await noLinks(path.join(directory,fileName));
      const savedBytes=await readFile(path.join(directory,fileName));
      if(!savedBytes.length)throw new ExportError('EMPTY_EDB','Native EDB is empty',502);
      const sourceBytes=await readFile(path.join(directory,'structural-project.json'));
      const sidecar=createETABSSidecar(project,savedBytes,sourceBytes);
      await writeFile(path.join(directory,'provenance.json'),JSON.stringify(sidecar,null,2),{flag:'wx'});
      await call({operation:'disconnect'});disconnected=true;
      await call({operation:'connect'});disconnected=false;
      await call({operation:'open',fileName,sourceArchitecturalRevisionId:project.sourceArchitecturalRevisionId});
      const {snapshot}=await call({operation:'inspectStructural'});
      if(!snapshot)throw new ExportError('MISSING_READBACK','Native structural snapshot is missing',502);
      const sidecarBytes=await readFile(path.join(directory,'provenance.json'));
      const provenance=verifyETABSSidecar(JSON.parse(sidecarBytes.toString('utf8')),project,await readFile(path.join(directory,fileName)),sourceBytes);
      const mismatches=compareETABSStructuralModel(project,snapshot,provenance);
      report={...report,snapshot,mismatches,provenanceStorage:'HASH_BOUND_SIDECAR',externalProvenance:provenance};
      if(mismatches.length)throw new ExportError('NATIVE_MODEL_MISMATCH',mismatches.join('; '),422);
      await call({operation:'disconnect'});disconnected=true;connector.close();
      const bytes=await readFile(path.join(directory,fileName));
      verifyETABSSidecar(sidecar,project,bytes,sourceBytes);
      if(!bytes.length)throw new ExportError('EMPTY_EDB','Native EDB is empty after reopen',502);
      const descriptor:ETABSExportDescriptor={
        exportMode:project.loadCases.length?'ANALYSIS_READY':'MODEL_ONLY',analysisStatus:'NOT_ANALYZED',designStatus:'NOT_VERIFIED',
        evidenceScope:project.exportReview!.status==='API_VERIFICATION_FIXTURE'?'SOFTWARE_VERIFICATION':'REVIEWED_INPUT_TRANSFER',
        provenance:{storage:'HASH_BOUND_SIDECAR',sha256:digest(sidecarBytes),sourceSha256:sidecar.sourceSha256},
        artifactId,projectId:project.id,sourceArchitecturalRevisionId:project.sourceArchitecturalRevisionId,fileName,
        byteLength:bytes.length,sha256:digest(bytes),downloadUrl:'/api/v1/export/etabs/download/'+artifactId,
        applicationVersion:connected.applicationVersion!,verification:'NATIVE_REOPEN_MATCH',engineeringApproval:'NOT_PROVIDED',
        counts:{storeys:project.levels.length-1,nodes:project.nodes.length,columns:project.columns.length,beams:project.beams.length,slabs:project.slabs.length},
      };
      report={...report,verification:'NATIVE_REOPEN_MATCH',descriptor};
      await writeFile(path.join(directory,'verification.json'),JSON.stringify({...report,evidence},null,2));
      // Publication is last: downloads never see a failed or unchecked native file.
      await writeFile(path.join(directory,'artifact.json'),JSON.stringify(descriptor,null,2),{flag:'wx'});
      return descriptor;
    }catch(error){
      report={...report,error:error instanceof Error?error.message:String(error)};
      throw error;
    }finally{
      try{
        if(connector&&!disconnected){
          try{
            const response=await connector.execute({operation:'disconnect',discardUnsaved:true});
            evidence.push({operation:'cleanup',response});
            if(response.ok){disconnected=true;connector.close();}
          }catch(error){report={...report,cleanupError:error instanceof Error?error.message:String(error)};}
        }
        if(created)await writeFile(path.join(directory,'verification.json'),JSON.stringify({...report,evidence},null,2));
      }finally{if(connector&&!disconnected)this.retainedSession=true;this.busy=false;}
    }
  }
  async download(artifactId:string):Promise<{descriptor:ETABSExportDescriptor;data:Buffer}> {
    if(!/^[a-f0-9]{32}$/.test(artifactId))throw new ExportError('ARTIFACT_NOT_FOUND','Unknown artifact',404);
    const directory=path.resolve(this.options.artifactRoot,artifactId);
    await noLinks(path.join(directory,'artifact.json'));
    let descriptor:ETABSExportDescriptor;
    try{descriptor=JSON.parse(await readFile(path.join(directory,'artifact.json'),'utf8')) as ETABSExportDescriptor;}
    catch{throw new ExportError('ARTIFACT_NOT_FOUND','No verified artifact exists',404);}
    if(descriptor.artifactId!==artifactId || descriptor.verification!=='NATIVE_REOPEN_MATCH' || !/^RH_Planner_[A-Za-z0-9_-]+\.edb$/.test(descriptor.fileName))
      throw new ExportError('INVALID_ARTIFACT','Invalid artifact manifest',409);
    const filename=path.join(directory,descriptor.fileName);await noLinks(filename);
    const data=await readFile(filename);
    if(data.length!==descriptor.byteLength||digest(data)!==descriptor.sha256)throw new ExportError('ARTIFACT_CHANGED','EDB changed after native verification',409);
    await noLinks(path.join(directory,'provenance.json'));await noLinks(path.join(directory,'structural-project.json'));
    const sidecarBytes=await readFile(path.join(directory,'provenance.json'));
    const sourceBytes=await readFile(path.join(directory,'structural-project.json'));
    if(descriptor.provenance?.storage!=='HASH_BOUND_SIDECAR'||digest(sidecarBytes)!==descriptor.provenance.sha256||digest(sourceBytes)!==descriptor.provenance.sourceSha256)
      throw new ExportError('PROVENANCE_MISMATCH','External provenance changed after verification',409);
    const sourceProject=JSON.parse(sourceBytes.toString('utf8')) as StructuralProject;
    verifyETABSSidecar(JSON.parse(sidecarBytes.toString('utf8')),sourceProject,data,sourceBytes);
    if(descriptor.projectId!==sourceProject.id || descriptor.sourceArchitecturalRevisionId!==sourceProject.sourceArchitecturalRevisionId)
      throw new ExportError('PROVENANCE_MISMATCH','Download manifest identifies a different project or revision.',409);
    return {descriptor,data};
  }
}

let configured:ETABSStructuralExportService|undefined;
export function configuredETABSExportService():ETABSStructuralExportService {
  if(!configured){
    if(!process.env.ETABS_BRIDGE_EXE||!process.env.ETABS_INSTALL_DIR)throw new ExportError('ETABS_NOT_CONFIGURED','Configure the local ETABS bridge',503);
    configured=new ETABSStructuralExportService({bridgeExecutable:process.env.ETABS_BRIDGE_EXE,installDirectory:process.env.ETABS_INSTALL_DIR,
      artifactRoot:process.env.ETABS_ARTIFACT_ROOT??path.resolve('output/etabs/structural-exports')});
  }
  return configured;
}
export function exportStructuralProjectToETABS(project:StructuralProject):Promise<ETABSExportDescriptor> {
  return configuredETABSExportService().exportStructuralProjectToETABS(project);
}
