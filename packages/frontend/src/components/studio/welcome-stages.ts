export const CONSTRUCTION_STAGES = [
  { id: 'site', label: 'Site', range: [0.0, 0.11] as const, summary: 'Plot boundaries, setbacks & approach road' },
  { id: 'stilt', label: 'Stilt', range: [0.11, 0.22] as const, summary: 'Stilt podium slab, portal lobby & parking bays' },
  { id: 'columns', label: 'Columns & Slabs', range: [0.22, 0.36] as const, summary: 'RCC structural grid & lift shear core' },
  { id: 'floors', label: 'Floors', range: [0.36, 0.50] as const, summary: 'Successive upper residential floor plates' },
  { id: 'walls', label: 'Walls', range: [0.50, 0.64] as const, summary: 'Travertine perimeter & suite envelopes' },
  { id: 'glazing', label: 'Glazing', range: [0.64, 0.75] as const, summary: 'Low-E sky glass & champagne mullions' },
  { id: 'balconies', label: 'Balconies', range: [0.75, 0.85] as const, summary: 'Staggered cantilevered decks, rails & chajjas' },
  { id: 'roof', label: 'Roof', range: [0.85, 0.93] as const, summary: 'Terrace parapet, mumty pergola & solar PV' },
  { id: 'landscape', label: 'Landscape', range: [0.93, 1.0] as const, summary: 'Courtyard trees, planters & final framing' },
] as const;
