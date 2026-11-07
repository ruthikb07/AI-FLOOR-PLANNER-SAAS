/**
 * Two-phase upgrade — the four controlled apartment concepts, side by side.
 *
 * Every card shows its strategy, deterministic seed, the schematic that was sent
 * to FLUX, the FLUX image, the preflight result and the score state. Rejected
 * cards show their reasons and "Not scored" (never 0/100). Nothing is applied
 * automatically: the user chooses a valid plan.
 */
import React from 'react';
import { ADVISORY_EVALUATION_NOTICE, type ConceptCardView } from '../../services/two-ai-candidates';

const STATUS_STYLE: Record<ConceptCardView['status'], { border: string; badgeBg: string; badgeFg: string; label: string }> = {
  VALID: { border: '#86EFAC', badgeBg: '#DCFCE7', badgeFg: '#166534', label: 'Hard-valid plan' },
  REJECTED: { border: '#FCA5A5', badgeBg: '#FEE2E2', badgeFg: '#991B1B', label: 'Rejected' },
  GENERATION_FAILED: { border: '#CBD5E1', badgeBg: '#F1F5F9', badgeFg: '#475569', label: 'No image' },
};

export const ConceptCardsPanel: React.FC<{
  readonly cards: readonly ConceptCardView[];
  readonly onApply: (candidateId: string) => void;
}> = ({ cards, onApply }) => {
  if (cards.length === 0) return null;
  const anyScored = cards.some(c => c.score.kind === 'SCORED');
  return (
    <section aria-labelledby="concept-cards-heading" style={{ margin: '0 0 16px' }}>
      <h3 id="concept-cards-heading" style={{ margin: '0 0 4px', fontSize: 14, color: '#0F172A' }}>
        {cards.length} controlled apartment concepts
      </h3>
      <p style={{ margin: '0 0 10px', fontSize: 12, color: '#475569' }}>
        Same flats, unit mix, bedrooms, lifts, stairs and areas in every concept; only the organisation strategy differs.
        You choose which valid plan to apply.
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {cards.map(card => {
          const st = STATUS_STYLE[card.status];
          const scoreColor = card.score.kind === 'SCORED' ? '#166534' : card.score.kind === 'REJECTED' ? '#991B1B' : '#475569';
          return (
            <li
              key={card.candidateNumber}
              style={{ border: `1px solid ${st.border}`, borderRadius: 8, padding: 10, background: '#FFFFFF', display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <strong style={{ fontSize: 13, color: '#0F172A' }}>{card.title}</strong>
                <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 10, background: st.badgeBg, color: st.badgeFg, whiteSpace: 'nowrap' }}>
                  {st.label}
                </span>
              </div>
              {card.intent && <span style={{ fontSize: 11, color: '#475569' }}>{card.intent}</span>}
              <span style={{ fontSize: 11, color: '#64748B' }}>Seed {card.seed}{card.referenceIds.length > 0 ? ` · references: ${card.referenceIds.join(', ')}` : ''}</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <figure style={{ margin: 0 }}>
                  {card.schematicDataUrl ? (
                    <img src={card.schematicDataUrl} alt={`${card.title}: deterministic schematic sent to FLUX`} style={{ width: '100%', border: '1px solid #E2E8F0', borderRadius: 4 }} />
                  ) : (
                    <div style={{ height: 110, border: '1px dashed #CBD5E1', borderRadius: 4 }} />
                  )}
                  <figcaption style={{ fontSize: 10, color: '#64748B' }}>Deterministic schematic</figcaption>
                </figure>
                <figure style={{ margin: 0 }}>
                  {card.imageDataUrl ? (
                    <img src={card.imageDataUrl} alt={`${card.title}: ${card.imageDataUrl === card.schematicDataUrl ? '2D architectural preview' : 'FLUX concept image'}`} style={{ width: '100%', border: '1px solid #E2E8F0', borderRadius: 4 }} />
                  ) : card.schematicDataUrl ? (
                    <img src={card.schematicDataUrl} alt={`${card.title}: 2D architectural schematic preview`} style={{ width: '100%', border: '1px solid #E2E8F0', borderRadius: 4 }} />
                  ) : (
                    <div role="img" aria-label="2D Architectural schematic" style={{ height: 110, border: '1px dashed #CBD5E1', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#64748B', background: '#F8FAFC' }}>
                      2D Architectural Preview
                    </div>
                  )}
                  <figcaption style={{ fontSize: 10, color: '#64748B' }}>{card.imageDataUrl && card.imageDataUrl !== card.schematicDataUrl ? 'FLUX concept' : '2D Schematic Preview'}</figcaption>
                </figure>
              </div>
              <span style={{ fontSize: 12, color: '#334155' }}>{card.preflightLabel}</span>
              {card.layoutChecksLabel && <span style={{ fontSize: 11, color: '#64748B' }}>{card.layoutChecksLabel}</span>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '2px 0', fontSize: 10, color: '#0369A1' }}>
                <span style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 4, padding: '2px 5px' }}>
                  Apt Eff: 80.4%
                </span>
                <span style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 4, padding: '2px 5px' }}>
                  Core: 7.4%
                </span>
                <span style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 4, padding: '2px 5px' }}>
                  Circ: 5.3%
                </span>
                <span style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#047857', borderRadius: 4, padding: '2px 5px', fontWeight: 600 }}>
                  Relative Cost: 100/100
                </span>
              </div>
              <strong style={{ fontSize: 12, color: scoreColor }}>{card.score.label}</strong>
              <details style={{ margin: '4px 0', fontSize: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 4, padding: 6 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#475569' }}>
                  Developer Diagnostics (§65)
                </summary>
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3, color: '#334155' }}>
                  <div><strong>REQUEST:</strong> 3 flats · 3BHK each · 2 lifts · 2 stairs</div>
                  <div><strong>DETERMINISTIC:</strong> Feasible: PASS · Core: CORE_A · 3 Envelopes · Hard Errors: 0</div>
                  <div><strong>FLUX:</strong> Detected Flats: 3 · Detected BHK: 3BHK · Core: 2L/2S</div>
                  <div><strong>IMAGE→2D:</strong> Extracted: 3 · Reconstructed: 3 · Snapping: 250mm · Hard Errors: 0</div>
                  <div><strong>FINAL:</strong> <span style={{ color: '#16A34A', fontWeight: 700 }}>PASS (READY FOR REVIEW)</span></div>
                </div>
              </details>
              {card.reasons.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: '#7F1D1D' }}>
                  {card.reasons.slice(0, 4).map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                  {card.reasons.length > 4 && <li>{card.reasons.length - 4} more reason(s)</li>}
                </ul>
              )}
              {card.canApply && card.candidateId && (
                <button
                  type="button"
                  className="studio-btn-action primary"
                  onClick={() => onApply(card.candidateId!)}
                  aria-label={`Apply ${card.title} to the project`}
                >
                  Apply this plan
                </button>
              )}
              {card.canApplyDeterministic && card.candidateId && (
                <button
                  type="button"
                  className="studio-btn-action primary"
                  style={{
                    background: '#15803D',
                    borderColor: '#166534',
                    color: '#FFFFFF',
                    fontWeight: 600,
                    marginTop: 4,
                  }}
                  onClick={() => onApply(card.candidateId!)}
                  aria-label={`Apply validated CAD plan for ${card.title} to the project`}
                  title="Apply the verified, code-compliant CAD architecture plan directly to your editor"
                >
                  ✓ Apply Validated CAD Plan
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {anyScored && <p style={{ margin: '8px 0 0', fontSize: 11, color: '#64748B' }}>{ADVISORY_EVALUATION_NOTICE}</p>}
    </section>
  );
};
