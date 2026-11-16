import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseStructuralProjectForExport, type ETABSCommand, type ETABSResponse, type ETABSAnalysisResult, type ETABSNativeFixtureEvidence } from '@ai-floor-planner/core';
import { LocalETABSConnector, LocalETABSBridgeTransport } from './etabs-connector.js';
import { ETABSStructuralExportService, type ETABSStructuralExportOptions } from './etabs-structural-export.js';
import { etabsNativeId } from './etabs-structural-comparison.js';
import { ExportError } from './export-selection.js';

/** Host-only software verification workflow. Not mounted as a production residential analysis endpoint. */
export class ETABSFixtureAnalysisService {
  private busy = false;
  private retainedSession = false;
  constructor(private readonly options: ETABSStructuralExportOptions) {}
  async run(input: unknown) {
    if (this.busy || this.retainedSession) throw new ExportError('ETABS_BUSY', 'Inspect the active/retained native session before another run', 409);
    const project = parseStructuralProjectForExport(input, { allowVerificationFixtures: true });
    if (this.options.allowVerificationFixtures !== true || project.exportReview?.status !== 'API_VERIFICATION_FIXTURE'
      || !project.loadCases.length || project.loadCases.some(c => c.selfWeightMultiplier !== 0))
      throw new ExportError('FIXTURE_SCOPE_REQUIRED', 'This benchmark requires explicit fixture inputs and independently checkable nodal loads without self-weight.', 409);
    this.busy = true;
    const runId = randomUUID();
    const directory = path.resolve(this.options.artifactRoot, 'run-' + runId);
    let connector: LocalETABSConnector | undefined;
    let closed = false;
    const evidence: ETABSResponse[] = [];
    try {
      const exporter = new ETABSStructuralExportService(this.options);
      const artifact = await exporter.exportStructuralProjectToETABS(project);
      const exported = await exporter.download(artifact.artifactId);
      await mkdir(directory, { recursive: false });
      await writeFile(path.join(directory, 'model.edb'), exported.data, { flag: 'wx' });
      await writeFile(path.join(directory, 'structural-project.json'), JSON.stringify(project, null, 2), { flag: 'wx' });
      connector = new LocalETABSConnector(new LocalETABSBridgeTransport({ ...this.options, modelDirectory: directory, timeoutMs: 180000 }));
      const call = async (command: ETABSCommand) => {
        await writeFile(path.join(directory, 'progress.json'), JSON.stringify({ operation: command.operation, timestamp: new Date().toISOString() }));
        const response = await connector!.execute(command); evidence.push(response);
        await writeFile(path.join(directory, 'native-evidence.json'), JSON.stringify(evidence, null, 2));
        if (!response.ok) throw new ExportError(response.error.code, response.error.message);
        if (!response.apiCalls?.length || response.apiCalls.some(c => c.code !== 0)) throw new ExportError('MISSING_NATIVE_EVIDENCE', 'Missing successful OAPI calls');
        return response.data;
      };
      await call({ operation: 'connect' });
      await call({ operation: 'open', fileName: 'model.edb', sourceArchitecturalRevisionId: project.sourceArchitecturalRevisionId });
      await call({ operation: 'analyze', caseNames: project.loadCases.map(c => etabsNativeId('LC', c.id)) });
      const results: { sourceId: string; selection: string; result: ETABSAnalysisResult; forceResidualN: number[]; momentResidualNmm: number[] }[] = [];
      const selections = [
        ...project.loadCases.map(c => ({ id: c.id, name: etabsNativeId('LC', c.id), combo: false, terms: [{ loadCaseId: c.id, factor: 1 }] })),
        ...project.loadCombinations.map(c => ({ id: c.id, name: etabsNativeId('CO', c.id), combo: true, terms: c.terms })),
      ];
      for (const selected of selections) {
        const frameNames = [...project.columns, ...project.beams].map(f => etabsNativeId('F', f.id));
        const supports = project.nodes.filter(n => n.restraints.some(Boolean));
        const result = (await call({ operation: 'results', caseName: selected.name,
          ...(selected.combo ? { selectionType: 'COMBINATION' as const } : {}), frameNames,
          nodeNames: supports.map(n => etabsNativeId('N', n.id)), displacementNodeNames: project.nodes.map(n => etabsNativeId('N', n.id)) })).result!;
        for (const name of frameNames) if (!result.frameForces.some(f => f.object === name && f.caseName === selected.name)) throw new Error('Missing member result ' + name);
        const force = [0,0,0], moment = [0,0,0];
        const add = (position: number[], f: readonly number[], m: readonly number[], scale = 1) => {
          const cross = [position[1]! * f[2]! - position[2]! * f[1]!, position[2]! * f[0]! - position[0]! * f[2]!, position[0]! * f[1]! - position[1]! * f[0]!];
          for (let i = 0; i < 3; i++) { force[i]! += f[i]! * scale; moment[i]! += (m[i]! + cross[i]!) * scale; }
        };
        for (const term of selected.terms) for (const load of project.loadCases.find(c => c.id === term.loadCaseId)!.nodalLoads) {
          const node = project.nodes.find(n => n.id === load.nodeId)!;
          add([node.xMm,node.yMm,node.zMm], load.forceN, load.momentNmm, term.factor);
        }
        for (const node of supports) {
          const rows = result.supportReactions.filter(r => r.object === etabsNativeId('N', node.id) && r.caseName === selected.name);
          if (rows.length !== 1) throw new Error('Expected one static support reaction for ' + node.id);
          add([node.xMm,node.yMm,node.zMm], rows[0]!.forceN, rows[0]!.momentNmm);
        }
        if (force.some(v => !Number.isFinite(v) || Math.abs(v) > 0.1) || moment.some(v => !Number.isFinite(v) || Math.abs(v) > 100))
          throw new ExportError('EQUILIBRIUM_FAILED', JSON.stringify({ force, moment }));
        results.push({ sourceId: selected.id, selection: selected.name, result, forceResidualN: force, momentResidualNmm: moment });
      }
      await call({ operation: 'save', fileName: 'model.edb' });
      await call({ operation: 'disconnect' }); closed = true; connector.close();
      const bytes = await readFile(path.join(directory, 'model.edb'));
      const manifest: ETABSNativeFixtureEvidence = { schemaVersion: 1, projectId: project.id, runId, sourceArchitecturalRevisionId: project.sourceArchitecturalRevisionId,
        structuralRevisionSha256: createHash('sha256').update(JSON.stringify(project)).digest('hex'),
        edbSha256: createHash('sha256').update(bytes).digest('hex'), applicationVersion: artifact.applicationVersion,
        timestamp: new Date().toISOString(), units: 'N_mm_C', status: 'NATIVE_ANALYSIS_VERIFIED',
        scope: 'SOFTWARE VERIFICATION - NOT FOR CONSTRUCTION', designStatus: 'NOT_VERIFIED', engineeringApproval: 'NOT_PROVIDED',
        limitations: ['Illustrative nodal test loads, not code-derived wind/seismic actions', 'No concrete/rebar design or detailing checks',
          'Analysis warning-log classification and mesh convergence are not independently verified', 'Rebar material is defined only; reinforcement assignment/design is not implemented'],
        nativeExport: artifact, results };
      await writeFile(path.join(directory, 'analysis.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
      return { directory, manifest };
    } finally {
      if (connector && !closed) {
        const cleanup = await connector.execute({ operation: 'disconnect', discardUnsaved: true });
        evidence.push(cleanup);
        await writeFile(path.join(directory, 'native-evidence.json'), JSON.stringify(evidence, null, 2));
        if (cleanup.ok) { closed = true; connector.close(); }
      }
      if (connector && !closed) this.retainedSession = true;
      this.busy = false;
    }
  }
}
