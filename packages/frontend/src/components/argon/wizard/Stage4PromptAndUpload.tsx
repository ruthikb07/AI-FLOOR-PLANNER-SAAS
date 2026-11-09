import React, { useState } from 'react';
import { Sparkles, Upload, FileText, X, Check, Lightbulb } from 'lucide-react';
import { useStudioStore } from '../../../stores/useStudioStore';
import { ArgonCard, ArgonBadge } from '../ui';

export const Stage4PromptAndUpload: React.FC = () => {
  const { wizard, updateWizard } = useStudioStore();
  const [uploadError, setUploadError] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const promptSuggestions = [
    'Vastu-compliant residential tower with East/North living balconies and Southeast kitchens.',
    'High-end luxury apartments with generous corner balconies, double-height lobby, and dual stair cores.',
    'Compact high-efficiency investor housing with maximized carpet efficiency and centralized plumbing shafts.',
    'Modern urban facade with continuous cantilevered balconies, sun-shaded UPVC fenestrations, and cross ventilation.',
  ];

  const handleFileUpload = (file?: File) => {
    setUploadError('');
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      setUploadError('File size exceeds the 25 MB limit.');
      return;
    }

    if (!['image/png', 'image/jpeg', 'application/pdf'].includes(file.type)) {
      setUploadError('Please select a PNG, JPG or PDF architectural drawing.');
      return;
    }

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      updateWizard({
        referenceSketchName: file.name,
        referenceImage: {
          name: file.name,
          mimeType: file.type,
          dataUrl: String(reader.result),
        },
      });
      setIsUploading(false);
    };
    reader.onerror = () => {
      setUploadError('Failed to read the selected file.');
      setIsUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const clearUploadedFile = () => {
    updateWizard({
      referenceSketchName: undefined,
      referenceImage: undefined,
    });
    setUploadError('');
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* AI Architectural Guidance Prompt */}
      <ArgonCard className="space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-argon-border/70">
          <h3 className="text-sm font-bold text-argon-text flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-argon-accent" />
            <span>AI Architectural Prompt & Guidance</span>
          </h3>
          <ArgonBadge variant="leather" size="sm">
            Design Intent
          </ArgonBadge>
        </div>

        <p className="text-xs text-argon-muted leading-relaxed">
          Provide contextual instructions or design principles to guide floor plan synthesis, spatial zoning, and facade fenestration.
        </p>

        <textarea
          rows={4}
          value={wizard.aiPrompt}
          onChange={(e) => updateWizard({ aiPrompt: e.target.value })}
          placeholder="Describe room layout preferences, orientation priorities, circulation requirements, or architectural style..."
          className="w-full bg-argon-card text-argon-text border border-argon-border rounded-xl p-4 text-sm font-sans focus:outline-none focus:border-argon-btn focus:ring-1 focus:ring-argon-btn transition-colors placeholder:text-argon-muted/50 leading-relaxed"
        />

        {/* Prompt Suggestions Chips */}
        <div className="space-y-2 pt-1">
          <div className="text-[11px] font-mono text-argon-muted flex items-center gap-1.5 font-semibold uppercase">
            <Lightbulb className="w-3.5 h-3.5 text-argon-warn" />
            <span>Click to Apply Inspiration Prompts:</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {promptSuggestions.map((prompt, i) => (
              <button
                key={i}
                type="button"
                onClick={() => updateWizard({ aiPrompt: prompt })}
                className="text-left text-xs bg-argon-surface/70 hover:bg-argon-surface text-argon-text border border-argon-border rounded-lg px-3 py-1.5 transition-colors line-clamp-1 max-w-full"
              >
                &ldquo;{prompt}&rdquo;
              </button>
            ))}
          </div>
        </div>
      </ArgonCard>

      {/* Reference Drawing Upload */}
      <ArgonCard className="space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-argon-border/70">
          <h3 className="text-sm font-bold text-argon-text flex items-center gap-2">
            <Upload className="w-4 h-4 text-argon-btn" />
            <span>Reference Site Plan or Concept Sketch (Optional)</span>
          </h3>
          <span className="text-xs text-argon-muted font-mono">PNG, JPG, PDF up to 25MB</span>
        </div>

        {wizard.referenceSketchName ? (
          <div className="p-4 bg-argon-surface/80 border border-argon-border rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-argon-pass/15 border border-argon-pass/30 text-argon-pass flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-argon-text truncate font-mono">
                  {wizard.referenceSketchName}
                </div>
                <div className="text-xs text-argon-pass flex items-center gap-1 font-medium mt-0.5">
                  <Check className="w-3.5 h-3.5" />
                  <span>Ready for AI visual cross-referencing</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={clearUploadedFile}
              className="p-1.5 rounded-lg text-argon-muted hover:text-argon-error hover:bg-argon-error/10 transition-colors"
              title="Remove file"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="border-2 border-dashed border-argon-border rounded-xl p-8 text-center bg-argon-surface/30 hover:bg-argon-surface/60 transition-colors">
            <div className="w-12 h-12 rounded-xl bg-argon-accent/20 border border-argon-accent/40 text-argon-btn flex items-center justify-center mx-auto mb-3">
              <Upload className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-argon-text">
              Drop Reference Drawing Here or Browse
            </h4>
            <p className="text-xs text-argon-muted mt-1 max-w-md mx-auto">
              Upload existing CAD floor drawings, municipal boundary surveyed plots, or architect hand sketches.
            </p>

            <input
              type="file"
              id="argon-ref-upload"
              accept="image/png,image/jpeg,application/pdf"
              className="hidden"
              onChange={(e) => handleFileUpload(e.target.files?.[0])}
            />

            <div className="mt-4">
              <label
                htmlFor="argon-ref-upload"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-argon-btn hover:bg-argon-btnHover text-argon-card text-xs font-bold cursor-pointer transition-colors shadow-xs"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{isUploading ? 'Uploading...' : 'Browse Local File...'}</span>
              </label>
            </div>

            {uploadError && (
              <p role="alert" className="text-xs text-argon-error font-medium mt-3">
                {uploadError}
              </p>
            )}
          </div>
        )}
      </ArgonCard>
    </div>
  );
};
