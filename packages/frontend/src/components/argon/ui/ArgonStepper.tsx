import React from 'react';
import { Check } from 'lucide-react';

export interface ArgonStepItem {
  id: number;
  label: string;
  sublabel?: string;
  icon?: React.ReactNode;
}

export interface ArgonStepperProps {
  steps: ArgonStepItem[];
  currentStep: number;
  onStepClick?: (stepId: number) => void;
  className?: string;
}

export const ArgonStepper: React.FC<ArgonStepperProps> = ({
  steps,
  currentStep,
  onStepClick,
  className = '',
}) => {
  return (
    <div className={`flex items-center gap-2 overflow-x-auto py-1 ${className}`}>
      {steps.map((step, idx) => {
        const isActive = currentStep === step.id;
        const isCompleted = currentStep > step.id;
        const isClickable = Boolean(onStepClick && step.id <= currentStep);

        const statusClasses = isActive
          ? 'bg-argon-accent/25 border-argon-accent text-argon-text font-bold shadow-2xs ring-1 ring-argon-accent/60'
          : isCompleted
          ? 'bg-argon-pass/15 border-argon-pass/40 text-argon-pass font-semibold'
          : 'bg-argon-surface/60 border-argon-border/80 text-argon-muted';

        return (
          <React.Fragment key={step.id}>
            <button
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onStepClick?.(step.id)}
              className={`flex items-center gap-2.5 px-3.5 py-2 rounded-xl border text-xs font-mono transition-all duration-150 shrink-0 ${statusClasses} ${
                isClickable ? 'cursor-pointer hover:border-argon-btn' : 'cursor-default'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-md flex items-center justify-center text-[11px] font-bold ${
                  isActive
                    ? 'bg-argon-btn text-argon-card'
                    : isCompleted
                    ? 'bg-argon-pass text-white'
                    : 'bg-argon-border/60 text-argon-muted'
                }`}
              >
                {isCompleted ? <Check className="w-3.5 h-3.5 stroke-[2.5]" /> : `0${step.id}`}
              </div>
              <div className="text-left font-sans">
                <div className="font-semibold text-xs leading-none">{step.label}</div>
                {step.sublabel && (
                  <div className="text-[10px] text-argon-muted mt-0.5 leading-none">
                    {step.sublabel}
                  </div>
                )}
              </div>
            </button>
            {idx < steps.length - 1 && (
              <div
                className={`w-4 h-0.5 shrink-0 transition-colors ${
                  isCompleted ? 'bg-argon-pass/50' : 'bg-argon-border'
                }`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

