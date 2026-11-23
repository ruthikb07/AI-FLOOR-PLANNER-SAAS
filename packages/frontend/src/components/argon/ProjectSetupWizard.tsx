import React, { useState } from 'react';
import type {
  AuthorityType,
  BuildingMassingShape,
  CongestionZone,
  GalleryCoordinationMode,
  ParametricShapeParams,
  PlanCategory,
} from '@ai-floor-planner/core';
import {
  Sparkles,
  ArrowRight,
  ArrowLeft,
  X,
} from 'lucide-react';
import { useStudioStore } from '../../stores/useStudioStore';
import type {
  ProjectDevelopmentType,
  RedevelopmentProgramConfig,
} from '../../services/redevelopment-feasibility';
import type { ReferenceWorkflowState } from '../../services/reference-workflow';
import {
  ArgonButton,
  ArgonStepper,
  type ArgonStepItem,
} from './ui';
import { Stage1PlotAndSetbacks } from './wizard/Stage1PlotAndSetbacks';
import { Stage2FloorsAndParking } from './wizard/Stage2FloorsAndParking';
import { Stage3FlatsAndBhkMix } from './wizard/Stage3FlatsAndBhkMix';
import { Stage4PromptAndUpload } from './wizard/Stage4PromptAndUpload';
import { SurveyDrawing } from './wizard/SurveyDrawing';
import { useSurveyEditor } from './wizard/useSurveyEditor';
import { surveyGenerationBlock } from '../../services/survey-draft';
import { ParcelStudy } from './ParcelStudy';

export interface ProjectSetupWizardData {
  projectType?: ProjectDevelopmentType;
  authorityType?: AuthorityType;
  congestionZone?: CongestionZone;
  clearRoomHeightMm?: number;
  stiltClearHeightBelowBeamMm?: number;
  projectName: string;
  plotWidthM: number;
  plotDepthM: number;
  siteGeometryMode?: 'survey' | 'rectangle';
  roadWidthM: number;
  roadFacing: 'North' | 'East' | 'South' | 'West';
  frontSetbackM: number;
  rearSetbackM: number;
  sideSetbackM: number;
  floorsCount: number;
  hasStiltParking: boolean;
  duplexCount?: number;
  triplexCount?: number;
  flatsPerFloor: number;
  bhkMix: Array<{
    unitType: '1BHK' | '2BHK' | '3BHK' | '4BHK';
    carpetAreaSqFt: number;
    count: number;
  }>;
  buildingMassingShape?: BuildingMassingShape | 'AUTO';
  planCategory?: PlanCategory;
  autoExploreNovelShape?: boolean;
  shapeParams?: ParametricShapeParams;
  usedShapeIds?: readonly string[];
  usedArchetypeIds?: readonly string[];
  includeWindowChajjas?: boolean;
  staggeredBalconies?: boolean;
  galleryCoordinationMode?: GalleryCoordinationMode;
  includeDiningHall?: boolean;
  includeStudyRoom?: boolean;
  aiPrompt: string;
  referenceSketchName?: string;
  referenceImage?: { name: string; mimeType: string; dataUrl: string };
  referenceWorkflow?: ReferenceWorkflowState;
  redevelopment?: RedevelopmentProgramConfig;
}

interface ProjectSetupWizardProps {
  onGenerate: (data: ProjectSetupWizardData) => void;
  onCancel?: () => void;
  onBackToWelcome?: () => void;
  onOpenCadImport?: () => void;
}

export const ProjectSetupWizard: React.FC<ProjectSetupWizardProps> = ({
  onGenerate,
  onCancel,
  onBackToWelcome,
  onOpenCadImport,
}) => {
  const {
    currentStep,
    setStep,
    nextStep,
    prevStep,
    wizard,
    updateWizard,
    getProjectSetupWizardData,
    isBhkMixValid,
  } = useStudioStore();
  const [existing, setExisting] = useState(false);
  const [readingReference, setReadingReference] = useState(false);
  const survey = useSurveyEditor(wizard, updateWizard);
  const surveyBlock = surveyGenerationBlock(survey.active);
  const redevelopment = wizard.projectType === 'redevelopment';
  const titles = ['Project type and site', 'Floors and parking', 'Massing and apartment mix', 'Project brief and references'];

  const steps: ArgonStepItem[] = [
    { id: 1, label: 'Plot & Type', sublabel: wizard.projectType === 'redevelopment' ? 'Redevelopment' : 'New Build' },
    { id: 2, label: 'Floors & Stilt', sublabel: 'Stacking & Duplex' },
    { id: 3, label: 'Flats & Mix', sublabel: 'BHK & Massing' },
    { id: 4, label: 'Ref & Intent', sublabel: '5-Stage Upload' },
  ];

  const handleFinish = () => {
    if (surveyBlock) return;
    const data = getProjectSetupWizardData();
    onGenerate(data);
  };

  return (
    <section className="rh-program-workspace argon-setup bg-argon-bg" aria-label="Project setup">
      <aside className="rh-program-drawing">
        <header>
          <p className="rh-atelier-kicker">{redevelopment ? 'Redevelopment brief' : 'New construction brief'}</p>
          <h2>{wizard.projectName || 'Untitled project'}</h2>
        </header>
        {redevelopment && !survey.active && <div className="rh-program-toggle" aria-label="Redevelopment massing">
          <button type="button" aria-pressed={existing} onClick={() => setExisting(true)}>Existing</button>
          <button type="button" aria-pressed={!existing} onClick={() => setExisting(false)}>Proposed</button>
        </div>}
        {survey.active
          ? <SurveyDrawing survey={survey} interactive={currentStep === 1} roadWidthM={wizard.roadWidthM} />
          : <ParcelStudy draft={wizard} mode={redevelopment ? (existing ? 'existing' : 'massing') : currentStep === 1 ? 'site' : 'massing'} />}
        <dl>
          {!survey.active && <div><dt>Site area</dt><dd>{(wizard.plotWidthM * wizard.plotDepthM).toLocaleString()} m²</dd></div>}
          <div><dt>Residential floors</dt><dd>{wizard.floorsCount}</dd></div>
          <div><dt>Flats per floor</dt><dd>{wizard.flatsPerFloor}</dd></div>
        </dl>
      </aside>
      <div className="rh-program-sheet">
        <header>
          <div className="rh-program-heading">
            <div><p className="rh-atelier-kicker">Step {currentStep} of 4</p><h2>{titles[currentStep - 1]}</h2></div>
            {onBackToWelcome && <button type="button" className="rh-outline-action" onClick={onBackToWelcome}>Welcome</button>}
          </div>
          <ArgonStepper
            steps={steps}
            currentStep={currentStep}
            onStepClick={(id) => setStep(id as 1 | 2 | 3 | 4)}
          />
          <div className="flex items-center gap-3">
            {currentStep !== 4 && <button type="button" onClick={() => setStep(4)} className="rh-program-reference-link">Reference Upload</button>}
            {onOpenCadImport && (
              <button
                type="button"
                data-testid="brief-import-cad-btn"
                onClick={onOpenCadImport}
                className="rh-program-reference-link text-sky-400 hover:text-sky-300"
              >
                Import CAD (.DXF / .DWG / .PDF)
              </button>
            )}
          </div>
        </header>
        <div key={currentStep} className="rh-program-fields">
          {currentStep === 1 && <Stage1PlotAndSetbacks survey={survey} />}
          {currentStep === 2 && <Stage2FloorsAndParking />}
          {currentStep === 3 && <Stage3FlatsAndBhkMix />}
          {currentStep === 4 && <Stage4PromptAndUpload onReadingChange={setReadingReference} />}
        </div>
        {currentStep === 4 && surveyBlock && <p className="rh-survey-message" data-testid="survey-generation-block">{surveyBlock}</p>}
        <footer>
          <ArgonButton
            variant="secondary"
            size="md"
            leftIcon={currentStep === 1 ? <X className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
            onClick={() => {
              if (currentStep > 1) prevStep();
              else if (onCancel) onCancel();
            }}
          >
            {currentStep === 1 ? 'Cancel Setup' : 'Back'}
          </ArgonButton>

          <div className="flex items-center gap-3">
            {currentStep < 4 ? (
              <ArgonButton
                variant="primary"
                size="md"
                rightIcon={<ArrowRight className="w-4 h-4" />}
                disabled={currentStep === 3 && !isBhkMixValid}
                onClick={nextStep}
              >
                Continue to Step 0{currentStep + 1}
              </ArgonButton>
            ) : (
              <ArgonButton
                variant="primary"
                size="md"
                leftIcon={<Sparkles className="w-4 h-4" />}
                disabled={!isBhkMixValid || readingReference || Boolean(surveyBlock)}
                onClick={handleFinish}
              >
                Generate Architectural Project
              </ArgonButton>
            )}
          </div>
        </footer>
      </div>
    </section>
  );
};
