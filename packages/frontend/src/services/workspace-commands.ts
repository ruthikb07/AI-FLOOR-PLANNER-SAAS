export type WorkspaceCommandGroup = 'Tools' | 'Floors' | 'Views' | 'Selection' | 'Generation' | 'Project';

export interface WorkspaceCommand {
  readonly id: string;
  readonly label: string;
  readonly group: WorkspaceCommandGroup;
  readonly keywords: readonly string[];
  readonly shortcut?: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly run: () => void;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().trim().replace(/\s+/g, ' ');
}

export function filterWorkspaceCommands(
  commands: readonly WorkspaceCommand[],
  query: string,
): WorkspaceCommand[] {
  const terms = normalize(query).split(' ').filter(Boolean);
  if (terms.length === 0) return [...commands];
  return commands.filter(command => {
    const haystack = normalize([command.label, command.group, ...command.keywords].join(' '));
    return terms.every(term => haystack.includes(term));
  });
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
}

const FLOOR_ORDINALS = ['ground', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'] as const;

export function floorSearchKeywords(level: number): string[] {
  return ['floor', `level ${level}`, String(level), FLOOR_ORDINALS[level] ?? `level ${level}`];
}

export function hasOpeningPositionChanged(
  before: { readonly x: number; readonly y: number },
  after: { readonly x: number; readonly y: number },
): boolean {
  return before.x !== after.x || before.y !== after.y;
}

export function calculateFloorPlatePercentage(baseArea: number, floorArea: number): number {
  if (!Number.isFinite(baseArea) || baseArea <= 0 || !Number.isFinite(floorArea) || floorArea < 0) return 0;
  return Math.round(floorArea / baseArea * 100);
}
