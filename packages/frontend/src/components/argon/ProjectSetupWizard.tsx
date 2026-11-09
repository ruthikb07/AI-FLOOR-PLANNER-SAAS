import React from 'react';
import type { AuthorityType, CongestionZone } from '@ai-floor-planner/core';
import {
  Building2,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  X,
} from 'lucide-react';
import { useStudioStore } from '../../stores/useStudioStore';
import {
  ArgonButton,
  ArgonStepper,
  type ArgonStepItem,
} from './ui';
import { Stage1PlotAndSetbacks } from './wizard/Stage1PlotAndSetbacks';
import { Stage2FloorsAndParking } from './wizard/Stage2FloorsAndParking';
import { Stage3FlatsAndBhkMix } from './wizard/Stage3FlatsAndBhkMix';
import { Stage4PromptAndUpload } from './wizard/Stage4PromptAndUpload';

export interface ProjectSetupWizardData {
  authorityType?: AuthorityType;
  congestionZone?: CongestionZone;
  projectName: string;
  plotWidthM: number;
  plotDepthM: number;
  roadWidthM: number;
  roadFacing: 'North' | 'East' | 'South' | 'West';
  frontSetbackM: number;
  rearSetbackM: number;
  sideSetbackM: number;
  floorsCount: number;
  hasStiltParking: boolean;
  flatsPerFloor: number;
  bhkMix: Array<{
    unitType: '1BHK' | '2BHK' | '3BHK' | '4BHK';
    carpetAreaSqFt: number;
    count: number;
  }>;
  aiPrompt: string;
  referenceSketchName?: string;
  referenceImage?: { name: string; mimeType: string; dataUrl: string };
}

interface ProjectSetupWizardProps {
  onGenerate: (data: ProjectSetupWizardData) => void;
  onCancel?: () => void;
}

export const ProjectSetupWizard: React.FC<ProjectSetupWizardProps> = ({
  onGenerate,
  onCancel,
}) => {
  const {
    currentStep,
    setStep,
    nextStep,
    prevStep,
    getProjectSetupWizardData,
    isBhkMixValid,
  } = useStudioStore();

  const steps: ArgonStepItem[] = [
    { id: 1, label: 'Plot & Road', sublabel: 'Statutory Setbacks' },
    { id: 2, label: 'Floors & Stilt', sublabel: 'Plinth Parking' },
    { id: 3, label: 'Flats & BHK Mix', sublabel: 'Typology Split' },
    { id: 4, label: 'AI Intent', sublabel: 'Reference Upload' },
  ];

  const handleFinish = () => {
    const data = getProjectSetupWizardData();
    onGenerate(data);
  };

  return (
    <div className="argon-setup w-full h-full min-h-0 bg-argon-bg text-argon-text flex flex-col items-center justify-start p-4 sm:p-6 argon-scrollbar">
      <div className="w-full max-w-4xl bg-argon-card border border-argon-border rounded-2xl shadow-md overflow-hidden flex flex-col my-auto">
        {/* Wizard Header Bar */}
        <div className="bg-argon-surface/90 border-b border-argon-border px-6 py-4.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-argon-btn text-argon-card flex items-center justify-center shadow-xs">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-argon-muted">
                Stage 0{currentStep} of 04 • Architectural Intake
              </span>
              <h2 className="text-lg font-bold text-argon-text mt-0.5 tracking-tight">
                {currentStep === 1 && 'Step 1: Plot Dimensions, Road & Setbacks'}
                {currentStep === 2 && 'Step 2: Floors & Ground Stilt Parking'}
                {currentStep === 3 && 'Step 3: Flats Per Floor Strategy & BHK Mix'}
                {currentStep === 4 && 'Step 4: AI Design Guidance & Reference'}
              </h2>
            </div>
          </div>

          {/* Stepper Navigation */}
          <ArgonStepper
            steps={steps}
            currentStep={currentStep}
            onStepClick={(id) => setStep(id as 1 | 2 | 3 | 4)}
          />
        </div>

        {/* Step Body Content */}
        <div className="p-6 sm:p-8 flex-1 overflow-y-auto">
          {currentStep === 1 && <Stage1PlotAndSetbacks />}
          {currentStep === 2 && <Stage2FloorsAndParking />}
          {currentStep === 3 && <Stage3FlatsAndBhkMix />}
          {currentStep === 4 && <Stage4PromptAndUpload />}
        </div>

        {/* Wizard Footer Controls */}
        <div className="bg-argon-surface/90 border-t border-argon-border px-6 py-4 flex items-center justify-between">
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
                disabled={!isBhkMixValid}
                onClick={handleFinish}
              >
                Generate Architectural Project
              </ArgonButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
