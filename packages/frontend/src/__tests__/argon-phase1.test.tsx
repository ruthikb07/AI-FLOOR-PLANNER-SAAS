import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createBuilding, Direction } from '@ai-floor-planner/core';
import { createArgonRequest } from '../services/argon-request';
import type { ProjectSetupWizardData } from '../components/argon/ProjectSetupWizard';
import type { EditorContextValue } from '../stores/editor-store';
import { UdcprEtabsAnalysis } from '../components/argon/UdcprEtabsAnalysis';
import { ExportCenterWorkspace } from '../components/argon/ExportCenterWorkspace';

const brief: ProjectSetupWizardData = {
  projectName: 'Phase 1 fixture', plotWidthM: 30, plotDepthM: 40, roadWidthM: 12, roadFacing: 'East',
  frontSetbackM: 3, rearSetbackM: 2, sideSetbackM: 2.5, floorsCount: 3, hasStiltParking: false,
  flatsPerFloor: 2, bhkMix: [{ unitType: '1BHK', carpetAreaSqFt: 550, count: 1 }, { unitType: '4BHK', carpetAreaSqFt: 1800, count: 1 }],
  aiPrompt: 'Keep the reference style', referenceImage: { name: 'reference.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AAAA' },
};

describe('ARGON Phase 1 boundary', () => {
  it('maps every wizard field into a fresh millimetre solver request', () => {
    const request = createArgonRequest(brief);
    expect(request).toMatchObject({ projectName: brief.projectName, plotWidthMm: 30000, plotDepthMm: 40000, roadWidthMm: 12000,
      roadAccessSides: [Direction.East], setbacksMm: { front: 3000, rear: 2000, left: 2500, right: 2500 },
      numTypicalFloors: 3, verticalStackType: 'G_PLUS_N', flatsPerFloor: 2, aiPrompt: brief.aiPrompt, referenceImage: brief.referenceImage,
      units: [{ unitIndex: 1, bhkType: '1BHK', targetCarpetSqFt: 550 }, { unitIndex: 2, bhkType: '4BHK', targetCarpetSqFt: 1800 }],
    });
    expect(request.projectId).not.toBe(createArgonRequest(brief).projectId);
    expect(createArgonRequest({ ...brief, hasStiltParking: true }).verticalStackType).toBe('STILT_PLUS_N');
    expect(() => createArgonRequest({ ...brief, flatsPerFloor: 4 })).toThrow(/BHK mix/);
  });

  it('renders active revision facts while keeping unrun engineering and exports unavailable', () => {
    const building = { ...createBuilding({ projectId: 'status', name: 'Live project', site: { plotWidth: 30000, plotDepth: 40000 } }), version: 7 };
    const editor = { building } as EditorContextValue;
    const engineering = renderToStaticMarkup(<UdcprEtabsAnalysis editor={editor} />);
    const exports = renderToStaticMarkup(<ExportCenterWorkspace editor={editor} />);
    expect(engineering).toContain('Live project');
    expect(engineering).toContain('NOT_VERIFIED');
    expect(engineering).toContain('NBC original clauses');
    expect(engineering).not.toContain('Structural Integrity Validated');
    expect(exports).toContain('revision 7');
    expect(exports).not.toContain('14 production artifacts');
    expect(exports).toContain('disabled');
  });
});
