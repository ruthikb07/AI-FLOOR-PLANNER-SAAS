import { describe, expect, it, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { studioStoreActions } from '../stores/useStudioStore';
import {
  ArgonButton,
  ArgonCard,
  ArgonInput,
  ArgonSelect,
  ArgonBadge,
  ArgonCounter,
  ArgonStepper,
} from '../components/argon/ui';
import { ProjectSetupWizard } from '../components/argon/ProjectSetupWizard';
import { Stage1PlotAndSetbacks } from '../components/argon/wizard/Stage1PlotAndSetbacks';
import { Stage2FloorsAndParking } from '../components/argon/wizard/Stage2FloorsAndParking';
import { Stage3FlatsAndBhkMix } from '../components/argon/wizard/Stage3FlatsAndBhkMix';

describe('STAGE 6A: Design Tokens, Atomic System, State Store & Intake Stages', () => {
  beforeEach(() => {
    studioStoreActions.resetWizard();
  });

  // ─── 1. Atomic UI Component System ──────────────────────────────────────────
  describe('Atomic UI Components', () => {
    it('renders ArgonButton with architectural warm vellum and bronze tokens', () => {
      const primaryHtml = renderToStaticMarkup(
        <ArgonButton variant="primary">Proceed to Step 02</ArgonButton>
      );
      expect(primaryHtml).toContain('bg-argon-btn');
      expect(primaryHtml).toContain('text-argon-card');
      expect(primaryHtml).toContain('Proceed to Step 02');

      const secondaryHtml = renderToStaticMarkup(
        <ArgonButton variant="secondary">Back</ArgonButton>
      );
      expect(secondaryHtml).toContain('bg-argon-surface');
      expect(secondaryHtml).toContain('text-argon-text');

      const passHtml = renderToStaticMarkup(
        <ArgonButton variant="pass">Compliance Pass</ArgonButton>
      );
      expect(passHtml).toContain('bg-argon-pass');
    });

    it('renders ArgonCard with ivory surface and stone borders', () => {
      const html = renderToStaticMarkup(
        <ArgonCard variant="card">
          <h4>Plot Envelope</h4>
        </ArgonCard>
      );
      expect(html).toContain('bg-argon-card');
      expect(html).toContain('border-argon-border');
      expect(html).toContain('Plot Envelope');
    });

    it('renders ArgonInput with drafting ink text and stone borders', () => {
      const html = renderToStaticMarkup(
        <ArgonInput
          label="Frontage"
          defaultValue={30}
          suffix="m"
          helperText="Road-facing boundary"
        />
      );
      expect(html).toContain('bg-argon-card');
      expect(html).toContain('text-argon-text');
      expect(html).toContain('border-argon-border');
      expect(html).toContain('Frontage');
      expect(html).toContain('Road-facing boundary');
      expect(html).toContain('m');
    });

    it('renders ArgonSelect with styled options', () => {
      const html = renderToStaticMarkup(
        <ArgonSelect
          label="Authority"
          options={[
            { value: 'PMC', label: 'Pune Municipal Corporation' },
            { value: 'PCMC', label: 'Pimpri-Chinchwad Municipal Corporation' },
          ]}
          defaultValue="PMC"
        />
      );
      expect(html).toContain('Authority');
      expect(html).toContain('Pune Municipal Corporation');
      expect(html).toContain('bg-argon-card');
    });

    it('renders ArgonBadge across status variants', () => {
      const pass = renderToStaticMarkup(<ArgonBadge variant="pass">Compliant</ArgonBadge>);
      expect(pass).toContain('text-argon-pass');

      const warn = renderToStaticMarkup(<ArgonBadge variant="warn">Warning</ArgonBadge>);
      expect(warn).toContain('text-argon-warn');

      const error = renderToStaticMarkup(<ArgonBadge variant="error">Clash</ArgonBadge>);
      expect(error).toContain('text-argon-error');

      const leather = renderToStaticMarkup(<ArgonBadge variant="leather">Stacking</ArgonBadge>);
      expect(leather).toContain('text-argon-btn');
    });

    it('renders ArgonCounter with minus and plus controls', () => {
      const html = renderToStaticMarkup(
        <ArgonCounter value={2} onChange={() => {}} min={0} max={4} />
      );
      expect(html).toContain('2');
      expect(html).toContain('button');
    });

    it('renders ArgonStepper with active and completed stages', () => {
      const steps = [
        { id: 1, label: 'Plot & Road' },
        { id: 2, label: 'Floors & Stilt' },
        { id: 3, label: 'BHK Mix' },
        { id: 4, label: 'AI Intent' },
      ];
      const html = renderToStaticMarkup(
        <ArgonStepper steps={steps} currentStep={2} />
      );
      expect(html).toContain('Plot &amp; Road');
      expect(html).toContain('Floors &amp; Stilt');
      expect(html).toContain('bg-argon-pass'); // completed step 1
      expect(html).toContain('bg-argon-accent'); // active step 2
    });
  });

  // ─── 2. State Store & Bidirectional Persistence ─────────────────────────────
  describe('useStudioStore State & Persistence', () => {
    it('initializes with default wizard dimensions and metrics', () => {
      studioStoreActions.resetWizard();
      const data = studioStoreActions.getProjectSetupWizardData();
      expect(data.projectName).toBe('ARGON Residence Towers');
      expect(data.plotWidthM).toBe(30);
      expect(data.plotDepthM).toBe(40);
      expect(data.roadWidthM).toBe(12);
      expect(data.floorsCount).toBe(4);
      expect(data.hasStiltParking).toBe(true);
      expect(data.flatsPerFloor).toBe(4);
      expect(data.bhkMix).toEqual([
        { unitType: '2BHK', carpetAreaSqFt: 850, count: 2 },
        { unitType: '3BHK', carpetAreaSqFt: 1250, count: 2 },
      ]);
    });

    it('preserves state when navigating backward and forward across stages (never resets)', () => {
      // Step 1: User customizes plot
      studioStoreActions.updateWizard({
        projectName: 'Villa Grandeur',
        plotWidthM: 45,
        plotDepthM: 55,
        roadWidthM: 18,
        roadFacing: 'East',
        frontSetbackM: 4.5,
      });

      // Move to Step 2
      studioStoreActions.nextStep();
      expect(studioStoreActions.getProjectSetupWizardData().projectName).toBe('Villa Grandeur');

      // Step 2: User customizes floors
      studioStoreActions.updateWizard({ floorsCount: 6, hasStiltParking: true });
      expect(studioStoreActions.getProjectSetupWizardData().floorsCount).toBe(6);

      // Move to Step 3
      studioStoreActions.nextStep();
      // Step 3: User customizes BHK mix for 4 flats: 1x 1BHK, 2x 2BHK, 1x 3BHK
      studioStoreActions.setBhkCount('1BHK', 1);
      studioStoreActions.setBhkCount('2BHK', 2);
      studioStoreActions.setBhkCount('3BHK', 1);
      studioStoreActions.setBhkCount('4BHK', 0);

      // Navigate BACK to Step 2, then Step 1
      studioStoreActions.prevStep(); // now step 2
      studioStoreActions.prevStep(); // now step 1

      // Verify that all customized data in Step 1, 2, and 3 is completely retained!
      const finalData = studioStoreActions.getProjectSetupWizardData();
      expect(finalData.projectName).toBe('Villa Grandeur');
      expect(finalData.plotWidthM).toBe(45);
      expect(finalData.plotDepthM).toBe(55);
      expect(finalData.roadWidthM).toBe(18);
      expect(finalData.roadFacing).toBe('East');
      expect(finalData.frontSetbackM).toBe(4.5);
      expect(finalData.floorsCount).toBe(6);
      expect(finalData.hasStiltParking).toBe(true);
      expect(finalData.bhkMix).toEqual([
        { unitType: '1BHK', carpetAreaSqFt: 550, count: 1 },
        { unitType: '2BHK', carpetAreaSqFt: 850, count: 2 },
        { unitType: '3BHK', carpetAreaSqFt: 1250, count: 1 },
      ]);
    });

    it('updates carpet areas and computes correct BHK mix totals', () => {
      studioStoreActions.resetWizard();
      studioStoreActions.setFlatsPerFloor(3);
      studioStoreActions.setBhkCount('1BHK', 1);
      studioStoreActions.setBhkCount('2BHK', 1);
      studioStoreActions.setBhkCount('3BHK', 1);
      studioStoreActions.setBhkCount('4BHK', 0);
      studioStoreActions.setBhkCarpetArea('3BHK', 1400);

      const data = studioStoreActions.getProjectSetupWizardData();
      expect(data.flatsPerFloor).toBe(3);
      expect(data.bhkMix).toContainEqual({ unitType: '3BHK', carpetAreaSqFt: 1400, count: 1 });
    });
  });

  // ─── 3. Intake Stages UI Rendering ──────────────────────────────────────────
  describe('Intake Stages UI (Stages 1 to 3)', () => {
    it('renders Stage 1 with plot area and statutory buildable envelope', () => {
      studioStoreActions.updateWizard({
        plotWidthM: 30,
        plotDepthM: 40,
        frontSetbackM: 3.0,
        rearSetbackM: 2.0,
        sideSetbackM: 2.0,
      });

      const html = renderToStaticMarkup(<Stage1PlotAndSetbacks />);
      expect(html).toContain('Plot Boundaries &amp; Frontage');
      expect(html).toContain('1200 m²'); // 30 * 40
      expect(html).toContain('Buildable Footprint Envelope:');
      expect(html).toContain('26m (W) × 35m (D)'); // 30 - 4 = 26, 40 - 5 = 35
      expect(html).toContain('910 m²'); // 26 * 35
    });

    it('renders Stage 2 with floors count and stilt ground parking choices', () => {
      studioStoreActions.updateWizard({
        floorsCount: 4,
        hasStiltParking: true,
      });

      const html = renderToStaticMarkup(<Stage2FloorsAndParking />);
      expect(html).toContain('Typical Residential Upper Floors');
      expect(html).toContain('15.8 m'); // (4 + 1) * 3.15 = 15.75 -> 15.8m
      expect(html).toContain('Ground Stilt Parking Floor (Recommended)');
      expect(html).toContain('Ground Floor Residential Units');
    });

    it('renders Stage 3 with Double/Triple/Quad strategy and BHK mix matrix', () => {
      studioStoreActions.setFlatsPerFloor(4);
      studioStoreActions.setBhkCount('2BHK', 2);
      studioStoreActions.setBhkCount('3BHK', 2);

      const html = renderToStaticMarkup(<Stage3FlatsAndBhkMix />);
      expect(html).toContain('Flats Per Typical Floor Strategy');
      expect(html).toContain('Double Flat Layout');
      expect(html).toContain('Triple Flat Layout');
      expect(html).toContain('Quad Flat Layout');
      expect(html).toContain('4 / 4 Flats Balanced');
    });

    it('renders full ProjectSetupWizard container with vellum and linen theme', () => {
      const html = renderToStaticMarkup(
        <ProjectSetupWizard onGenerate={() => {}} onCancel={() => {}} />
      );
      expect(html).toContain('bg-argon-bg');
      expect(html).toContain('bg-argon-card');
      expect(html).toContain('Stage 01 of 04 • Architectural Intake');
      expect(html).toContain('Continue to Step 02');
    });
  });
});
