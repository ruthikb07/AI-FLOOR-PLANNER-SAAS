import { mkdir, readFile, readdir, link, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalBuildingHash, stableValueHash, type Building } from '@ai-floor-planner/core';
import { resolveLocalProjectsRoot } from './local-project-store.js';

const fieldCounts = { 'Terminal roof':5, 'Occupied deck':5, 'Slab–beam connection':3, 'Stair bearing':4, 'Balcony root':3,
  'Site geotechnical report':4 } as const;

export function validEngineeringRecord(record: unknown, building: Building, digest: string) {
  if (!record || typeof record !== 'object') return false;
  const r = record as Record<string, unknown>;
  const floor = building.floors.find(f => f.id === r.floor);
  const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 512;
  if (!floor || r.digest !== digest || ![r.reference,r.reviewer,r.member].every(text) ||
      typeof r.kind !== 'string' || !Object.hasOwn(fieldCounts,r.kind) ||
      typeof r.approvedAt !== 'string' || !Number.isFinite(Date.parse(r.approvedAt)) ||
      !Array.isArray(r.numbers) || r.numbers.length !== fieldCounts[r.kind as keyof typeof fieldCounts] ||
      !r.numbers.every(Number.isFinite)) return false;
  const [a,b,c,d,e] = r.numbers;
  switch (r.kind) {
    case 'Occupied deck': return building.floors.some(f=>f.id===r.surfaceFloorId && f.level>floor.level) &&
      b>=a && c>0 && d>=0 && e>0;
    case 'Terminal roof': return !building.floors.some(f=>f.level>floor.level) && b>=a && c>0 && d>=0 && e>0;
    case 'Slab–beam connection': return a>0;
    case 'Site geotechnical report': return r.numbers.every(n=>n>0) &&
      (r.bearingCapacityBasis===undefined || r.bearingCapacityBasis==='NET' || r.bearingCapacityBasis==='GROSS') &&
      (r.waterTableDepthBelowGroundM===undefined || (typeof r.waterTableDepthBelowGroundM==='number' && Number.isFinite(r.waterTableDepthBelowGroundM) && r.waterTableDepthBelowGroundM>=0)) &&
      (r.subgradeModulusKnM3===undefined || (typeof r.subgradeModulusKnM3==='number' && Number.isFinite(r.subgradeModulusKnM3) && r.subgradeModulusKnM3>100));
    case 'Stair bearing': return a>0 && c>0 && d>=0 && text(r.lowerBeamId) && text(r.upperBeamId) && r.lowerBeamId!==r.upperBeamId;
    default: return r.numbers.every(n=>n>0);
  }
}

export async function engineeringInputRecords(building: Building, record?: unknown) {
  const digest = canonicalBuildingHash(building);
  const directory = path.join(resolveLocalProjectsRoot(),'.engineering-inputs',digest);
  if (record !== undefined) {
    if (!validEngineeringRecord(record,building,digest)) throw new TypeError('Invalid engineering record or architectural revision.');
    const target = path.join(directory,stableValueHash(record)+'.json');
    await mkdir(directory,{recursive:true});
    const tmp = path.join(directory,randomUUID()+'.tmp');
    await writeFile(tmp,JSON.stringify(record),{flag:'wx'});
    try {
      await link(tmp,target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code!=='EEXIST') throw error;
    } finally { await unlink(tmp); }
  }
  let files: string[];
  try { files = await readdir(directory); } catch (error) {
    if ((error as NodeJS.ErrnoException).code==='ENOENT') return [];
    throw error;
  }
  const result: Record<string,unknown>[] = [];
  for (const file of files.filter(f=>/^[0-9a-f]{64}\.json$/.test(f)).sort()) {
    const value = JSON.parse(await readFile(path.join(directory,file),'utf8'));
    if (stableValueHash(value)+'.json'!==file || !validEngineeringRecord(value,building,digest)) throw new Error('Stored engineering record failed integrity checks.');
    result.push(value);
  }
  return result.sort((a,b)=>String(a.approvedAt).localeCompare(String(b.approvedAt)));
}
