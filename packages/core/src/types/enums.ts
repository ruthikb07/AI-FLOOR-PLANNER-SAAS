/**
 * Domain enumerations for the Building Model.
 */

/** Types of rooms supported in the system. */
export enum RoomType {
  /** Non-walkable service/ventilation void; never a circulation shortcut. */
  ServiceShaft = 'service_shaft',
  Bedroom = 'bedroom',
  Bathroom = 'bathroom',
  Kitchen = 'kitchen',
  Living = 'living',
  Dining = 'dining',
  Utility = 'utility',
  Balcony = 'balcony',
  Staircase = 'staircase',
  Lift = 'lift',
  Parking = 'parking',
  Pooja = 'pooja',
  Storage = 'storage',
  Corridor = 'corridor',
  Foyer = 'foyer',
  Study = 'study',
  ServantQuarter = 'servant_quarter',
  Drawing = 'drawing',
  FamilyLiving = 'family_living',
  Terrace = 'terrace',
  Garden = 'garden',
  OTS = 'ots',
  Porch = 'porch',
  Dressing = 'dressing',
  Custom = 'custom',
}

/** Cardinal directions. */
export enum Direction {
  North = 'north',
  South = 'south',
  East = 'east',
  West = 'west',
}

/** Daylight requirement levels. */
export enum DaylightLevel {
  None = 'none',
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

/** Privacy requirement levels. */
export enum PrivacyLevel {
  None = 'none',
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

/** General preference levels. */
export enum PreferenceLevel {
  None = 'none',
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

/** Adjacency requirement strength. */
export enum AdjacencyStrength {
  Required = 'required',
  Preferred = 'preferred',
  Avoid = 'avoid',
}

/** Wall types by structural role. */
export enum WallType {
  External = 'external',
  Internal = 'internal',
  Partition = 'partition',
}

/** Door types. */
export enum DoorType {
  /** A hosted, traversable opening with no door leaf or swing. */
  OpenPassage = 'open_passage',
  Single = 'single',
  Double = 'double',
  Sliding = 'sliding',
  Folding = 'folding',
}

/** Door swing directions. */
export enum SwingDirection {
  Inward = 'inward',
  Outward = 'outward',
  Left = 'left',
  Right = 'right',
}

/** Window types. */
export enum WindowType {
  Fixed = 'fixed',
  Sliding = 'sliding',
  Casement = 'casement',
  Ventilator = 'ventilator',
}

/** Staircase types. */
export enum StairType {
  Straight = 'straight',
  LShaped = 'L_shaped',
  UShaped = 'U_shaped',
  Spiral = 'spiral',
}

/** Column cross-section shapes. */
export enum ColumnShape {
  Rectangular = 'rectangular',
  Circular = 'circular',
}

/** Project lifecycle status. */
export enum ProjectStatus {
  Draft = 'draft',
  Active = 'active',
  Completed = 'completed',
  Archived = 'archived',
}

/** Source of a plan change. */
export enum ChangeSource {
  Manual = 'manual',
  AIEdit = 'ai_edit',
  Generation = 'generation',
}

/** Plot shapes. */
export enum PlotShape {
  Rectangular = 'rectangular',
  LShaped = 'L_shaped',
  Irregular = 'irregular',
}

/** AI task types for routing. */
export enum AITaskType {
  RequirementExtraction = 'requirement_extraction',
  PlanExplanation = 'plan_explanation',
  DesignCritique = 'design_critique',
  NaturalLanguageEdit = 'natural_language_edit',
  RoomNaming = 'room_naming',
  VastuAnalysis = 'vastu_analysis',
  ImageUnderstanding = 'image_understanding',
  ComplexReasoning = 'complex_reasoning',
}

/**
 * High-level building typology classification.
 * Canonical enum locked to ResidentialApartment for Phase 1A,
 * with full future typology extensibility hooks.
 */
export enum BuildingTypologyCategory {
  ResidentialApartment = 'RESIDENTIAL_APARTMENT',
  ResidentialBungalow = 'RESIDENTIAL_BUNGALOW',
  ResidentialRowHouse = 'RESIDENTIAL_ROW_HOUSE',
  CommercialOffice = 'COMMERCIAL_OFFICE',
  MercantileMarket = 'MERCANTILE_MARKET',
  Educational = 'EDUCATIONAL',
  Assembly = 'ASSEMBLY',
  StorageWarehouse = 'STORAGE_WAREHOUSE',
  Industrial = 'INDUSTRIAL',
}

/** Flats per floor topology classification. */
export type FlatPerFloorTopology = 'DOUBLE_FLAT' | 'TRIPLE_FLAT' | 'QUAD_FLAT';

/** Lot utilization / allotment policy for building generation. */
export type LotAllotmentMode = 'FULL_LOT_100_PERCENT' | 'STATUTORY_SETBACK_100_PERCENT';

/** Standard residential apartment unit BHK configurations. */
export type ApartmentBhkType = '1BHK' | '2BHK' | '3BHK' | '4BHK';

/** Standard Indian / Maharashtra statutory planning jurisdictions. */
export type ApartmentJurisdictionCode =
  | 'pune_pmc'
  | 'pune_pmrda'
  | 'mumbai_mcgm'
  | 'generic_maharashtra'
  | 'generic_indian';
