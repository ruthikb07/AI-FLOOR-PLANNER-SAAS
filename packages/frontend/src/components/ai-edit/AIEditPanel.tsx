import React, { useMemo, useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, Send, ShieldCheck, X } from 'lucide-react';
import {
  AIEditPlanner,
  type AIEditParseResult,
  type AIEditPreview,
} from '@ai-floor-planner/ai-orchestration';
import type { EditorContextValue } from '../../stores/editor-store';
import { getAIService } from '../../services/ai-provider';

interface AIEditPanelProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly editor: EditorContextValue;
}

interface ChatMessage {
  readonly id: number;
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export const AIEditPanel: React.FC<AIEditPanelProps> = ({ isOpen, onClose, editor }) => {
  const service = useMemo(
    () => getAIService(),
    [],
  );
  const planner = useMemo(() => new AIEditPlanner(), []);
  const [instruction, setInstruction] = useState('');
  const [parseResult, setParseResult] = useState<AIEditParseResult | null>(null);
  const [preview, setPreview] = useState<AIEditPreview | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 1, role: 'assistant', text: 'Describe one room edit. I will preview and validate it before anything changes.' },
  ]);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const selectedRoomId = editor.selection?.entityType === 'room' ? editor.selection.entityId : undefined;

  const previewInstruction = async () => {
    setIsWorking(true);
    setError(null);
    setPreview(null);
    try {
      const parsed = await service.parseEditCommandDetailed(instruction, editor.building, {
        activeFloorId: editor.activeFloor.id,
        selectedRoomId,
      });
      setParseResult(parsed);
      setMessages(current => [...current, { id: Date.now(), role: 'user', text: instruction || '(empty instruction)' }]);
      if (!parsed.intent) {
        const message = parsed.diagnostics.at(-1)?.message ?? 'This instruction could not be parsed safely.';
        setMessages(current => [...current, { id: Date.now() + 1, role: 'assistant', text: message }]);
        return;
      }
      const nextPreview = planner.preview(editor.building, parsed.intent, {
        activeFloorId: editor.activeFloor.id,
        selectedRoomId,
        requiredRoomCounts: editor.requiredRoomCounts,
      });
      setPreview(nextPreview);
      setMessages(current => [...current, { id: Date.now() + 1, role: 'assistant', text: nextPreview.message }]);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'The edit could not be previewed.';
      setError(message);
    } finally {
      setIsWorking(false);
    }
  };

  const applyPreview = () => {
    if (!preview?.command) return;
    try {
      editor.executeCommand(preview.command);
      setMessages(current => [...current, {
        id: Date.now(),
        role: 'assistant',
        text: `Applied as plan version ${preview.afterBuilding?.version}. Use Undo to reverse this single AI transaction.`,
      }]);
      setPreview(null);
      setInstruction('');
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The validated edit could not be applied.');
    }
  };

  const selectedLabel = selectedRoomId
    ? editor.activeFloor.rooms.find(room => room.id === selectedRoomId)?.name ?? 'Selected room'
    : 'No room selected';

  return (
    <div
      role="dialog"
      aria-label="AI Plan Editor"
      style={{
        position: 'fixed', inset: 0, zIndex: 1200, pointerEvents: 'none',
        display: 'flex', justifyContent: 'flex-end', alignItems: 'stretch',
      }}
    >
      <aside
        style={{
          pointerEvents: 'auto', width: 430, maxWidth: '92vw', marginTop: 52, marginBottom: 28,
          background: 'var(--bg-panel)', borderLeft: '1px solid var(--border-color)',
          boxShadow: '-12px 0 32px rgba(0,0,0,0.32)', display: 'flex', flexDirection: 'column',
        }}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Bot size={18} color="var(--accent-cyan)" />
            <span className="modal-title">AI Plan Editor</span>
            <span className="badge badge-cyan">Preview first</span>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close AI Plan Editor"><X size={16} /></button>
        </div>

        <div style={{ padding: 12, borderBottom: '1px solid var(--border-color)', fontSize: 11, color: 'var(--text-secondary)' }}>
          <ShieldCheck size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} color="var(--accent-green)" />
          Validation-gated • Version {editor.building.version} • {selectedLabel}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.map(message => (
            <div
              key={message.id}
              style={{
                alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '88%', padding: '9px 11px', borderRadius: 10, fontSize: 12, lineHeight: 1.45,
                background: message.role === 'user' ? 'var(--bg-selection)' : 'var(--bg-canvas)',
                border: `1px solid ${message.role === 'user' ? 'var(--accent-cyan)' : 'var(--border-color)'}`,
                color: 'var(--text-primary)',
              }}
            >
              {message.text}
            </div>
          ))}

          {preview && (
            <div style={{ padding: 12, borderRadius: 8, border: `1px solid ${preview.status === 'ready' ? 'var(--accent-green)' : '#f0b429'}`, background: preview.status === 'ready' ? 'rgba(0,230,153,.08)' : 'rgba(240,180,41,.08)', fontSize: 11 }}>
              <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 7 }}>
                {preview.status === 'ready' ? <CheckCircle2 size={15} color="var(--accent-green)" /> : <AlertTriangle size={15} color="#f0b429" />}
                <strong>{preview.status === 'ready' ? 'VALIDATED PREVIEW' : preview.status.replace('_', ' ').toUpperCase()}</strong>
              </div>
              <div>Target: {preview.targetRoom?.name ?? 'Needs clarification'}</div>
              <div>Candidates: {preview.validCandidates}/{preview.attemptedCandidates} hard-valid</div>
              {preview.afterValidation && <div>Quality: {preview.beforeValidation.overallScore}→{preview.afterValidation.overallScore}</div>}
              {preview.afterBuilding && <div>Version: {preview.beforeBuilding.version}→{preview.afterBuilding.version}</div>}
              {preview.command && (
                <button className="btn btn-primary" onClick={applyPreview} style={{ width: '100%', marginTop: 10 }}>
                  <ShieldCheck size={14} /> Apply Validated Edit
                </button>
              )}
            </div>
          )}

          {parseResult && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {parseResult.source === 'provider' ? `AI parsed • ${parseResult.providerName}` : parseResult.usedFallback ? 'Safe local fallback' : 'Deterministic local parser'}
              {' '}• {parseResult.latencyMs} ms
            </div>
          )}
          {error && <div role="alert" style={{ color: 'var(--accent-red)', fontSize: 11 }}>{error}</div>}
        </div>

        <div style={{ padding: 12, borderTop: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
            {['Make selected room 10% larger', 'Move kitchen east by 300 mm', 'Rename kitchen to Chef Kitchen'].map(example => (
              <button key={example} className="btn btn-secondary" onClick={() => setInstruction(example)} style={{ fontSize: 9, padding: '4px 6px' }}>{example}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              aria-label="AI edit instruction"
              value={instruction}
              onChange={event => setInstruction(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter' && !isWorking) void previewInstruction(); }}
              placeholder="e.g. Make the master bedroom 10% larger"
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary" onClick={() => void previewInstruction()} disabled={isWorking || !instruction.trim()} aria-label="Preview AI edit">
              <Send size={14} /> Preview
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
};
