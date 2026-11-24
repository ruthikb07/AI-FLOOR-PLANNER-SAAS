import type { BimKind, BimQuantityRow } from './bim-quantities';

export function queryBimSchedule(question: string, rows: readonly BimQuantityRow[]) {
  const input = question.trim().toLowerCase().replace(/[?.]+$/, '');
  const entity = /^(?:show|list|count) (?:all )?(doors|windows|rooms|walls|flats|stairs)$/.exec(input)?.[1];
  if (entity) {
    const kind = entity.slice(0, -1) as BimKind;
    const matches = rows.filter(row => row.kind === kind);
    return { mode: 'DETERMINISTIC' as const, text: matches.length + ' ' + entity + ' on the active floor', matches };
  }
  if (/^(?:calculate (?:the )?)?(?:total )?window area$/.test(input)) {
    const matches = rows.filter(row => row.kind === 'window');
    const area = matches.reduce((sum, row) => sum + (row.areaMm2 ?? 0), 0);
    return { mode: 'DETERMINISTIC' as const, text: (area / 1e6).toFixed(3) + ' m² of window openings on the active floor', matches };
  }
  return { mode: 'UNSUPPORTED' as const, text: 'Try “Show all doors” or “Total window area” for the active floor.', matches: [] };
}
