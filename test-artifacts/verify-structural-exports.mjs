// scripts/verify-structural-exports.mjs
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

// packages/core/src/types/multi-sheet-apartment.ts
var DEFAULT_SITE_AMENITIES = {
  securityCabin: true,
  landscapeGardenRos: true,
  childrenPlayTotLot: true,
  seniorCitizenSitout: true,
  transformerDgYard: true,
  ugwtPumpRoom: true,
  stpPlant: true,
  owcWasteYard: true,
  rainwaterHarvestingPits: true,
  evChargingBays: true
};
var DEFAULT_STILT_AMENITIES = {
  grandEntranceLobby: true,
  societyOffice: true,
  fitnessGymnasium: true,
  multipurposeHall: true,
  meterBmsRoom: true,
  driverStaffToilet: true
};
var DEFAULT_TERRACE_AMENITIES = {
  stairMumtyHeadroom: true,
  liftMachineRoom: true,
  overheadWaterTank: true,
  solarPvArray: true,
  terraceYogaDeck: true
};

// packages/core/dist/types/enums.js
var RoomType;
(function(RoomType2) {
  RoomType2["ServiceShaft"] = "service_shaft";
  RoomType2["Bedroom"] = "bedroom";
  RoomType2["Bathroom"] = "bathroom";
  RoomType2["Kitchen"] = "kitchen";
  RoomType2["Living"] = "living";
  RoomType2["Dining"] = "dining";
  RoomType2["Utility"] = "utility";
  RoomType2["Balcony"] = "balcony";
  RoomType2["Staircase"] = "staircase";
  RoomType2["Lift"] = "lift";
  RoomType2["Parking"] = "parking";
  RoomType2["Pooja"] = "pooja";
  RoomType2["Storage"] = "storage";
  RoomType2["Corridor"] = "corridor";
  RoomType2["Foyer"] = "foyer";
  RoomType2["Study"] = "study";
  RoomType2["ServantQuarter"] = "servant_quarter";
  RoomType2["Drawing"] = "drawing";
  RoomType2["FamilyLiving"] = "family_living";
  RoomType2["Terrace"] = "terrace";
  RoomType2["Garden"] = "garden";
  RoomType2["OTS"] = "ots";
  RoomType2["Porch"] = "porch";
  RoomType2["Dressing"] = "dressing";
  RoomType2["Custom"] = "custom";
})(RoomType || (RoomType = {}));
var Direction;
(function(Direction3) {
  Direction3["North"] = "north";
  Direction3["South"] = "south";
  Direction3["East"] = "east";
  Direction3["West"] = "west";
})(Direction || (Direction = {}));
var DaylightLevel;
(function(DaylightLevel2) {
  DaylightLevel2["None"] = "none";
  DaylightLevel2["Low"] = "low";
  DaylightLevel2["Medium"] = "medium";
  DaylightLevel2["High"] = "high";
})(DaylightLevel || (DaylightLevel = {}));
var PrivacyLevel;
(function(PrivacyLevel2) {
  PrivacyLevel2["None"] = "none";
  PrivacyLevel2["Low"] = "low";
  PrivacyLevel2["Medium"] = "medium";
  PrivacyLevel2["High"] = "high";
})(PrivacyLevel || (PrivacyLevel = {}));
var PreferenceLevel;
(function(PreferenceLevel2) {
  PreferenceLevel2["None"] = "none";
  PreferenceLevel2["Low"] = "low";
  PreferenceLevel2["Medium"] = "medium";
  PreferenceLevel2["High"] = "high";
})(PreferenceLevel || (PreferenceLevel = {}));
var AdjacencyStrength;
(function(AdjacencyStrength2) {
  AdjacencyStrength2["Required"] = "required";
  AdjacencyStrength2["Preferred"] = "preferred";
  AdjacencyStrength2["Avoid"] = "avoid";
})(AdjacencyStrength || (AdjacencyStrength = {}));
var WallType;
(function(WallType2) {
  WallType2["External"] = "external";
  WallType2["Internal"] = "internal";
  WallType2["Partition"] = "partition";
})(WallType || (WallType = {}));
var DoorType;
(function(DoorType2) {
  DoorType2["OpenPassage"] = "open_passage";
  DoorType2["Single"] = "single";
  DoorType2["Double"] = "double";
  DoorType2["Sliding"] = "sliding";
  DoorType2["Folding"] = "folding";
})(DoorType || (DoorType = {}));
var SwingDirection;
(function(SwingDirection2) {
  SwingDirection2["Inward"] = "inward";
  SwingDirection2["Outward"] = "outward";
  SwingDirection2["Left"] = "left";
  SwingDirection2["Right"] = "right";
})(SwingDirection || (SwingDirection = {}));
var WindowType;
(function(WindowType2) {
  WindowType2["Fixed"] = "fixed";
  WindowType2["Sliding"] = "sliding";
  WindowType2["Casement"] = "casement";
  WindowType2["Ventilator"] = "ventilator";
})(WindowType || (WindowType = {}));
var StairType;
(function(StairType2) {
  StairType2["Straight"] = "straight";
  StairType2["LShaped"] = "L_shaped";
  StairType2["UShaped"] = "U_shaped";
  StairType2["Spiral"] = "spiral";
})(StairType || (StairType = {}));
var ColumnShape;
(function(ColumnShape2) {
  ColumnShape2["Rectangular"] = "rectangular";
  ColumnShape2["Circular"] = "circular";
})(ColumnShape || (ColumnShape = {}));
var ProjectStatus;
(function(ProjectStatus2) {
  ProjectStatus2["Draft"] = "draft";
  ProjectStatus2["Active"] = "active";
  ProjectStatus2["Completed"] = "completed";
  ProjectStatus2["Archived"] = "archived";
})(ProjectStatus || (ProjectStatus = {}));
var ChangeSource;
(function(ChangeSource2) {
  ChangeSource2["Manual"] = "manual";
  ChangeSource2["AIEdit"] = "ai_edit";
  ChangeSource2["Generation"] = "generation";
})(ChangeSource || (ChangeSource = {}));
var PlotShape;
(function(PlotShape2) {
  PlotShape2["Rectangular"] = "rectangular";
  PlotShape2["LShaped"] = "L_shaped";
  PlotShape2["Irregular"] = "irregular";
})(PlotShape || (PlotShape = {}));
var AITaskType;
(function(AITaskType2) {
  AITaskType2["RequirementExtraction"] = "requirement_extraction";
  AITaskType2["PlanExplanation"] = "plan_explanation";
  AITaskType2["DesignCritique"] = "design_critique";
  AITaskType2["NaturalLanguageEdit"] = "natural_language_edit";
  AITaskType2["RoomNaming"] = "room_naming";
  AITaskType2["VastuAnalysis"] = "vastu_analysis";
  AITaskType2["ImageUnderstanding"] = "image_understanding";
  AITaskType2["ComplexReasoning"] = "complex_reasoning";
})(AITaskType || (AITaskType = {}));
var BuildingTypologyCategory;
(function(BuildingTypologyCategory2) {
  BuildingTypologyCategory2["ResidentialApartment"] = "RESIDENTIAL_APARTMENT";
  BuildingTypologyCategory2["ResidentialBungalow"] = "RESIDENTIAL_BUNGALOW";
  BuildingTypologyCategory2["ResidentialRowHouse"] = "RESIDENTIAL_ROW_HOUSE";
  BuildingTypologyCategory2["CommercialOffice"] = "COMMERCIAL_OFFICE";
  BuildingTypologyCategory2["MercantileMarket"] = "MERCANTILE_MARKET";
  BuildingTypologyCategory2["Educational"] = "EDUCATIONAL";
  BuildingTypologyCategory2["Assembly"] = "ASSEMBLY";
  BuildingTypologyCategory2["StorageWarehouse"] = "STORAGE_WAREHOUSE";
  BuildingTypologyCategory2["Industrial"] = "INDUSTRIAL";
})(BuildingTypologyCategory || (BuildingTypologyCategory = {}));

// packages/core/dist/types/apartment-manifest.js
var PROGRAMMATIC_2BHK_MANIFEST = [
  {
    id: "foyer_living_dining",
    name: "Living & Dining Room",
    type: RoomType.Living,
    minAreaMm2: 24e6,
    // 24 m²
    targetAreaMm2: 28e6,
    minWidthMm: 3300,
    isMandatory: true,
    zone: "PUBLIC",
    description: "Primary arrival, family lounge, and dining zone with front daylight access"
  },
  {
    id: "kitchen",
    name: "Kitchen",
    type: RoomType.Kitchen,
    minAreaMm2: 65e5,
    // 6.5 m²
    targetAreaMm2: 8e6,
    minWidthMm: 2200,
    isMandatory: true,
    zone: "SERVICE",
    description: "Food preparation zone with parallel counter space and service ventilation"
  },
  {
    id: "utility",
    name: "Kitchen Utility Yard",
    type: RoomType.Utility,
    minAreaMm2: 2e6,
    // 2.0 m²
    targetAreaMm2: 3e6,
    minWidthMm: 1200,
    isMandatory: true,
    attachedToRoomId: "kitchen",
    zone: "SERVICE",
    description: "Wet service washing yard adjacent to kitchen with exterior drainage access"
  },
  {
    id: "master_bedroom",
    name: "Master Bedroom",
    type: RoomType.Bedroom,
    minAreaMm2: 125e5,
    // 12.5 m²
    targetAreaMm2: 15e6,
    minWidthMm: 3e3,
    isMandatory: true,
    zone: "PRIVATE",
    description: "Primary bedroom suite with wardrobe niche and attached private bath"
  },
  {
    id: "master_toilet",
    name: "Master En-suite Toilet",
    type: RoomType.Bathroom,
    minAreaMm2: 32e5,
    // 3.2 m²
    targetAreaMm2: 4e6,
    minWidthMm: 1400,
    isMandatory: true,
    attachedToRoomId: "master_bedroom",
    zone: "SERVICE",
    description: "En-suite 3-fixture bathroom exclusively accessible from Master Bedroom"
  },
  {
    id: "bedroom_2",
    name: "Bedroom 02",
    type: RoomType.Bedroom,
    minAreaMm2: 105e5,
    // 10.5 m²
    targetAreaMm2: 12e6,
    minWidthMm: 2800,
    isMandatory: true,
    zone: "PRIVATE",
    description: "Second bedroom with operable exterior window and private passage access"
  },
  {
    id: "common_toilet",
    name: "Common Bathroom",
    type: RoomType.Bathroom,
    minAreaMm2: 28e5,
    // 2.8 m²
    targetAreaMm2: 35e5,
    minWidthMm: 1300,
    isMandatory: true,
    zone: "SERVICE",
    description: "General unit bathroom accessible from internal circulation passage"
  },
  {
    id: "standing_balcony",
    name: "Standing Balcony",
    type: RoomType.Balcony,
    minAreaMm2: 35e5,
    // 3.5 m²
    targetAreaMm2: 45e5,
    minWidthMm: 2400,
    isMandatory: true,
    attachedToRoomId: "foyer_living_dining",
    zone: "OUTDOOR",
    description: "Usable exterior cantilevered or recessed balcony with clear depth >= 1200 mm"
  }
];
var PROGRAMMATIC_3BHK_MANIFEST = [
  {
    id: "foyer_living_dining",
    name: "Living & Dining Room",
    type: RoomType.Living,
    minAreaMm2: 28e6,
    // 28 m²
    targetAreaMm2: 34e6,
    minWidthMm: 3600,
    isMandatory: true,
    zone: "PUBLIC",
    description: "Spacious formal living and dining area with dual lighting orientation"
  },
  {
    id: "kitchen",
    name: "Kitchen",
    type: RoomType.Kitchen,
    minAreaMm2: 75e5,
    // 7.5 m²
    targetAreaMm2: 95e5,
    minWidthMm: 2400,
    isMandatory: true,
    zone: "SERVICE",
    description: "Full-service kitchen with wet/dry counters and direct utility link"
  },
  {
    id: "utility",
    name: "Kitchen Utility Yard",
    type: RoomType.Utility,
    minAreaMm2: 25e5,
    // 2.5 m²
    targetAreaMm2: 35e5,
    minWidthMm: 1200,
    isMandatory: true,
    attachedToRoomId: "kitchen",
    zone: "SERVICE",
    description: "Service wash balcony for laundry and washing machine hookups"
  },
  {
    id: "master_bedroom_1",
    name: "Master Bedroom 01",
    type: RoomType.Bedroom,
    minAreaMm2: 14e6,
    // 14 m²
    targetAreaMm2: 17e6,
    minWidthMm: 3300,
    isMandatory: true,
    zone: "PRIVATE",
    description: "Primary master suite with King-bed wall and attached private bath"
  },
  {
    id: "attached_toilet_1",
    name: "Master En-suite Toilet 01",
    type: RoomType.Bathroom,
    minAreaMm2: 38e5,
    // 3.8 m²
    targetAreaMm2: 45e5,
    minWidthMm: 1500,
    isMandatory: true,
    attachedToRoomId: "master_bedroom_1",
    zone: "SERVICE",
    description: "En-suite bath exclusively accessible from Master Bedroom 01"
  },
  {
    id: "bedroom_2",
    name: "Bedroom 02 (Suite)",
    type: RoomType.Bedroom,
    minAreaMm2: 115e5,
    // 11.5 m²
    targetAreaMm2: 14e6,
    minWidthMm: 3e3,
    isMandatory: true,
    zone: "PRIVATE",
    description: "Second bedroom suite with attached private bathroom"
  },
  {
    id: "attached_toilet_2",
    name: "En-suite Toilet 02",
    type: RoomType.Bathroom,
    minAreaMm2: 32e5,
    // 3.2 m²
    targetAreaMm2: 4e6,
    minWidthMm: 1400,
    isMandatory: true,
    attachedToRoomId: "bedroom_2",
    zone: "SERVICE",
    description: "En-suite bath exclusively accessible from Bedroom 02"
  },
  {
    id: "bedroom_3",
    name: "Bedroom 03",
    type: RoomType.Bedroom,
    minAreaMm2: 105e5,
    // 10.5 m²
    targetAreaMm2: 125e5,
    minWidthMm: 3e3,
    isMandatory: true,
    zone: "PRIVATE",
    description: "Third bedroom / guest room accessible from private circulation spine"
  },
  {
    id: "common_toilet",
    name: "Common Bathroom",
    type: RoomType.Bathroom,
    minAreaMm2: 28e5,
    // 2.8 m²
    targetAreaMm2: 35e5,
    minWidthMm: 1300,
    isMandatory: true,
    zone: "SERVICE",
    description: "Central common bathroom for Bedroom 03 and living area guests"
  },
  {
    id: "balcony_1",
    name: "Living Balcony",
    type: RoomType.Balcony,
    minAreaMm2: 45e5,
    // 4.5 m²
    targetAreaMm2: 6e6,
    minWidthMm: 2400,
    isMandatory: true,
    attachedToRoomId: "foyer_living_dining",
    zone: "OUTDOOR",
    description: "Main outdoor terrace balcony with clear depth >= 1200 mm (target 1570 mm)"
  }
];
var PROGRAMMATIC_4BHK_MANIFEST = [
  {
    id: "entrance_foyer",
    name: "Entrance Foyer",
    type: RoomType.Foyer,
    minAreaMm2: 35e5,
    // 3.5 m²
    targetAreaMm2: 5e6,
    minWidthMm: 1500,
    isMandatory: true,
    zone: "PUBLIC",
    description: "Dedicated formal entrance foyer buffering the main entrance from living spaces"
  },
  {
    id: "living_dining",
    name: "Grand Living & Dining Room",
    type: RoomType.Living,
    minAreaMm2: 32e6,
    // 32 m²
    targetAreaMm2: 4e7,
    minWidthMm: 3800,
    isMandatory: true,
    zone: "PUBLIC",
    description: "Expansive formal entertaining and dining salon opening onto outdoor balcony"
  },
  {
    id: "kitchen",
    name: "Kitchen",
    type: RoomType.Kitchen,
    minAreaMm2: 9e6,
    // 9 m²
    targetAreaMm2: 12e6,
    minWidthMm: 2600,
    isMandatory: true,
    zone: "SERVICE",
    description: "Large gourmet kitchen with island or parallel counter layouts"
  },
  {
    id: "utility_yard",
    name: "Service Utility Yard",
    type: RoomType.Utility,
    minAreaMm2: 3e6,
    // 3 m²
    targetAreaMm2: 45e5,
    minWidthMm: 1400,
    isMandatory: true,
    attachedToRoomId: "kitchen",
    zone: "SERVICE",
    description: "Enclosed utility yard for dishwashing, laundry, and MEP equipment"
  },
  {
    id: "master_suite_1",
    name: "Presidential Master Suite 01",
    type: RoomType.Bedroom,
    minAreaMm2: 16e6,
    // 16 m²
    targetAreaMm2: 2e7,
    minWidthMm: 3600,
    isMandatory: true,
    zone: "PRIVATE",
    description: "Primary luxury master suite with private balcony access and walk-in dressing"
  },
  {
    id: "master_dress_1",
    name: "Master Walk-in Dress 01",
    type: RoomType.Dressing,
    minAreaMm2: 35e5,
    // 3.5 m²
    targetAreaMm2: 5e6,
    minWidthMm: 1600,
    isMandatory: true,
    attachedToRoomId: "master_suite_1",
    zone: "PRIVATE",
    description: "Walk-in dressing vestibule linking master bedroom to master bath"
  },
  {
    id: "master_bath_1",
    name: "Master Luxury Bath 01",
    type: RoomType.Bathroom,
    minAreaMm2: 45e5,
    // 4.5 m²
    targetAreaMm2: 6e6,
    minWidthMm: 1600,
    isMandatory: true,
    attachedToRoomId: "master_suite_1",
    zone: "SERVICE",
    description: "4-fixture luxury bathroom with separate shower stall and dual vanity"
  },
  {
    id: "master_suite_2",
    name: "Junior Master Suite 02",
    type: RoomType.Bedroom,
    minAreaMm2: 14e6,
    // 14 m²
    targetAreaMm2: 17e6,
    minWidthMm: 3300,
    isMandatory: true,
    zone: "PRIVATE",
    description: "Secondary master bedroom suite with attached private bathroom"
  },
  {
    id: "master_bath_2",
    name: "En-suite Bath 02",
    type: RoomType.Bathroom,
    minAreaMm2: 38e5,
    // 3.8 m²
    targetAreaMm2: 48e5,
    minWidthMm: 1500,
    isMandatory: true,
    attachedToRoomId: "master_suite_2",
    zone: "SERVICE",
    description: "En-suite bath exclusively accessible from Suite 02"
  },
  {
    id: "bedroom_3",
    name: "Bedroom 03 (En-suite)",
    type: RoomType.Bedroom,
    minAreaMm2: 125e5,
    // 12.5 m²
    targetAreaMm2: 15e6,
    minWidthMm: 3e3,
    isMandatory: true,
    zone: "PRIVATE",
    description: "Third bedroom suite with attached private bathroom"
  },
  {
    id: "bath_3",
    name: "En-suite Bath 03",
    type: RoomType.Bathroom,
    minAreaMm2: 32e5,
    // 3.2 m²
    targetAreaMm2: 4e6,
    minWidthMm: 1400,
    isMandatory: true,
    attachedToRoomId: "bedroom_3",
    zone: "SERVICE",
    description: "En-suite bathroom exclusively serving Bedroom 03"
  },
  {
    id: "bedroom_4",
    name: "Bedroom 04 / Guest Suite",
    type: RoomType.Bedroom,
    minAreaMm2: 11e6,
    // 11 m²
    targetAreaMm2: 135e5,
    minWidthMm: 3e3,
    isMandatory: true,
    zone: "PRIVATE",
    description: "Fourth bedroom / home office / guest room accessible from corridor"
  },
  {
    id: "common_powder_bath",
    name: "Common Powder & Bathroom",
    type: RoomType.Bathroom,
    minAreaMm2: 28e5,
    // 2.8 m²
    targetAreaMm2: 35e5,
    minWidthMm: 1300,
    isMandatory: true,
    zone: "SERVICE",
    description: "Common powder room and guest bathroom accessible from public spine"
  },
  {
    id: "living_balcony",
    name: "Main Living Deck Balcony",
    type: RoomType.Balcony,
    minAreaMm2: 55e5,
    // 5.5 m²
    targetAreaMm2: 8e6,
    minWidthMm: 2400,
    isMandatory: true,
    attachedToRoomId: "living_dining",
    zone: "OUTDOOR",
    description: "Main living terrace deck with clear depth >= 1200 mm (target 1570 mm)"
  },
  {
    id: "master_balcony",
    name: "Master Suite Private Balcony",
    type: RoomType.Balcony,
    minAreaMm2: 45e5,
    // 4.5 m²
    targetAreaMm2: 6e6,
    minWidthMm: 2400,
    isMandatory: true,
    attachedToRoomId: "master_suite_1",
    zone: "OUTDOOR",
    description: "Private outdoor balcony for Master Suite 01 with clear depth >= 1200 mm"
  }
];
var PROGRAMMATIC_1BHK_MANIFEST = [
  {
    id: "foyer_living_dining",
    name: "Living & Dining Room",
    type: RoomType.Living,
    minAreaMm2: 18e6,
    // 18 m²
    targetAreaMm2: 22e6,
    minWidthMm: 3e3,
    isMandatory: true,
    zone: "PUBLIC",
    description: "Compact living and dining area with front daylight window"
  },
  {
    id: "kitchen",
    name: "Kitchen",
    type: RoomType.Kitchen,
    minAreaMm2: 55e5,
    // 5.5 m²
    targetAreaMm2: 7e6,
    minWidthMm: 2e3,
    isMandatory: true,
    zone: "SERVICE",
    description: "Compact kitchen with single counter and ventilation opening"
  },
  {
    id: "utility",
    name: "Kitchen Utility",
    type: RoomType.Utility,
    minAreaMm2: 18e5,
    // 1.8 m²
    targetAreaMm2: 25e5,
    minWidthMm: 1e3,
    isMandatory: true,
    attachedToRoomId: "kitchen",
    zone: "SERVICE",
    description: "Service wash balcony adjacent to kitchen"
  },
  {
    id: "bedroom",
    name: "Master Bedroom",
    type: RoomType.Bedroom,
    minAreaMm2: 105e5,
    // 10.5 m²
    targetAreaMm2: 13e6,
    minWidthMm: 2800,
    isMandatory: true,
    zone: "PRIVATE",
    description: "Standard bedroom accommodating double bed and wardrobe"
  },
  {
    id: "bathroom",
    name: "Bathroom",
    type: RoomType.Bathroom,
    minAreaMm2: 28e5,
    // 2.8 m²
    targetAreaMm2: 35e5,
    minWidthMm: 1300,
    isMandatory: true,
    zone: "SERVICE",
    description: "Combined toilet and shower room"
  },
  {
    id: "balcony",
    name: "Living Balcony",
    type: RoomType.Balcony,
    minAreaMm2: 25e5,
    // 2.5 m²
    targetAreaMm2: 35e5,
    minWidthMm: 2e3,
    isMandatory: true,
    attachedToRoomId: "foyer_living_dining",
    zone: "OUTDOOR",
    description: "Outdoor standing balcony with clear depth >= 1200 mm"
  }
];
function createDynamicApartmentManifest(input) {
  const flatsCount = input.flatsPerFloor;
  const units = input.units && input.units.length === flatsCount ? [...input.units] : Array.from({ length: flatsCount }, (_, i) => ({
    unitIndex: i + 1,
    bhkType: "3BHK",
    targetCarpetSqFt: 1100,
    attachedBathCount: 2,
    hasUtilityBalcony: true
  }));
  return {
    plotWidthMm: input.plotWidthMm,
    plotDepthMm: input.plotDepthMm,
    lotAllotmentMode: input.lotAllotmentMode ?? "STATUTORY_SETBACK_100_PERCENT",
    flatsPerFloor: flatsCount,
    units,
    jurisdiction: input.jurisdiction ?? "pune_pmc",
    northAngleDeg: input.northAngleDeg ?? 0,
    buildingTypology: input.buildingTypology ?? BuildingTypologyCategory.ResidentialApartment
  };
}

// packages/core/dist/types/rendering.js
var RenderLayer;
(function(RenderLayer2) {
  RenderLayer2["Grid"] = "grid";
  RenderLayer2["Plot"] = "plot";
  RenderLayer2["SiteZones"] = "site_zones";
  RenderLayer2["Floor"] = "floor";
  RenderLayer2["Rooms"] = "rooms";
  RenderLayer2["Walls"] = "walls";
  RenderLayer2["Openings"] = "openings";
  RenderLayer2["Stairs"] = "stairs";
  RenderLayer2["Columns"] = "columns";
  RenderLayer2["Beams"] = "beams";
  RenderLayer2["Furniture"] = "furniture";
  RenderLayer2["Annotations"] = "annotations";
  RenderLayer2["Selection"] = "selection";
  RenderLayer2["Guides"] = "guides";
})(RenderLayer || (RenderLayer = {}));

// packages/core/dist/types/design-intelligence.js
var FunctionalZone;
(function(FunctionalZone2) {
  FunctionalZone2["Public"] = "public";
  FunctionalZone2["SemiPublic"] = "semi_public";
  FunctionalZone2["Private"] = "private";
  FunctionalZone2["Service"] = "service";
  FunctionalZone2["Circulation"] = "circulation";
  FunctionalZone2["Outdoor"] = "outdoor";
})(FunctionalZone || (FunctionalZone = {}));
var AdjacencyRelationType;
(function(AdjacencyRelationType2) {
  AdjacencyRelationType2["RequiredAdjacency"] = "required_adjacency";
  AdjacencyRelationType2["PreferredAdjacency"] = "preferred_adjacency";
  AdjacencyRelationType2["RequiredSeparation"] = "required_separation";
  AdjacencyRelationType2["PrivacyBoundary"] = "privacy_boundary";
  AdjacencyRelationType2["AccessRequired"] = "access_required";
})(AdjacencyRelationType || (AdjacencyRelationType = {}));
var HumanVerificationStatus;
(function(HumanVerificationStatus2) {
  HumanVerificationStatus2["Unverified"] = "unverified";
  HumanVerificationStatus2["VerifiedArchitect"] = "verified_architect";
  HumanVerificationStatus2["VerifiedStructural"] = "verified_structural";
  HumanVerificationStatus2["ApprovedCanonical"] = "approved_canonical";
  HumanVerificationStatus2["Rejected"] = "rejected";
})(HumanVerificationStatus || (HumanVerificationStatus = {}));

// packages/core/dist/types/multi-sheet-apartment.js
var DEFAULT_SITE_AMENITIES2 = {
  securityCabin: true,
  landscapeGardenRos: true,
  childrenPlayTotLot: true,
  seniorCitizenSitout: true,
  transformerDgYard: true,
  ugwtPumpRoom: true,
  stpPlant: true,
  owcWasteYard: true,
  rainwaterHarvestingPits: true,
  evChargingBays: true
};
var DEFAULT_STILT_AMENITIES2 = {
  grandEntranceLobby: true,
  societyOffice: true,
  fitnessGymnasium: true,
  multipurposeHall: true,
  meterBmsRoom: true,
  driverStaffToilet: true
};
var DEFAULT_TERRACE_AMENITIES2 = {
  stairMumtyHeadroom: true,
  liftMachineRoom: true,
  overheadWaterTank: true,
  solarPvArray: true,
  terraceYogaDeck: true
};

// packages/core/dist/types/indian-codes.js
var CONCRETE_PROPERTIES_MAP = {
  M20: {
    grade: "M20",
    fckNPerMm2: 20,
    elasticModulusNPerMm2: Math.round(5e3 * Math.sqrt(20)),
    // 22361 N/mm²
    massDensityKgPerM3: 2500,
    poissonRatio: 0.2,
    thermalExpansionPerC: 99e-7,
    axialStrainLimit: 2e-3,
    bendingStrainLimit: 35e-4
  },
  M25: {
    grade: "M25",
    fckNPerMm2: 25,
    elasticModulusNPerMm2: Math.round(5e3 * Math.sqrt(25)),
    // 25000 N/mm²
    massDensityKgPerM3: 2500,
    poissonRatio: 0.2,
    thermalExpansionPerC: 99e-7,
    axialStrainLimit: 2e-3,
    bendingStrainLimit: 35e-4
  },
  M30: {
    grade: "M30",
    fckNPerMm2: 30,
    elasticModulusNPerMm2: Math.round(5e3 * Math.sqrt(30)),
    // 27386 N/mm²
    massDensityKgPerM3: 2500,
    poissonRatio: 0.2,
    thermalExpansionPerC: 99e-7,
    axialStrainLimit: 2e-3,
    bendingStrainLimit: 35e-4
  },
  M35: {
    grade: "M35",
    fckNPerMm2: 35,
    elasticModulusNPerMm2: Math.round(5e3 * Math.sqrt(35)),
    // 29580 N/mm²
    massDensityKgPerM3: 2500,
    poissonRatio: 0.2,
    thermalExpansionPerC: 99e-7,
    axialStrainLimit: 2e-3,
    bendingStrainLimit: 35e-4
  },
  M40: {
    grade: "M40",
    fckNPerMm2: 40,
    elasticModulusNPerMm2: Math.round(5e3 * Math.sqrt(40)),
    // 31623 N/mm²
    massDensityKgPerM3: 2500,
    poissonRatio: 0.2,
    thermalExpansionPerC: 99e-7,
    axialStrainLimit: 2e-3,
    bendingStrainLimit: 35e-4
  }
};

// packages/core/dist/models/id.js
var seed = null;
var counter = 0;
function generateId() {
  if (seed !== null) {
    counter++;
    const hex = (seed * 1e6 + counter).toString(16).padStart(12, "0");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4000-8000-${hex.padStart(12, "0").slice(0, 12)}`;
  }
  return crypto.randomUUID();
}

// packages/core/dist/models/errors.js
var DomainError = class extends Error {
  code;
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = "DomainError";
  }
};
var InvalidDimensionError = class extends DomainError {
  constructor(field, value) {
    super(`Invalid dimension for "${field}": ${value}. Must be > 0.`, "INVALID_DIMENSION");
    this.name = "InvalidDimensionError";
  }
};
var InvalidCoordinateError = class extends DomainError {
  constructor(field, value) {
    super(`Invalid coordinate for "${field}": ${value}. Must be finite.`, "INVALID_COORDINATE");
    this.name = "InvalidCoordinateError";
  }
};

// packages/core/dist/constants.js
var DEFAULTS = {
  WALL_THICKNESS_EXTERNAL: 230,
  // mm
  WALL_THICKNESS_INTERNAL: 150,
  // mm
  WALL_THICKNESS_PARTITION: 115,
  // mm
  WALL_THICKNESS_PARTY: 230,
  // mm
  WALL_THICKNESS_CORRIDOR: 150,
  // mm
  WALL_THICKNESS_SHAFT: 100,
  // mm
  FLOOR_HEIGHT: 3e3,
  // mm (floor-to-floor)
  DOOR_WIDTH: 900,
  // mm
  DOOR_WIDTH_MAIN_ENTRANCE: 1050,
  // mm
  DOOR_WIDTH_HABITABLE: 900,
  // mm
  DOOR_WIDTH_SERVICE: 750,
  // mm
  DOOR_HEIGHT: 2100,
  // mm
  BALCONY_MIN_DEPTH: 1200,
  // mm
  BALCONY_TARGET_DEPTH: 1570,
  // mm
  WINDOW_WIDTH: 1200,
  // mm
  WINDOW_HEIGHT: 1200,
  // mm
  WINDOW_SILL_HEIGHT: 900,
  // mm
  COLUMN_WIDTH: 300,
  // mm
  COLUMN_DEPTH: 300,
  // mm
  RISER_HEIGHT: 175,
  // mm
  TREAD_DEPTH: 250,
  // mm
  STAIR_WIDTH: 1e3
  // mm
};
var TOLERANCES = {
  LINEAR: 1,
  // mm — minimum meaningful distance
  AREA: 1,
  // sq mm — minimum meaningful area
  ANGULAR: 0.01,
  // degrees
  ADJACENCY: 5,
  // mm — gap below this = adjacent
  OVERLAP: 100
  // sq mm — overlap below this = rounding artifact
};
var MINIMUM_ROOM_AREAS = {
  bedroom: 95e5,
  // 9.5 sq m
  bedroom_master: 12e6,
  // 12 sq m
  kitchen: 5e6,
  // 5 sq m
  bathroom: 25e5,
  // 2.5 sq m
  living: 12e6,
  // 12 sq m
  dining: 9e6,
  // 9 sq m
  utility: 3e6,
  // 3 sq m
  dressing: 3e6,
  // 3 sq m
  foyer: 35e5,
  // 3.5 sq m
  porch: 4e6,
  // 4 sq m
  ots: 1e6
  // 1 sq m (Open to Sky shaft)
};
var MINIMUM_DIMENSIONS = {
  bedroom: 2700,
  bedroom_master: 3e3,
  kitchen: 2100,
  bathroom: 1200,
  living: 3e3,
  dining: 2700,
  utility: 1200,
  dressing: 1500,
  foyer: 1500,
  porch: 1800,
  ots: 900,
  corridor: 900,
  staircase: 900
};
var UNITS = {
  MM_PER_FOOT: 304.8,
  MM_PER_METER: 1e3,
  MM_PER_INCH: 25.4
};

// packages/core/dist/models/factory.js
function assertFinite(field, value) {
  if (!Number.isFinite(value)) {
    throw new InvalidCoordinateError(field, value);
  }
}
function assertPositive(field, value) {
  assertFinite(field, value);
  if (value <= 0) {
    throw new InvalidDimensionError(field, value);
  }
}
function rectToPolygon(x, y, width, height) {
  return {
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height }
    ]
  };
}
function defaultRoomName(type) {
  const names = {
    [RoomType.ServiceShaft]: "Service Shaft",
    [RoomType.Bedroom]: "Bedroom",
    [RoomType.Bathroom]: "Bathroom",
    [RoomType.Kitchen]: "Kitchen",
    [RoomType.Living]: "Living Room",
    [RoomType.Dining]: "Dining Room",
    [RoomType.Utility]: "Utility",
    [RoomType.Balcony]: "Balcony",
    [RoomType.Staircase]: "Staircase",
    [RoomType.Lift]: "Lift",
    [RoomType.Parking]: "Parking",
    [RoomType.Pooja]: "Pooja Room",
    [RoomType.Storage]: "Storage",
    [RoomType.Corridor]: "Corridor",
    [RoomType.Foyer]: "Foyer",
    [RoomType.Study]: "Study",
    [RoomType.ServantQuarter]: "Servant Quarter",
    [RoomType.Drawing]: "Drawing Room",
    [RoomType.FamilyLiving]: "Family Living",
    [RoomType.Terrace]: "Terrace",
    [RoomType.Garden]: "Garden",
    [RoomType.OTS]: "Open to Sky (OTS)",
    [RoomType.Porch]: "Entrance Porch",
    [RoomType.Dressing]: "Dressing Room",
    [RoomType.Custom]: "Room"
  };
  return names[type];
}
function createSite(params) {
  assertPositive("plotWidth", params.plotWidth);
  assertPositive("plotDepth", params.plotDepth);
  const setbacks = {
    front: params.setbacks?.front ?? 0,
    rear: params.setbacks?.rear ?? 0,
    left: params.setbacks?.left ?? 0,
    right: params.setbacks?.right ?? 0
  };
  const accessPoints = (params.accessPoints ?? []).map((ap) => ({
    ...ap,
    id: generateId()
  }));
  return {
    id: generateId(),
    plotBoundary: rectToPolygon(0, 0, params.plotWidth, params.plotDepth),
    plotWidth: params.plotWidth,
    plotDepth: params.plotDepth,
    plotArea: params.plotWidth * params.plotDepth,
    plotShape: params.plotShape ?? PlotShape.Rectangular,
    orientation: params.orientation ?? 0,
    setbacks,
    accessPoints,
    roadFacing: params.roadFacing ?? Direction.North,
    plannedFloorCount: params.plannedFloorCount,
    roadWidth: params.roadWidth,
    cornerPlot: params.cornerPlot ?? false,
    secondaryRoadFacing: params.secondaryRoadFacing,
    developmentControls: params.developmentControls,
    unitSystem: params.unitSystem ?? "metric",
    siteZones: params.siteZones
  };
}
function createBuilding(params) {
  const site = createSite(params.site);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const buildingId = generateId();
  const floors = (params.floors ?? []).map((fp) => createFloor({ ...fp, buildingId }));
  return {
    id: buildingId,
    projectId: params.projectId,
    name: params.name,
    site,
    floors,
    metadata: {
      projectId: params.metadata?.projectId ?? params.projectId,
      clientName: params.metadata?.clientName,
      description: params.metadata?.description,
      tags: params.metadata?.tags
    },
    version: 1,
    createdAt: now,
    updatedAt: now
  };
}
function createFloor(params) {
  return {
    id: generateId(),
    buildingId: params.buildingId,
    level: params.level,
    name: params.name ?? `Floor ${params.level}`,
    floorHeight: params.floorHeight ?? DEFAULTS.FLOOR_HEIGHT,
    boundary: params.boundary ?? { points: [] },
    rooms: [],
    walls: [],
    doors: [],
    windows: [],
    stairs: [],
    columns: [],
    ...params.furniture ? { furniture: [...params.furniture] } : {}
  };
}
function createRoom(params) {
  assertFinite("x", params.x);
  assertFinite("y", params.y);
  assertPositive("width", params.width);
  assertPositive("height", params.height);
  const area = params.width * params.height;
  const boundary = rectToPolygon(params.x, params.y, params.width, params.height);
  return {
    id: generateId(),
    floorId: params.floorId,
    type: params.type,
    name: params.name ?? defaultRoomName(params.type),
    boundary,
    x: params.x,
    y: params.y,
    width: params.width,
    height: params.height,
    rotation: params.rotation ?? 0,
    area,
    priority: params.priority ?? 5,
    tags: params.tags ?? [],
    adjacencyRequirements: params.adjacencyRequirements ?? [],
    daylightRequirement: params.daylightRequirement ?? DaylightLevel.Medium,
    privacyRequirement: params.privacyRequirement ?? PrivacyLevel.None,
    ventilationRequired: params.ventilationRequired ?? false,
    isFixed: params.isFixed ?? false
  };
}
function createWall(params) {
  assertFinite("startPoint.x", params.startPoint.x);
  assertFinite("startPoint.y", params.startPoint.y);
  assertFinite("endPoint.x", params.endPoint.x);
  assertFinite("endPoint.y", params.endPoint.y);
  const wallType = params.type ?? WallType.Internal;
  const defaultThickness = wallType === WallType.External ? DEFAULTS.WALL_THICKNESS_EXTERNAL : wallType === WallType.Partition ? DEFAULTS.WALL_THICKNESS_PARTITION : DEFAULTS.WALL_THICKNESS_INTERNAL;
  return {
    id: generateId(),
    floorId: params.floorId,
    startPoint: params.startPoint,
    endPoint: params.endPoint,
    thickness: params.thickness ?? defaultThickness,
    type: wallType,
    material: params.material,
    roomIds: params.roomIds ?? [],
    hasOpening: false,
    loadBearing: params.loadBearing ?? false
  };
}

// packages/core/dist/models/opening-migration.js
var OpeningMigrationError = class extends Error {
  openingId;
  constructor(openingId, message) {
    super(`${openingId}: ${message}`);
    this.openingId = openingId;
  }
};
function migrateOpeningGeometry(building, evidence = {}) {
  const ids = building.floors.flatMap((f) => [...f.doors, ...f.windows].map((o) => o.id));
  if (new Set(ids).size !== ids.length)
    throw new OpeningMigrationError("building", "DUPLICATE_OPENING_ID");
  const migrate = (opening, floor) => {
    const wall = floor.walls.find((w) => w.id === opening.wallId);
    if (!wall)
      throw new OpeningMigrationError(opening.id, "MISSING_HOST: restore the original host wall");
    const dx = wall.endPoint.x - wall.startPoint.x, dy = wall.endPoint.y - wall.startPoint.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0) || !Number.isFinite(length))
      throw new OpeningMigrationError(opening.id, "INVALID_HOST");
    const tagged = opening.openingGeometryVersion === 1 && opening.positionReference === "CENTER";
    if ((opening.openingGeometryVersion !== void 0 || opening.positionReference !== void 0) && !tagged)
      throw new OpeningMigrationError(opening.id, "UNKNOWN_GEOMETRY_VERSION");
    const reference = tagged ? "CENTER" : evidence[opening.id];
    if (reference !== void 0 && reference !== "START" && reference !== "CENTER")
      throw new OpeningMigrationError(opening.id, "INVALID_REFERENCE_EVIDENCE");
    if (opening.floorId !== floor.id)
      throw new OpeningMigrationError(opening.id, "FLOOR_ID_MISMATCH");
    if (!reference)
      throw new OpeningMigrationError(opening.id, "AMBIGUOUS_LEGACY_REFERENCE: provide producer/version evidence for CENTER or START; original data was not changed");
    const shift = reference === "START" ? opening.width / 2 : 0;
    const position = { x: opening.position.x + dx / length * shift, y: opening.position.y + dy / length * shift };
    const x = position.x - wall.startPoint.x, y = position.y - wall.startPoint.y;
    const along = (x * dx + y * dy) / length;
    if (![position.x, position.y, opening.width, opening.height].every(Number.isFinite) || opening.width <= 0 || opening.height <= 0 || Math.abs(x * dy - y * dx) / length > 1e-3 || along - opening.width / 2 < -1e-3 || along + opening.width / 2 > length + 1e-3)
      throw new OpeningMigrationError(opening.id, "INVALID_OPENING_INTERVAL");
    return { ...opening, position, openingGeometryVersion: 1, positionReference: "CENTER" };
  };
  return { ...building, floors: building.floors.map((f) => ({ ...f, doors: f.doors.map((o) => migrate(o, f)), windows: f.windows.map((o) => migrate(o, f)) })) };
}

// packages/core/dist/models/architectural-semantics.js
function architecturalSpaceRole(r) {
  if (r.architecturalRole)
    return r.architecturalRole;
  if (r.spaceUse === "VOID" || r.type === "ots")
    return "OPEN_TO_SKY_VOID";
  if (r.type === "service_shaft")
    return "SERVICE_SHAFT";
  if (r.type === "staircase")
    return "STAIR_ENCLOSURE";
  if (r.type === "lift")
    return "LIFT_SHAFT";
  if (r.type === "balcony" || r.type === "utility" && r.spaceUse === "OUTDOOR")
    return "BALCONY_SLAB";
  if (r.type === "terrace")
    return "OPEN_TERRACE";
  if (r.type === "corridor" || r.type === "foyer" || r.type === "garden" || r.type === "porch")
    return "OPEN_CIRCULATION";
  if (r.type === "parking")
    return r.tags.some((t) => /driveway|circulation/i.test(t)) ? "VEHICLE_AISLE" : "PARKING_BAY";
  return [
    "bedroom",
    "living",
    "dining",
    "study",
    "drawing",
    "family_living"
  ].includes(r.type) ? "ENCLOSED_HABITABLE" : "ENCLOSED_SERVICE";
}
function requiresEnclosure(role) {
  return [
    "ENCLOSED_HABITABLE",
    "ENCLOSED_SERVICE",
    "STAIR_ENCLOSURE",
    "PROTECTED_STAIR_ENCLOSURE",
    "STAIR_MUMTY",
    "LIFT_SHAFT",
    "SERVICE_SHAFT",
    "LIFT_EQUIPMENT"
  ].includes(role);
}
function architecturalBoundaryRole(owners, exterior) {
  if (owners.some((r) => requiresEnclosure(architecturalSpaceRole(r))))
    return "FULL_HEIGHT_WALL";
  if (owners.some((r) => architecturalSpaceRole(r) === "OPEN_TO_SKY_VOID"))
    return "PARAPET";
  if (exterior && owners.some((r) => [
    "BALCONY_SLAB",
    "OPEN_TERRACE",
    "ROOF_EQUIPMENT_ZONE",
    "OPEN_TO_SKY_VOID"
  ].includes(architecturalSpaceRole(r))))
    return "PARAPET";
  return "OPEN_BOUNDARY";
}
var isPhysicalBoundary = (w) => w.boundaryRole !== "OPEN_BOUNDARY";
function architecturalWallHeight(w, fullHeight) {
  if (w.boundaryRole === "OPEN_BOUNDARY")
    return 0;
  if (w.heightMm !== void 0)
    return w.heightMm;
  return w.wallUse === "PARAPET" || w.boundaryRole === "PARAPET" || w.boundaryRole === "GUARDRAIL" ? 1100 : fullHeight;
}
function withArchitecturalElements(building) {
  return {
    ...building,
    floors: building.floors.map((f) => {
      const elements = [];
      const add = (role, collection, id, part) => elements.push({
        id: `${id}:architecture:${part ?? role}`,
        floorId: f.id,
        role,
        source: { collection, id, ...part ? { part } : {} },
        reviewStatus: "DESIGN_PROPOSAL"
      });
      f.rooms.forEach((r) => add(architecturalSpaceRole(r), "rooms", r.id));
      f.walls.forEach((w) => add(w.boundaryRole ?? "FULL_HEIGHT_WALL", "walls", w.id));
      f.doors.forEach((o) => add("DOOR_OPENING", "doors", o.id));
      f.windows.forEach((o) => add("WINDOW_OPENING", "windows", o.id));
      (f.canonicalStaircases ?? []).forEach((s) => {
        add("STAIR_FLIGHT", "canonicalStaircases", s.id, "flight1");
        add("STAIR_FLIGHT", "canonicalStaircases", s.id, "flight2");
        add("STAIR_LANDING", "canonicalStaircases", s.id, "midLanding");
        if (s.floorLanding)
          add("STAIR_LANDING", "canonicalStaircases", s.id, "floorLanding");
      });
      if (f.floorUse === "ROOF")
        add("OPEN_TERRACE", "floor", f.id);
      return {
        ...f,
        architecture: {
          schemaVersion: 1,
          elements,
          drainage: f.architecture?.drainage ?? {
            status: "NOT_VERIFIED"
          },
          statutoryStatus: "NOT_VERIFIED"
        }
      };
    })
  };
}
function architecturalModelErrors(building) {
  const errors = [];
  for (const f of building.floors) {
    for (const w of f.walls) {
      if (w.boundaryRole !== void 0 && !["FULL_HEIGHT_WALL", "PARAPET", "GUARDRAIL", "OPEN_BOUNDARY"].includes(w.boundaryRole))
        errors.push(`${w.id}: unsupported boundary role`);
      if (w.heightMm !== void 0 && (!Number.isFinite(w.heightMm) || w.heightMm < 0))
        errors.push(`${w.id}: invalid boundary height`);
    }
    if (!f.architecture)
      continue;
    if (f.architecture.schemaVersion !== 1)
      errors.push(`${f.id}: unsupported architectural schema`);
    for (const w of f.walls) {
      const h = architecturalWallHeight(w, f.floorHeight);
      if (h > f.floorHeight)
        errors.push(`${w.id}: boundary exceeds floor height`);
      if (!Number.isFinite(h) || h < 0 || w.boundaryRole !== "OPEN_BOUNDARY" && h <= 0)
        errors.push(`${w.id}: invalid boundary height`);
      if (w.boundaryRole === "OPEN_BOUNDARY" && f.doors.some((d) => d.wallId === w.id && d.type !== "open_passage"))
        errors.push(`${w.id}: a door leaf cannot be hosted by an open boundary`);
      if (w.boundaryRole && w.boundaryRole !== "FULL_HEIGHT_WALL" && f.windows.some((d) => d.wallId === w.id))
        errors.push(`${w.id}: window requires full-height wall`);
    }
    for (const e of f.architecture.elements) {
      const collection = e.source.collection === "floor" ? [f] : f[e.source.collection] ?? [];
      if (e.floorId !== f.id || !collection.some((o) => o.id === e.source.id))
        errors.push(`${e.id}: unresolved canonical source`);
    }
    if (new Set(f.architecture.elements.map((e) => e.id)).size !== f.architecture.elements.length)
      errors.push(`${f.id}: duplicate architectural identity`);
  }
  return errors;
}

// packages/core/dist/mep/mep-validation.js
function mepSchemaErrors(building) {
  const b = building;
  if (!b || b.mep === void 0)
    return [];
  const m = b.mep, e = [];
  if (!m || !Array.isArray(m.fixtures) || !Array.isArray(m.shafts) || !Array.isArray(m.stacks) || !Array.isArray(m.issues))
    return ["MEP arrays are required"];
  if (m.status !== "PROPOSED_REQUIRES_REVIEW" || m.hydraulicDesign !== "NOT_VERIFIED" || m.electricalDesign !== "NOT_VERIFIED" || m.fireCoverage !== "NOT_VERIFIED")
    e.push("MEP professional status must remain unverified");
  if (!Number.isInteger(m.sourceRevision) || typeof m.sourceArchitectureHash !== "string")
    e.push("MEP source revision/hash required");
  const ids = /* @__PURE__ */ new Set(), floorIds = new Set(b.floors?.map((f) => f.id));
  const claim = (id) => {
    if (!id || ids.has(id))
      e.push("Missing or duplicate MEP id");
    ids.add(id);
  };
  const finite = (n) => typeof n === "number" && Number.isFinite(n);
  const positive = (n) => finite(n) && n > 0;
  const types = {
    ELECTRICAL: ["SWITCHBOARD_PRIMARY", "SWITCHBOARD_SECONDARY", "SOCKET_16A_POWER", "SOCKET_6A", "DISTRIBUTION_BOARD", "CEILING_LIGHT", "CEILING_FAN"],
    PLUMBING: ["WC_DRAIN", "KITCHEN_SINK_DRAIN", "KITCHEN_SINK_SUPPLY", "WASHBASIN_DRAIN", "WASHBASIN_SUPPLY"],
    FIRE: ["PENDENT_SPRINKLER", "SMOKE_DETECTOR", "ABC_6KG_EXTINGUISHER", "LANDING_VALVE"]
  };
  for (const f of m.fixtures) {
    if (!f || typeof f !== "object") {
      e.push("Invalid MEP fixture");
      continue;
    }
    claim(f.id);
    if (!floorIds.has(f.floorId) || !types[f.kind]?.includes(f.type) || !["WALL", "CEILING", "CONNECTION"].includes(f.mounting) || ![f.position?.x, f.position?.y, f.rotationRad, f.elevationAfflMm].every(finite) || f.elevationAfflMm < 0 || ![f.widthMm, f.depthMm, f.heightMm].every(positive) || !["ASSERTED_FROM_BRIEF", "VISUALIZATION_DEFAULT"].includes(f.provenance))
      e.push("Invalid MEP fixture " + f.id);
    const floor = b.floors?.find((x) => x.id === f.floorId);
    if (!floor?.rooms.some((r) => r.id === f.roomId) || f.hostWallId && !floor.walls.some((w) => w.id === f.hostWallId))
      e.push("Unknown MEP host " + f.id);
  }
  for (const s of m.shafts) {
    if (!s || !Array.isArray(s.floors)) {
      e.push("Invalid shaft");
      continue;
    }
    claim(s.id);
    if (!["OTS_SHAFT", "PLUMBING_CHASE", "FIRE_RISER"].includes(s.type) || s.enclosureWallThicknessMm !== 100)
      e.push("Invalid shaft classification");
    for (const f of s.floors)
      if (!f || !floorIds.has(f.floorId) || !Array.isArray(f.boundary?.points) || f.boundary.points.length < 3 || !f.boundary.points.every((p) => p && finite(p.x) && finite(p.y)))
        e.push("Invalid shaft polygon");
  }
  for (const s of m.stacks) {
    if (!s) {
      e.push("Invalid stack");
      continue;
    }
    claim(s.id);
    if (!m.shafts.some((h) => h?.id === s.shaftId) || !Array.isArray(s.floorIds) || !s.floorIds.length || !s.floorIds.every((id) => floorIds.has(id)) || !["SOIL", "WASTE", "VENT", "RAINWATER", "WET_RISER"].includes(s.service) || !positive(s.outerDiameterMm) || ![s.position?.x, s.position?.y, s.bottomMm, s.topMm].every(finite) || s.topMm <= s.bottomMm)
      e.push("Invalid MEP stack " + s.id);
  }
  return e;
}

// packages/core/dist/models/validation.js
function isString(v) {
  return typeof v === "string";
}
function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}
function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function isPositiveNumber(v) {
  return isFiniteNumber(v) && v > 0;
}
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isArray(v) {
  return Array.isArray(v);
}
var VALID_ROOM_TYPES = new Set(Object.values(RoomType));
function validatePoint(value, path2, errors) {
  if (!isObject(value)) {
    errors.push({ path: path2, message: "Must be an object with x and y", value });
    return;
  }
  if (!isFiniteNumber(value["x"])) {
    errors.push({ path: `${path2}.x`, message: "Must be a finite number", value: value["x"] });
  }
  if (!isFiniteNumber(value["y"])) {
    errors.push({ path: `${path2}.y`, message: "Must be a finite number", value: value["y"] });
  }
}
function validatePolygon(value, path2, errors) {
  if (!isObject(value)) {
    errors.push({ path: path2, message: "Must be an object with points array", value });
    return;
  }
  const points = value["points"];
  if (!isArray(points)) {
    errors.push({ path: `${path2}.points`, message: "Must be an array", value: points });
    return;
  }
  if (points.length < 3) {
    errors.push({ path: `${path2}.points`, message: "Must have at least 3 points", value: points.length });
  }
  for (let i = 0; i < points.length; i++) {
    validatePoint(points[i], `${path2}.points[${i}]`, errors);
  }
}
function validateBuildingSchema(building) {
  const errors = [];
  if (!isObject(building)) {
    errors.push({ path: "", message: "Building must be an object", value: building });
    return errors;
  }
  if (building["regulatoryContext"] !== void 0)
    errors.push(...validateRegulatoryContextSchema(building["regulatoryContext"]));
  if (!isNonEmptyString(building["id"])) {
    errors.push({ path: "id", message: "Must be a non-empty string", value: building["id"] });
  }
  if (!isNonEmptyString(building["projectId"])) {
    errors.push({ path: "projectId", message: "Must be a non-empty string", value: building["projectId"] });
  }
  if (!isString(building["name"])) {
    errors.push({ path: "name", message: "Must be a string", value: building["name"] });
  }
  const site = building["site"];
  if (!isObject(site)) {
    errors.push({ path: "site", message: "Must be an object", value: site });
  } else {
    if (!isNonEmptyString(site["id"])) {
      errors.push({ path: "site.id", message: "Must be a non-empty string", value: site["id"] });
    }
    if (!isPositiveNumber(site["plotWidth"])) {
      errors.push({ path: "site.plotWidth", message: "Must be a positive number", value: site["plotWidth"] });
    }
    if (!isPositiveNumber(site["plotDepth"])) {
      errors.push({ path: "site.plotDepth", message: "Must be a positive number", value: site["plotDepth"] });
    }
    if (isObject(site["plotBoundary"])) {
      validatePolygon(site["plotBoundary"], "site.plotBoundary", errors);
    }
  }
  const floors = building["floors"];
  if (!isArray(floors)) {
    errors.push({ path: "floors", message: "Must be an array", value: floors });
  } else {
    const floorIds = /* @__PURE__ */ new Set();
    const floorLevels = /* @__PURE__ */ new Set();
    const entityIds = /* @__PURE__ */ new Set();
    for (let fi = 0; fi < floors.length; fi++) {
      const floor = floors[fi];
      const fp = `floors[${fi}]`;
      if (!isObject(floor)) {
        errors.push({ path: fp, message: "Must be an object", value: floor });
        continue;
      }
      if (!isNonEmptyString(floor["id"])) {
        errors.push({ path: `${fp}.id`, message: "Must be a non-empty string", value: floor["id"] });
      } else {
        const floorId = floor["id"];
        if (floorIds.has(floorId)) {
          errors.push({ path: `${fp}.id`, message: `Duplicate floor id "${floorId}"`, value: floorId });
        }
        floorIds.add(floorId);
      }
      if (!isNonEmptyString(floor["buildingId"])) {
        errors.push({ path: `${fp}.buildingId`, message: "Must be a non-empty string", value: floor["buildingId"] });
      } else if (isNonEmptyString(building["id"]) && floor["buildingId"] !== building["id"]) {
        errors.push({
          path: `${fp}.buildingId`,
          message: `Floor buildingId "${floor["buildingId"]}" does not match building id "${building["id"]}"`,
          value: floor["buildingId"]
        });
      }
      if (!isFiniteNumber(floor["level"])) {
        errors.push({ path: `${fp}.level`, message: "Must be a finite number", value: floor["level"] });
      } else {
        const level = floor["level"];
        if (floorLevels.has(level)) {
          errors.push({ path: `${fp}.level`, message: `Duplicate floor level ${level}`, value: level });
        }
        floorLevels.add(level);
      }
      const rooms = floor["rooms"];
      if (!isArray(rooms)) {
        errors.push({ path: `${fp}.rooms`, message: "Must be an array", value: rooms });
      } else {
        for (let ri = 0; ri < rooms.length; ri++) {
          const room = rooms[ri];
          const rp = `${fp}.rooms[${ri}]`;
          if (!isObject(room)) {
            errors.push({ path: rp, message: "Must be an object", value: room });
            continue;
          }
          if (!isNonEmptyString(room["id"])) {
            errors.push({ path: `${rp}.id`, message: "Must be a non-empty string", value: room["id"] });
          } else if (entityIds.has(room["id"])) {
            errors.push({ path: `${rp}.id`, message: `Duplicate entity id "${room["id"]}"`, value: room["id"] });
          } else {
            entityIds.add(room["id"]);
          }
          if (!isString(room["type"]) || !VALID_ROOM_TYPES.has(room["type"])) {
            errors.push({ path: `${rp}.type`, message: "Must be a valid RoomType", value: room["type"] });
          }
          if (!isPositiveNumber(room["width"])) {
            errors.push({ path: `${rp}.width`, message: "Must be a positive number", value: room["width"] });
          }
          if (!isPositiveNumber(room["height"])) {
            errors.push({ path: `${rp}.height`, message: "Must be a positive number", value: room["height"] });
          }
          if (!isFiniteNumber(room["x"])) {
            errors.push({ path: `${rp}.x`, message: "Must be a finite number", value: room["x"] });
          }
          if (!isFiniteNumber(room["y"])) {
            errors.push({ path: `${rp}.y`, message: "Must be a finite number", value: room["y"] });
          }
          if (isPositiveNumber(room["width"]) && isPositiveNumber(room["height"]) && isFiniteNumber(room["area"])) {
            const expected = room["width"] * room["height"];
            if (Math.abs(room["area"] - expected) > 1) {
              errors.push({
                path: `${rp}.area`,
                message: `Area mismatch: expected ${expected}, got ${room["area"]}`,
                value: room["area"]
              });
            }
          }
          if (isObject(room["boundary"])) {
            validatePolygon(room["boundary"], `${rp}.boundary`, errors);
          }
          if (isNonEmptyString(room["floorId"]) && isNonEmptyString(floor["id"])) {
            if (room["floorId"] !== floor["id"]) {
              errors.push({
                path: `${rp}.floorId`,
                message: `Room floorId "${room["floorId"]}" does not match parent floor id "${floor["id"]}"`,
                value: room["floorId"]
              });
            }
          }
        }
      }
      if (!isArray(floor["walls"])) {
        errors.push({ path: `${fp}.walls`, message: "Must be an array", value: floor["walls"] });
      }
      if (!isArray(floor["doors"])) {
        errors.push({ path: `${fp}.doors`, message: "Must be an array", value: floor["doors"] });
      }
      if (!isArray(floor["windows"])) {
        errors.push({ path: `${fp}.windows`, message: "Must be an array", value: floor["windows"] });
      }
      if (!isArray(floor["stairs"])) {
        errors.push({ path: `${fp}.stairs`, message: "Must be an array", value: floor["stairs"] });
      }
      if (!isArray(floor["columns"])) {
        errors.push({ path: `${fp}.columns`, message: "Must be an array", value: floor["columns"] });
      }
      const parentFloorId = isNonEmptyString(floor["id"]) ? floor["id"] : void 0;
      const entityCollections = [
        ["walls", isArray(floor["walls"]) ? floor["walls"] : []],
        ["doors", isArray(floor["doors"]) ? floor["doors"] : []],
        ["windows", isArray(floor["windows"]) ? floor["windows"] : []],
        ["stairs", isArray(floor["stairs"]) ? floor["stairs"] : []],
        ["columns", isArray(floor["columns"]) ? floor["columns"] : []]
      ];
      for (const [collectionName, entities] of entityCollections) {
        for (let entityIndex = 0; entityIndex < entities.length; entityIndex++) {
          const entity = entities[entityIndex];
          const ep = `${fp}.${collectionName}[${entityIndex}]`;
          if (!isObject(entity)) {
            errors.push({ path: ep, message: "Must be an object", value: entity });
            continue;
          }
          if (!isNonEmptyString(entity["id"])) {
            errors.push({ path: `${ep}.id`, message: "Must be a non-empty string", value: entity["id"] });
          } else if (entityIds.has(entity["id"])) {
            errors.push({ path: `${ep}.id`, message: `Duplicate entity id "${entity["id"]}"`, value: entity["id"] });
          } else {
            entityIds.add(entity["id"]);
          }
          if (isNonEmptyString(entity["floorId"]) && parentFloorId && entity["floorId"] !== parentFloorId) {
            errors.push({
              path: `${ep}.floorId`,
              message: `${collectionName.slice(0, -1)} floorId "${entity["floorId"]}" does not match parent floor id "${parentFloorId}"`,
              value: entity["floorId"]
            });
          }
        }
      }
    }
  }
  try {
    if (Array.isArray(building["floors"]))
      for (const message of architecturalModelErrors(building))
        errors.push({ path: "architecture", message, value: building["floors"] });
  } catch {
    errors.push({ path: "architecture", message: "Malformed architectural model", value: building["floors"] });
  }
  for (const message of mepSchemaErrors(building))
    errors.push({ path: "mep", message, value: building["mep"] });
  if (!isFiniteNumber(building["version"])) {
    errors.push({ path: "version", message: "Must be a finite number", value: building["version"] });
  }
  return errors;
}
function validateRegulatoryContextSchema(input) {
  const errors = [];
  const fail = (key2, value) => errors.push({ path: `regulatoryContext.${key2}`, value, message: "Invalid explicit regulatory input" });
  if (!isObject(input)) {
    fail("", input);
    return errors;
  }
  const enums = { authorityType: ["MUNICIPAL_CORPORATION", "MUNICIPAL_COUNCIL", "REGIONAL_PLAN"], congestionZone: ["NON_CONGESTED", "CONGESTED"], buildingUsage: ["RESIDENTIAL_APARTMENT"], corporationClass: ["A", "B", "C", "D"], parkingFactorCategory: ["PUNE_PCMC_THANE", "NAGPUR_NASHIK", "OTHER_MMR", "OTHER_CORPORATION", "D_CORPORATION", "A_COUNCIL", "BC_COUNCIL"], rosApplicability: ["REQUIRED", "EXEMPT_APPROVED_LAYOUT"], drivewayFlow: ["ONE_WAY", "TWO_WAY"] };
  for (const [k, values] of Object.entries(enums))
    if (input[k] !== void 0 && !values.includes(input[k]))
      fail(k, input[k]);
  for (const k of ["parkingFloorHeightM", "plotAreaSqm", "roadWidthM", "buildingHeightM", "numFloors", "originalHoldingAreaSqm", "netPlotAreaSqm", "approvedPremiumFsi", "approvedTdrFsi", "approvedAncillaryFsi"])
    if (input[k] !== void 0 && (!isFiniteNumber(input[k]) || input[k] < 0))
      fail(k, input[k]);
  for (const k of ["roofFsiReviewed", "stiltParkingEnabled", "standardGreenfieldSchemeConfirmed", "amendmentApplicabilityReviewed", "fsiExemptionsReviewed"])
    if (input[k] !== void 0 && typeof input[k] !== "boolean")
      fail(k, input[k]);
  if (input["numFloors"] !== void 0 && !Number.isInteger(input["numFloors"]))
    fail("numFloors", input["numFloors"]);
  if (input["reviewedFsiExemptions"] !== void 0) {
    const v = input["reviewedFsiExemptions"];
    if (!Array.isArray(v) || v.some((e) => !isObject(e) || !isNonEmptyString(e["floorId"]) || !isNonEmptyString(e["clause"]) || !isFiniteNumber(e["areaMm2"]) || e["areaMm2"] < 0))
      fail("reviewedFsiExemptions", v);
  }
  return errors;
}

// packages/core/dist/models/requirements-normalization.js
var ROOM_TYPES = new Set(Object.values(RoomType));
var DIRECTIONS = new Set(Object.values(Direction));
var PLOT_SHAPES = new Set(Object.values(PlotShape));
var PREFERENCE_LEVELS = new Set(Object.values(PreferenceLevel));

// packages/core/dist/capabilities.js
var BUILDING_CAPABILITIES = Object.freeze({
  minimumFloorCount: 1,
  maximumFloorCount: 10
});
var SUPPORTED_FLOOR_COUNTS = Object.freeze(Array.from({ length: BUILDING_CAPABILITIES.maximumFloorCount }, (_, index) => index + BUILDING_CAPABILITIES.minimumFloorCount));

// packages/core/dist/models/space-catalog.js
var M2 = 1e6;
var R = ["residential", "mixed_use"];
var C = ["commercial", "mixed_use"];
var E = ["educational"];
function definition(id, displayName, categories, group, zone, minimumM2, preferredM2, options = {}) {
  const occupancy = options.occupancy ?? (categories[0] === "educational" ? "educational" : categories[0] === "commercial" ? "commercial" : "residential");
  return {
    id,
    displayName,
    categories,
    group,
    zone,
    occupancy,
    canonicalType: options.canonicalType,
    synonyms: options.synonyms ?? [],
    defaultQuantity: options.quantity ?? 1,
    minimumAreaMm2: minimumM2 * M2,
    preferredAreaMm2: preferredM2 * M2,
    maximumAreaMm2: options.max ? options.max * M2 : void 0,
    defaultPriority: options.priority ?? "preferred",
    defaultFloorPreference: options.floor ?? "any",
    generatorSupport: options.support ?? "program_only",
    tags: options.tags ?? [],
    relationships: options.relationships
  };
}
var residential = [
  definition("primary_bedroom", "Primary Bedroom", R, "private", FunctionalZone.Private, 12, 16, { max: 22, canonicalType: RoomType.Bedroom, support: "supported", priority: "required", floor: "upper_preferred", synonyms: ["master bedroom", "owner bedroom"] }),
  definition("bedroom", "Bedroom", R, "private", FunctionalZone.Private, 9.5, 13, { max: 18, canonicalType: RoomType.Bedroom, support: "supported", quantity: 2, priority: "required", floor: "upper_preferred", synonyms: ["bed room", "kids room"] }),
  definition("guest_bedroom", "Guest Bedroom", R, "private", FunctionalZone.Private, 9.5, 13, { max: 18, canonicalType: RoomType.Bedroom, support: "supported", floor: "ground_preferred", synonyms: ["guest room"] }),
  definition("children_bedroom", "Children Bedroom", R, "private", FunctionalZone.Private, 9.5, 12, { max: 16, canonicalType: RoomType.Bedroom, support: "supported", floor: "upper_preferred", synonyms: ["child room", "kids bedroom"] }),
  definition("study", "Study / Home Office", R, "private", FunctionalZone.Private, 6, 9, { max: 14, canonicalType: RoomType.Study, support: "supported", synonyms: ["office", "home office"] }),
  definition("dressing", "Dressing / Walk-in Closet", R, "private", FunctionalZone.Private, 3, 5, { max: 8, synonyms: ["closet", "wardrobe"] }),
  definition("primary_bathroom", "Primary Bathroom", R, "baths", FunctionalZone.Service, 3, 4.5, { max: 7, canonicalType: RoomType.Bathroom, support: "supported", priority: "required", floor: "upper_preferred", synonyms: ["master bath", "ensuite"] }),
  definition("attached_bathroom", "Attached Bathroom", R, "baths", FunctionalZone.Service, 2.5, 4, { max: 6, canonicalType: RoomType.Bathroom, support: "supported", synonyms: ["ensuite bathroom"] }),
  definition("common_bathroom", "Common Bathroom", R, "baths", FunctionalZone.Service, 2.5, 4, { max: 6, canonicalType: RoomType.Bathroom, support: "supported", priority: "required", synonyms: ["washroom", "toilet"] }),
  definition("powder_room", "Powder Room", R, "baths", FunctionalZone.Service, 1.8, 2.5, { max: 4, canonicalType: RoomType.Bathroom, support: "supported", synonyms: ["guest toilet", "half bath"] }),
  definition("living", "Living Room", R, "living", FunctionalZone.Public, 12, 18, { max: 26, canonicalType: RoomType.Living, support: "supported", priority: "required", floor: "ground_required", synonyms: ["lounge", "drawing room"] }),
  definition("family_lounge", "Family Lounge", R, "living", FunctionalZone.SemiPublic, 10, 15, { max: 22, canonicalType: RoomType.FamilyLiving, support: "program_only", floor: "upper_preferred", synonyms: ["family living"] }),
  definition("dining", "Dining", R, "living", FunctionalZone.SemiPublic, 8, 12, { max: 18, canonicalType: RoomType.Dining, support: "supported", priority: "required", floor: "ground_preferred", relationships: [{ targetDefinitionId: "kitchen", strength: AdjacencyStrength.Preferred, reason: "Short food-service path" }] }),
  definition("breakfast", "Breakfast / Informal Dining", R, "living", FunctionalZone.SemiPublic, 5, 8, { max: 12, synonyms: ["breakfast nook"] }),
  definition("kitchen", "Kitchen", R, "service", FunctionalZone.Service, 5.5, 9, { max: 14, canonicalType: RoomType.Kitchen, support: "supported", priority: "required", floor: "ground_preferred", relationships: [{ targetDefinitionId: "dining", strength: AdjacencyStrength.Preferred, reason: "Short food-service path" }, { targetDefinitionId: "utility", strength: AdjacencyStrength.Preferred, reason: "Connected service workflow" }] }),
  definition("pantry", "Pantry", R, "service", FunctionalZone.Service, 2, 3.5, { max: 6, synonyms: ["food store"] }),
  definition("utility", "Utility", R, "service", FunctionalZone.Service, 3, 5, { max: 8, canonicalType: RoomType.Utility, support: "supported", floor: "ground_preferred" }),
  definition("store", "Store", R, "service", FunctionalZone.Service, 2, 4, { max: 7, canonicalType: RoomType.Storage, support: "program_only", synonyms: ["storage"] }),
  definition("laundry", "Laundry", R, "service", FunctionalZone.Service, 3, 5, { max: 8 }),
  definition("pooja", "Pooja Room", R, "special", FunctionalZone.Private, 2, 3.5, { max: 6, canonicalType: RoomType.Pooja, support: "supported", synonyms: ["prayer room", "puja"] }),
  definition("foyer", "Entrance / Foyer", R, "circulation", FunctionalZone.Public, 3, 5, { max: 9, canonicalType: RoomType.Foyer, support: "program_only", floor: "ground_required", synonyms: ["entry", "entrance"] }),
  definition("corridor", "Hall / Passage", R, "circulation", FunctionalZone.Circulation, 3, 6, { max: 12, canonicalType: RoomType.Corridor, support: "program_only", synonyms: ["hallway"] }),
  definition("staircase", "Staircase", R, "circulation", FunctionalZone.Circulation, 5, 7.5, { max: 12, canonicalType: RoomType.Staircase, support: "supported", priority: "required", floor: "ground_required", synonyms: ["stairs"] }),
  definition("lift", "Lift", R, "circulation", FunctionalZone.Circulation, 4, 5, { max: 7, canonicalType: RoomType.Lift, support: "supported", synonyms: ["elevator"] }),
  definition("balcony", "Balcony", R, "outdoor", FunctionalZone.Outdoor, 3, 5, { max: 9, canonicalType: RoomType.Balcony, support: "supported", floor: "upper_preferred" }),
  definition("terrace", "Terrace", R, "outdoor", FunctionalZone.Outdoor, 8, 14, { max: 30, canonicalType: RoomType.Terrace, support: "program_only", floor: "top_preferred", synonyms: ["roof terrace"] }),
  definition("sit_out", "Sit-out", R, "outdoor", FunctionalZone.Outdoor, 4, 7, { max: 12, synonyms: ["veranda"] }),
  definition("porch", "Porch", R, "outdoor", FunctionalZone.Outdoor, 5, 8, { max: 14, floor: "ground_required" }),
  definition("car_parking", "Car Parking", R, "vehicle", FunctionalZone.Outdoor, 14, 15, { max: 20, canonicalType: RoomType.Parking, support: "supported", priority: "required", floor: "ground_required", synonyms: ["car", "parking bay"] }),
  definition("two_wheeler_parking", "Two-Wheeler Parking", R, "vehicle", FunctionalZone.Outdoor, 3, 5, { max: 8, synonyms: ["bike parking", "scooter parking"] }),
  definition("garage", "Garage", R, "vehicle", FunctionalZone.Outdoor, 16, 20, { max: 28, canonicalType: RoomType.Parking, support: "supported", floor: "ground_required" })
];
var commercial = [
  definition("reception", "Reception", C, "work", FunctionalZone.Public, 8, 14, { occupancy: "commercial", priority: "required", floor: "ground_required", synonyms: ["front desk"] }),
  definition("retail", "Retail Area", C, "work", FunctionalZone.Public, 25, 45, { occupancy: "commercial", floor: "ground_required", synonyms: ["shop", "storefront"] }),
  definition("open_office", "Open Office", C, "work", FunctionalZone.SemiPublic, 30, 55, { occupancy: "commercial", priority: "required", synonyms: ["workstations", "office floor"] }),
  definition("private_cabin", "Private Cabin", C, "work", FunctionalZone.Private, 8, 12, { occupancy: "commercial", quantity: 2, synonyms: ["office cabin"] }),
  definition("manager_cabin", "Manager Cabin", C, "work", FunctionalZone.Private, 10, 15, { occupancy: "commercial" }),
  definition("conference", "Conference Room", C, "work", FunctionalZone.SemiPublic, 15, 24, { occupancy: "commercial", synonyms: ["board room"] }),
  definition("meeting", "Meeting Room", C, "work", FunctionalZone.SemiPublic, 8, 14, { occupancy: "commercial" }),
  definition("waiting", "Waiting Area", C, "living", FunctionalZone.Public, 8, 15, { occupancy: "commercial" }),
  definition("commercial_pantry", "Pantry", C, "service", FunctionalZone.Service, 4, 7, { occupancy: "commercial" }),
  definition("staff_dining", "Staff Dining", C, "service", FunctionalZone.SemiPublic, 12, 20, { occupancy: "commercial" }),
  definition("commercial_storage", "Storage", C, "service", FunctionalZone.Service, 5, 9, { occupancy: "commercial", synonyms: ["store"] }),
  definition("server_room", "Server / IT Room", C, "technical", FunctionalZone.Service, 6, 10, { occupancy: "commercial", synonyms: ["it room"] }),
  definition("electrical_room", "Electrical Room", C, "technical", FunctionalZone.Service, 5, 8, { occupancy: "commercial" }),
  definition("male_toilet", "Male Toilet", [...C, ...E], "baths", FunctionalZone.Service, 6, 10, { occupancy: "shared", priority: "required", synonyms: ["washroom", "men toilet"] }),
  definition("female_toilet", "Female Toilet", [...C, ...E], "baths", FunctionalZone.Service, 6, 10, { occupancy: "shared", priority: "required", synonyms: ["washroom", "women toilet"] }),
  definition("accessible_toilet", "Accessible Toilet", [...C, ...E], "baths", FunctionalZone.Service, 4, 5.5, { occupancy: "shared", priority: "required", synonyms: ["disabled toilet", "wheelchair toilet"] }),
  definition("commercial_lift", "Lift", C, "circulation", FunctionalZone.Circulation, 4, 6, { occupancy: "commercial", priority: "required", floor: "ground_required", synonyms: ["elevator"] }),
  definition("commercial_stair", "Staircase", C, "circulation", FunctionalZone.Circulation, 8, 12, { occupancy: "commercial", priority: "required", floor: "ground_required", synonyms: ["stairs"] }),
  definition("fire_stair", "Fire Stair", C, "circulation", FunctionalZone.Circulation, 8, 12, { occupancy: "commercial", priority: "required" }),
  definition("service_shaft", "Service Shaft", C, "technical", FunctionalZone.Service, 3, 5, { occupancy: "commercial" }),
  definition("commercial_parking", "Parking", C, "vehicle", FunctionalZone.Outdoor, 14, 15, { occupancy: "commercial", quantity: 4, priority: "required", floor: "ground_required", synonyms: ["car parking"] }),
  definition("loading", "Loading / Service Area", C, "vehicle", FunctionalZone.Service, 25, 40, { occupancy: "commercial", floor: "ground_required" })
];
var educational = [
  definition("classroom", "Classroom", E, "learning", FunctionalZone.SemiPublic, 35, 48, { occupancy: "educational", quantity: 4, priority: "required", synonyms: ["class", "teaching room"] }),
  definition("laboratory", "Laboratory", E, "learning", FunctionalZone.SemiPublic, 45, 65, { occupancy: "educational", quantity: 2, synonyms: ["lab", "science lab"] }),
  definition("computer_lab", "Computer Lab", E, "learning", FunctionalZone.SemiPublic, 45, 60, { occupancy: "educational", synonyms: ["computer room"] }),
  definition("library", "Library", E, "learning", FunctionalZone.SemiPublic, 55, 90, { occupancy: "educational", priority: "required" }),
  definition("staff_room", "Staff Room", E, "work", FunctionalZone.Private, 20, 35, { occupancy: "educational" }),
  definition("principal_office", "Principal / Head Office", E, "work", FunctionalZone.Private, 12, 18, { occupancy: "educational", synonyms: ["head office"] }),
  definition("administration", "Administration", E, "work", FunctionalZone.SemiPublic, 20, 35, { occupancy: "educational", priority: "required", synonyms: ["admin"] }),
  definition("education_reception", "Reception", E, "work", FunctionalZone.Public, 10, 16, { occupancy: "educational", floor: "ground_required" }),
  definition("education_meeting", "Meeting Room", E, "work", FunctionalZone.SemiPublic, 10, 16, { occupancy: "educational" }),
  definition("multipurpose", "Multipurpose Room", E, "learning", FunctionalZone.SemiPublic, 60, 100, { occupancy: "educational" }),
  definition("auditorium", "Auditorium", E, "learning", FunctionalZone.Public, 120, 220, { occupancy: "educational", floor: "ground_preferred" }),
  definition("education_store", "Store", E, "service", FunctionalZone.Service, 6, 10, { occupancy: "educational", synonyms: ["storage"] }),
  definition("education_stair", "Staircase", E, "circulation", FunctionalZone.Circulation, 10, 15, { occupancy: "educational", quantity: 2, priority: "required", floor: "ground_required", synonyms: ["stairs"] }),
  definition("education_lift", "Lift", E, "circulation", FunctionalZone.Circulation, 5, 7, { occupancy: "educational", priority: "required", floor: "ground_required", synonyms: ["elevator"] }),
  definition("education_corridor", "Corridor", E, "circulation", FunctionalZone.Circulation, 30, 55, { occupancy: "educational", priority: "required", synonyms: ["passage"] }),
  definition("playground", "Playground / Outdoor Area", E, "outdoor", FunctionalZone.Outdoor, 300, 600, { occupancy: "educational", synonyms: ["outdoor", "play area"] }),
  definition("education_parking", "Parking", E, "vehicle", FunctionalZone.Outdoor, 70, 100, { occupancy: "educational", floor: "ground_required", synonyms: ["car parking"] })
];
var SPACE_CATALOG = Object.freeze([...residential, ...commercial, ...educational]);
var SPACE_PROGRAM_PRESETS = Object.freeze([
  { id: "residential_1bhk", name: "1BHK", category: "residential", items: [
    { definitionId: "living" },
    { definitionId: "dining" },
    { definitionId: "kitchen" },
    { definitionId: "primary_bedroom" },
    { definitionId: "common_bathroom" },
    { definitionId: "car_parking" }
  ] },
  { id: "residential_2bhk", name: "2BHK", category: "residential", items: [
    { definitionId: "living" },
    { definitionId: "dining" },
    { definitionId: "kitchen" },
    { definitionId: "primary_bedroom" },
    { definitionId: "bedroom", quantity: 1 },
    { definitionId: "primary_bathroom" },
    { definitionId: "common_bathroom" },
    { definitionId: "utility" },
    { definitionId: "car_parking" },
    { definitionId: "staircase" }
  ] },
  { id: "residential_3bhk", name: "3BHK", category: "residential", items: [
    { definitionId: "living" },
    { definitionId: "dining" },
    { definitionId: "kitchen" },
    { definitionId: "primary_bedroom" },
    { definitionId: "bedroom", quantity: 2 },
    { definitionId: "primary_bathroom" },
    { definitionId: "common_bathroom", quantity: 2 },
    { definitionId: "utility" },
    { definitionId: "pooja", priority: "preferred" },
    { definitionId: "car_parking" },
    { definitionId: "staircase" },
    { definitionId: "balcony" }
  ] },
  { id: "residential_duplex", name: "Duplex", category: "residential", items: [
    { definitionId: "living" },
    { definitionId: "dining" },
    { definitionId: "kitchen" },
    { definitionId: "guest_bedroom", floorPreference: { kind: "ground_preferred" } },
    { definitionId: "primary_bedroom", floorPreference: { kind: "upper_preferred" } },
    { definitionId: "bedroom", quantity: 2, floorPreference: { kind: "upper_preferred" } },
    { definitionId: "common_bathroom", quantity: 3 },
    { definitionId: "staircase" },
    { definitionId: "balcony" }
  ] },
  { id: "commercial_small_office", name: "Small Office", category: "commercial", items: [
    { definitionId: "reception" },
    { definitionId: "open_office" },
    { definitionId: "private_cabin", quantity: 2 },
    { definitionId: "meeting" },
    { definitionId: "commercial_pantry" },
    { definitionId: "male_toilet" },
    { definitionId: "female_toilet" },
    { definitionId: "accessible_toilet" },
    { definitionId: "commercial_stair" },
    { definitionId: "commercial_parking", quantity: 2 }
  ] },
  { id: "educational_classroom_wing", name: "Classroom Wing", category: "educational", items: [
    { definitionId: "classroom", quantity: 6 },
    { definitionId: "laboratory", quantity: 2 },
    { definitionId: "library" },
    { definitionId: "staff_room" },
    { definitionId: "administration" },
    { definitionId: "male_toilet" },
    { definitionId: "female_toilet" },
    { definitionId: "accessible_toilet" },
    { definitionId: "education_stair", quantity: 2 },
    { definitionId: "education_lift" }
  ] }
]);

// packages/core/dist/models/space-program.js
var CIRCULATION_RESERVE_RATIO = 0.12;
var VERTICAL_CORE_RESERVE_RATIO = 0.04;
var WALL_SERVICE_RESERVE_RATIO = 0.06;
var TOTAL_RESERVE_RATIO = CIRCULATION_RESERVE_RATIO + VERTICAL_CORE_RESERVE_RATIO + WALL_SERVICE_RESERVE_RATIO;
var DERIVATION_MAP = {
  [RoomType.Living]: "living",
  [RoomType.Dining]: "dining",
  [RoomType.Kitchen]: "kitchen",
  [RoomType.Bedroom]: "bedroom",
  [RoomType.Bathroom]: "common_bathroom",
  [RoomType.Utility]: "utility",
  [RoomType.Pooja]: "pooja",
  [RoomType.Study]: "study",
  [RoomType.Staircase]: "staircase",
  [RoomType.Lift]: "lift",
  [RoomType.Parking]: "car_parking",
  [RoomType.Balcony]: "balcony",
  [RoomType.Storage]: "store",
  [RoomType.Corridor]: "corridor",
  [RoomType.Foyer]: "foyer",
  [RoomType.FamilyLiving]: "family_lounge",
  [RoomType.Terrace]: "terrace"
};

// packages/core/dist/models/footprint.js
var CIRCULATION_RATIO = 0.12;
var CORE_RATIO = 0.04;
var WALL_SERVICE_RATIO = 0.06;
var USABLE_RATIO = 1 - CIRCULATION_RATIO - CORE_RATIO - WALL_SERVICE_RATIO;
var FOOTPRINT_SHAPES = Object.freeze([
  { id: "rectangle", name: "Rectangle", description: "Efficient universal floor plate", recommendedCategories: ["residential", "commercial", "mixed_use"] },
  { id: "l_shape", name: "L Shape", description: "Two wings around an open edge", recommendedCategories: ["residential", "commercial", "educational", "mixed_use"] },
  { id: "u_shape", name: "U Shape", description: "Three-sided court or arrival space", recommendedCategories: ["educational", "commercial"] },
  { id: "t_shape", name: "T Shape", description: "Primary bar with a central wing", recommendedCategories: ["educational", "commercial"] },
  { id: "courtyard", name: "Courtyard", description: "Limited perimeter plate with an access slot; not polygon-hole topology", recommendedCategories: ["residential", "commercial", "educational"], customSupport: "limited" },
  { id: "linear", name: "Linear", description: "Shallow elongated building plate", recommendedCategories: ["commercial", "educational"] },
  { id: "custom", name: "Custom", description: "Preserved existing or imported polygon", recommendedCategories: [], customSupport: "limited" }
]);

// packages/geometry-engine/dist/errors.js
var GeometryError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "GeometryError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
};
var DegenerateGeometryError = class extends GeometryError {
  constructor(entityType, reason) {
    super(`Degenerate ${entityType}: ${reason}`);
    this.name = "DegenerateGeometryError";
  }
};

// packages/geometry-engine/dist/point.js
function distance(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}
function rotatePoint(point, angleDeg, origin = { x: 0, y: 0 }) {
  const rad = angleDeg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos
  };
}
function closestPointOnSegment(point, segment) {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-10) {
    return { x: segment.start.x, y: segment.start.y };
  }
  let t = ((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return {
    x: segment.start.x + t * dx,
    y: segment.start.y + t * dy
  };
}
function pointToSegmentDistanceDirect(point, segment) {
  const closest = closestPointOnSegment(point, segment);
  return distance(point, closest);
}
function pointOnSegment(point, segment, tolerance = TOLERANCES.LINEAR) {
  return pointToSegmentDistanceDirect(point, segment) <= tolerance;
}
function pointInPolygon(point, polygon) {
  const pts = polygon.points;
  const n = pts.length;
  if (n < 3)
    return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = pts[i];
    const pj = pts[j];
    const seg = { start: pi, end: pj };
    if (pointOnSegment(point, seg, TOLERANCES.LINEAR))
      return true;
    if (pi.y > point.y !== pj.y > point.y && point.x < (pj.x - pi.x) * (point.y - pi.y) / (pj.y - pi.y) + pi.x) {
      inside = !inside;
    }
  }
  return inside;
}
function pointsEqual(a, b, tolerance = TOLERANCES.LINEAR) {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

// packages/geometry-engine/dist/segment.js
function segmentLength(segment) {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  return Math.sqrt(dx * dx + dy * dy);
}
function segmentIntersection(a, b) {
  const x1 = a.start.x, y1 = a.start.y;
  const x2 = a.end.x, y2 = a.end.y;
  const x3 = b.start.x, y3 = b.start.y;
  const x4 = b.end.x, y4 = b.end.y;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-10) {
    const eps2 = TOLERANCES.LINEAR;
    if (pointOnSegmentDirect(a.start, b, eps2))
      return a.start;
    if (pointOnSegmentDirect(a.end, b, eps2))
      return a.end;
    if (pointOnSegmentDirect(b.start, a, eps2))
      return b.start;
    if (pointOnSegmentDirect(b.end, a, eps2))
      return b.end;
    return null;
  }
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  const eps = 1e-6;
  if (t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps) {
    const clampedT = Math.max(0, Math.min(1, t));
    return {
      x: x1 + clampedT * (x2 - x1),
      y: y1 + clampedT * (y2 - y1)
    };
  }
  return null;
}
function pointOnSegmentDirect(p, seg, tolerance) {
  const d = pointToSegmentDistance(p, seg);
  return d <= tolerance;
}
function pointClosestPoint(point, segment) {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-10) {
    return { x: segment.start.x, y: segment.start.y };
  }
  let t = ((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return {
    x: segment.start.x + t * dx,
    y: segment.start.y + t * dy
  };
}
function pointToSegmentDistance(point, segment) {
  const closest = pointClosestPoint(point, segment);
  return distance(point, closest);
}
function offsetSegment(segment, dist, side) {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-10) {
    throw new DegenerateGeometryError("LineSegment", "Cannot offset a zero-length segment");
  }
  let nx = dy / len;
  let ny = -dx / len;
  if (side === "right") {
    nx = -nx;
    ny = -ny;
  }
  return {
    start: { x: segment.start.x + nx * dist, y: segment.start.y + ny * dist },
    end: { x: segment.end.x + nx * dist, y: segment.end.y + ny * dist }
  };
}

// packages/geometry-engine/dist/polygon.js
function polygonSignedArea(polygon) {
  const pts = polygon.points;
  const n = pts.length;
  if (n < 3)
    return 0;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    area += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  }
  return area / 2;
}
function polygonArea2(polygon) {
  return Math.abs(polygonSignedArea(polygon));
}
function polygonBoundingBox(polygon) {
  const pts = polygon.points;
  if (pts.length === 0)
    return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX)
      minX = p.x;
    if (p.y < minY)
      minY = p.y;
    if (p.x > maxX)
      maxX = p.x;
    if (p.y > maxY)
      maxY = p.y;
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}
function isConvex(polygon) {
  const pts = polygon.points;
  const n = pts.length;
  if (n < 3)
    return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const cross = (p2.x - p1.x) * (p3.y - p2.y) - (p2.y - p1.y) * (p3.x - p2.x);
    if (Math.abs(cross) > 1e-10) {
      if (sign === 0) {
        sign = cross > 0 ? 1 : -1;
      } else if ((cross > 0 ? 1 : -1) !== sign) {
        return false;
      }
    }
  }
  return true;
}
function isValidPolygon(polygon) {
  const pts = polygon.points;
  if (pts.length < 3)
    return false;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = { start: pts[i], end: pts[(i + 1) % n] };
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1)
        continue;
      const b = { start: pts[j], end: pts[(j + 1) % n] };
      if (segmentIntersection(a, b) !== null) {
        return false;
      }
    }
  }
  return polygonArea2(polygon) > TOLERANCES.AREA;
}
function containsPolygon(outer, inner) {
  for (const p of inner.points) {
    if (!pointInPolygon(p, outer)) {
      return false;
    }
  }
  return true;
}
function polygonIntersectionArea(a, b) {
  const clipped = sutherlandHodgmanClip(a.points.slice(), b.points.slice());
  if (clipped.length < 3)
    return 0;
  return polygonArea2({ points: clipped });
}
function sutherlandHodgmanClip(subject, clip) {
  let output = subject;
  for (let i = 0; i < clip.length; i++) {
    if (output.length === 0)
      return [];
    const input = output;
    output = [];
    const edgeStart = clip[i];
    const edgeEnd = clip[(i + 1) % clip.length];
    for (let j = 0; j < input.length; j++) {
      const current = input[j];
      const previous = input[(j - 1 + input.length) % input.length];
      const currInside = isInsideEdge(current, edgeStart, edgeEnd);
      const prevInside = isInsideEdge(previous, edgeStart, edgeEnd);
      if (currInside) {
        if (!prevInside) {
          const inter = lineIntersection(previous, current, edgeStart, edgeEnd);
          if (inter)
            output.push(inter);
        }
        output.push(current);
      } else if (prevInside) {
        const inter = lineIntersection(previous, current, edgeStart, edgeEnd);
        if (inter)
          output.push(inter);
      }
    }
  }
  return output;
}
function isInsideEdge(point, edgeStart, edgeEnd) {
  return (edgeEnd.x - edgeStart.x) * (point.y - edgeStart.y) - (edgeEnd.y - edgeStart.y) * (point.x - edgeStart.x) >= -1e-7;
}
function lineIntersection(p1, p2, p3, p4) {
  const denom = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  if (Math.abs(denom) < 1e-10)
    return null;
  const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / denom;
  return {
    x: p1.x + t * (p2.x - p1.x),
    y: p1.y + t * (p2.y - p1.y)
  };
}
function polygonsAdjacent(a, b, tolerance = TOLERANCES.ADJACENCY) {
  return sharedEdge(a, b, tolerance) !== null;
}
function sharedEdge(a, b, tolerance = TOLERANCES.ADJACENCY) {
  const aEdges = polygonEdges(a);
  const bEdges = polygonEdges(b);
  for (const ea of aEdges) {
    for (const eb of bEdges) {
      if (edgesOverlap(ea, eb, tolerance)) {
        return ea;
      }
    }
  }
  return null;
}
function polygonEdges(polygon) {
  const pts = polygon.points;
  const edges = [];
  for (let i = 0; i < pts.length; i++) {
    edges.push({ start: pts[i], end: pts[(i + 1) % pts.length] });
  }
  return edges;
}
function edgesOverlap(a, b, tolerance) {
  const isHorizontalA = Math.abs(a.start.y - a.end.y) <= tolerance;
  const isHorizontalB = Math.abs(b.start.y - b.end.y) <= tolerance;
  const isVerticalA = Math.abs(a.start.x - a.end.x) <= tolerance;
  const isVerticalB = Math.abs(b.start.x - b.end.x) <= tolerance;
  if (isHorizontalA && isHorizontalB) {
    if (Math.abs(a.start.y - b.start.y) > tolerance)
      return false;
    const aMinX = Math.min(a.start.x, a.end.x);
    const aMaxX = Math.max(a.start.x, a.end.x);
    const bMinX = Math.min(b.start.x, b.end.x);
    const bMaxX = Math.max(b.start.x, b.end.x);
    return aMinX < bMaxX - tolerance && bMinX < aMaxX - tolerance;
  }
  if (isVerticalA && isVerticalB) {
    if (Math.abs(a.start.x - b.start.x) > tolerance)
      return false;
    const aMinY = Math.min(a.start.y, a.end.y);
    const aMaxY = Math.max(a.start.y, a.end.y);
    const bMinY = Math.min(b.start.y, b.end.y);
    const bMaxY = Math.max(b.start.y, b.end.y);
    return aMinY < bMaxY - tolerance && bMinY < aMaxY - tolerance;
  }
  return pointsEqual(a.start, b.start, tolerance) && pointsEqual(a.end, b.end, tolerance) || pointsEqual(a.start, b.end, tolerance) && pointsEqual(a.end, b.start, tolerance);
}

// packages/geometry-engine/dist/walls.js
var DEFAULT_WALL_CONFIG = {
  externalThickness: DEFAULTS.WALL_THICKNESS_EXTERNAL,
  internalThickness: DEFAULTS.WALL_THICKNESS_INTERNAL
};
function wallToPolygon(wall) {
  const centerSeg = { start: wall.startPoint, end: wall.endPoint };
  const halfThickness = wall.thickness / 2;
  if (halfThickness <= 0) {
    throw new DegenerateGeometryError("Wall", `Thickness must be positive (received ${wall.thickness})`);
  }
  const leftSeg = offsetSegment(centerSeg, halfThickness, "left");
  const rightSeg = offsetSegment(centerSeg, halfThickness, "right");
  return {
    points: [
      leftSeg.start,
      leftSeg.end,
      rightSeg.end,
      rightSeg.start
    ]
  };
}

// packages/geometry-engine/dist/opening-geometry.js
var OPENING_LINEAR_TOLERANCE_MM = 1e-3;
function canonicalOpeningGeometry(opening, wall) {
  if (!wall)
    throw new Error(`OPENING_HOST_MISSING:${opening?.id}`);
  if (opening.openingGeometryVersion !== 1 || opening.positionReference !== "CENTER")
    throw new Error(`OPENING_MIGRATION_REQUIRED:${opening.id}`);
  if (opening.wallId !== wall.id || opening.floorId !== wall.floorId)
    throw new Error(`OPENING_HOST_MISMATCH:${opening.id}`);
  const dx = wall.endPoint.x - wall.startPoint.x, dy = wall.endPoint.y - wall.startPoint.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= 0)
    throw new Error("INVALID_OPENING_HOST");
  const ux = dx / length, uy = dy / length;
  const x = opening.position.x - wall.startPoint.x, y = opening.position.y - wall.startPoint.y;
  const center = x * ux + y * uy;
  const start = center - opening.width / 2, end = center + opening.width / 2;
  if (![start, end, opening.height].every(Number.isFinite) || opening.width <= 0 || opening.height <= 0 || Math.abs(x * uy - y * ux) > OPENING_LINEAR_TOLERANCE_MM || start < -OPENING_LINEAR_TOLERANCE_MM || end > length + OPENING_LINEAR_TOLERANCE_MM)
    throw new Error(`INVALID_OPENING_INTERVAL:${opening.id}`);
  const pointAt = (along) => ({ x: wall.startPoint.x + ux * along, y: wall.startPoint.y + uy * along });
  return { start, end, center, length, ux, uy, startPoint: pointAt(start), endPoint: pointAt(end), centerPoint: pointAt(center), pointAt };
}

// packages/geometry-engine/dist/doors.js
function validateDoorPlacement(door, hostWall, minEdgeDistance = 100) {
  if (door.openingGeometryVersion === 1) {
    try {
      const g = canonicalOpeningGeometry(door, hostWall);
      return { valid: g.start >= minEdgeDistance && g.end <= g.length - minEdgeDistance, reason: "Opening interval must retain configured edge clearance" };
    } catch (error) {
      return { valid: false, reason: String(error) };
    }
  }
  const wallSeg = { start: hostWall.startPoint, end: hostWall.endPoint };
  const wallLen = segmentLength(wallSeg);
  if (door.width <= 0) {
    return { valid: false, reason: `Door width must be positive (received ${door.width}mm)` };
  }
  if (wallLen < door.width + 2 * minEdgeDistance) {
    return {
      valid: false,
      reason: `Wall length (${Math.round(wallLen)}mm) is too short for door width (${door.width}mm) plus edge clearance (${minEdgeDistance * 2}mm)`
    };
  }
  if (!pointOnSegment(door.position, wallSeg, TOLERANCES.ADJACENCY)) {
    return {
      valid: false,
      reason: `Door position (${door.position.x}, ${door.position.y}) is not on host wall [${hostWall.id}]`
    };
  }
  const distToStart = distance(door.position, hostWall.startPoint);
  const distToEnd = distance(door.position, hostWall.endPoint);
  if (distToStart < minEdgeDistance - TOLERANCES.LINEAR) {
    return {
      valid: false,
      reason: `Door is too close to wall start point (${Math.round(distToStart)}mm < ${minEdgeDistance}mm)`
    };
  }
  if (distToEnd < door.width + minEdgeDistance - TOLERANCES.LINEAR) {
    return {
      valid: false,
      reason: `Door extends beyond wall end point (${Math.round(distToEnd)}mm < ${door.width + minEdgeDistance}mm)`
    };
  }
  return { valid: true };
}
function computeDoorOpeningSegment(door, hostWall) {
  if (door.openingGeometryVersion === 1) {
    const g = canonicalOpeningGeometry(door, hostWall);
    return { start: g.startPoint, end: g.endPoint };
  }
  const wallSeg = { start: hostWall.startPoint, end: hostWall.endPoint };
  const wallLen = segmentLength(wallSeg);
  const dx = (hostWall.endPoint.x - hostWall.startPoint.x) / wallLen;
  const dy = (hostWall.endPoint.y - hostWall.startPoint.y) / wallLen;
  const hinge = pointClosestPoint(door.position, wallSeg);
  const strike = {
    x: hinge.x + dx * door.width,
    y: hinge.y + dy * door.width
  };
  return { start: hinge, end: strike };
}
function computeDoorSwingPolygon(door, hostWall, segments = 8) {
  const opening = computeDoorOpeningSegment(door, hostWall);
  const hinge = opening.start;
  const strike = opening.end;
  if (door.type === DoorType.Sliding || door.type === DoorType.Folding) {
    const offset = offsetSegment(opening, hostWall.thickness, "left");
    return {
      points: [opening.start, opening.end, offset.end, offset.start]
    };
  }
  const isClockwise = door.swingDirection === SwingDirection.Right || door.swingDirection === SwingDirection.Inward;
  const sweepAngle = isClockwise ? 90 : -90;
  const points = [hinge];
  for (let i = 0; i <= segments; i++) {
    const angle = sweepAngle * i / segments;
    points.push(rotatePoint(strike, angle, hinge));
  }
  return { points };
}

// packages/geometry-engine/dist/windows.js
function validateWindowPlacement(window, hostWall, minEdgeDistance = 200, allowInternal = false) {
  if (window.openingGeometryVersion === 1) {
    try {
      const g = canonicalOpeningGeometry(window, hostWall);
      return { valid: g.start >= minEdgeDistance && g.end <= g.length - minEdgeDistance, reason: "Opening interval must retain configured edge clearance" };
    } catch (error) {
      return { valid: false, reason: String(error) };
    }
  }
  const wallSeg = { start: hostWall.startPoint, end: hostWall.endPoint };
  const wallLen = segmentLength(wallSeg);
  if (window.width <= 0) {
    return { valid: false, reason: `Window width must be positive (received ${window.width}mm)` };
  }
  if (!allowInternal && hostWall.type !== WallType.External) {
    return {
      valid: false,
      reason: `Windows must be placed on external walls (host wall type is ${hostWall.type})`
    };
  }
  if (wallLen < window.width + 2 * minEdgeDistance) {
    return {
      valid: false,
      reason: `Wall length (${Math.round(wallLen)}mm) is too short for window width (${window.width}mm) plus corner clearance (${minEdgeDistance * 2}mm)`
    };
  }
  if (!pointOnSegment(window.position, wallSeg, TOLERANCES.ADJACENCY)) {
    return {
      valid: false,
      reason: `Window position (${window.position.x}, ${window.position.y}) is not on host wall [${hostWall.id}]`
    };
  }
  const distToStart = distance(window.position, hostWall.startPoint);
  const distToEnd = distance(window.position, hostWall.endPoint);
  if (distToStart < minEdgeDistance - TOLERANCES.LINEAR) {
    return {
      valid: false,
      reason: `Window is too close to wall start point (${Math.round(distToStart)}mm < ${minEdgeDistance}mm)`
    };
  }
  if (distToEnd < window.width + minEdgeDistance - TOLERANCES.LINEAR) {
    return {
      valid: false,
      reason: `Window extends beyond wall end point (${Math.round(distToEnd)}mm < ${window.width + minEdgeDistance}mm)`
    };
  }
  return { valid: true };
}

// packages/geometry-engine/dist/apartment-walls.js
function generateApartmentWalls(rooms, floorId, _boundary, semantic = rooms.some((r) => r.architecturalRole !== void 0), guardHeightMm = 1100) {
  const groups = /* @__PURE__ */ new Map();
  for (const room of rooms) {
    const p = room.boundary.points;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      const axis = Math.abs(a.y - b.y) <= 1 ? "x" : Math.abs(a.x - b.x) <= 1 ? "y" : null;
      if (!axis)
        throw new Error("WALL_TOPOLOGY_INVALID: apartment walls require orthogonal room boundaries");
      const line = Math.round(axis === "x" ? a.y : a.x);
      const lo = Math.round(Math.min(axis === "x" ? a.x : a.y, axis === "x" ? b.x : b.y));
      const hi = Math.round(Math.max(axis === "x" ? a.x : a.y, axis === "x" ? b.x : b.y));
      if (hi <= lo)
        continue;
      const center = axis === "x" ? room.y + room.height / 2 : room.x + room.width / 2;
      const side = (axis === "x" ? center > line : center < line) ? "left" : "right";
      const key2 = `${axis}:${line}`;
      groups.set(key2, [...groups.get(key2) ?? [], { axis, line, lo, hi, room, side }]);
    }
  }
  const walls = [];
  for (const [key2, edges] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const { axis, line } = edges[0];
    const cuts = [...new Set(edges.flatMap((e) => [e.lo, e.hi]))].sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      const lo = cuts[i - 1], hi = cuts[i];
      const owners = edges.filter((e) => e.lo <= lo && e.hi >= hi);
      if (!owners.length)
        continue;
      const ids = [...new Set(owners.map((e) => e.room.id))].sort();
      const unitIds = [...new Set(owners.flatMap((e) => e.room.unitId ? [e.room.unitId] : []))].sort();
      const uses = owners.map((e) => e.room.spaceUse);
      const external = ids.length === 1;
      const isUnitSeparation = unitIds.length > 1;
      const use = isUnitSeparation ? "UNIT_SEPARATION" : uses.includes("SERVICE") ? "SHAFT" : uses.includes("OUTDOOR") ? "BALCONY" : uses.includes("CORE") ? "CORE" : uses.includes("COMMON") && unitIds.length ? "COMMON_CORRIDOR" : external ? "EXTERNAL" : "INTERNAL_PARTITION";
      const boundaryRole = semantic ? architecturalBoundaryRole(owners.map((e) => e.room), external) : void 0;
      const thickness = use === "EXTERNAL" || use === "UNIT_SEPARATION" ? 230 : use === "COMMON_CORRIDOR" || use === "CORE" ? 150 : use === "SHAFT" ? 100 : use === "BALCONY" ? external ? 230 : 115 : 115;
      walls.push({ id: `${floorId}::apt-wall:${key2}:${lo}:${hi}`, floorId, startPoint: axis === "x" ? { x: lo, y: line } : { x: line, y: lo }, endPoint: axis === "x" ? { x: hi, y: line } : { x: line, y: hi }, thickness, type: external ? WallType.External : WallType.Internal, roomIds: ids, unitIds, wallUse: boundaryRole === "PARAPET" ? "PARAPET" : use, boundaryRole, ...boundaryRole === "OPEN_BOUNDARY" ? { heightMm: 0 } : boundaryRole === "PARAPET" ? { heightMm: guardHeightMm } : {}, leftRoomId: owners.find((o) => o.side === "left")?.room.id, rightRoomId: owners.find((o) => o.side === "right")?.room.id, hasOpening: false, loadBearing: false, provenance: "PROVISIONAL_HEURISTIC" });
    }
  }
  return walls;
}
function openingFitsApartmentWall(wall, position, width) {
  const horizontal = Math.abs(wall.startPoint.y - wall.endPoint.y) <= 1;
  const on = Math.abs(horizontal ? position.y - wall.startPoint.y : position.x - wall.startPoint.x) <= 25;
  const s = horizontal ? wall.startPoint.x : wall.startPoint.y;
  const e = horizontal ? wall.endPoint.x : wall.endPoint.y;
  const p = horizontal ? position.x : position.y;
  return on && width > 0 && p - width / 2 >= Math.min(s, e) + 100 && p + width / 2 <= Math.max(s, e) - 100;
}

// packages/geometry-engine/dist/planar-cells.js
function partitionPlanarCells(polygons) {
  if (polygons.some((p) => p.points.some((q) => !Number.isFinite(q.x) || !Number.isFinite(q.y)) || !isValidPolygon(p)))
    return { supported: false, cells: [] };
  const edges = polygons.flatMap((p) => p.points.map((a, i) => ({ a, b: p.points[(i + 1) % p.points.length] }))), events = new Set(edges.flatMap((e) => [e.a.x, e.b.x]));
  if (edges.length > 1500)
    return { supported: false, cells: [] };
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i], b = edges[j], dx = a.b.x - a.a.x, dy = a.b.y - a.a.y, ex = b.b.x - b.a.x, ey = b.b.y - b.a.y, den = dx * ey - dy * ex;
      if (!den)
        continue;
      const qx = b.a.x - a.a.x, qy = b.a.y - a.a.y, t = (qx * ey - qy * ex) / den, u = (qx * dy - qy * dx) / den;
      if (t > 0 && t < 1 && u > 0 && u < 1) {
        events.add(a.a.x + t * dx);
        if (events.size > 2e4)
          return { supported: false, cells: [] };
      }
    }
  const xs = [...events].sort((a, b) => a - b), cells = [];
  for (let i = 1; i < xs.length; i++) {
    const left = xs[i - 1], right = xs[i], mid = (left + right) / 2;
    const crossing = edges.filter((e) => Math.min(e.a.x, e.b.x) < mid && Math.max(e.a.x, e.b.x) > mid).map((e) => ({
      y: (x) => e.a.y + (x - e.a.x) * (e.b.y - e.a.y) / (e.b.x - e.a.x)
    })).sort((a, b) => a.y(mid) - b.y(mid));
    for (let j = 1; j < crossing.length; j++) {
      const low = crossing[j - 1], high = crossing[j], height = high.y(mid) - low.y(mid);
      if (height <= 0)
        continue;
      const area = (right - left) * (high.y(left) - low.y(left) + (high.y(right) - low.y(right))) / 2;
      if (cells.length > 2e5)
        return { supported: false, cells: [] };
      if (area > 0)
        cells.push({
          point: { x: mid, y: (low.y(mid) + high.y(mid)) / 2 },
          area
        });
    }
  }
  return { supported: true, cells };
}

// packages/geometry-engine/dist/apartment-ledger.js
function pointInPolygon2(point, polygon) {
  let inside = false;
  const pts = polygon.points;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (a.y > point.y !== b.y > point.y && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}
function measureApartmentAreaLedger(floor) {
  const wallPolygons = floor.walls.filter(isPhysicalBoundary).map((w) => wallToPolygon(w));
  const polys = [
    floor.boundary,
    ...floor.voidBoundaries ?? [],
    ...floor.rooms.map((r) => r.boundary),
    ...wallPolygons
  ];
  const orthogonal = polys.every((p) => p.points.length >= 3 && p.points.every((pt, i) => {
    const next = p.points[(i + 1) % p.points.length];
    return Number.isFinite(pt.x) && Number.isFinite(pt.y) && (pt.x === next.x || pt.y === next.y);
  }));
  const xs = [
    ...new Set(polys.flatMap((p) => p.points.map((pt) => pt.x)))
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set(polys.flatMap((p) => p.points.map((pt) => pt.y)))
  ].sort((a, b) => a - b);
  const partition = orthogonal ? null : partitionPlanarCells(polys);
  const supported = orthogonal || partition?.supported === true;
  const roomUsable = {};
  const totals = {
    unitUsable: 0,
    balcony: 0,
    core: 0,
    common: 0,
    service: 0,
    wall: 0,
    void: 0,
    unassigned: 0,
    overlap: 0,
    roomVoidOverlap: 0
  };
  const cells = partition?.cells ?? function* () {
    for (let i = 1; i < xs.length; i++)
      for (let j = 1; j < ys.length; j++)
        yield {
          area: (xs[i] - xs[i - 1]) * (ys[j] - ys[j - 1]),
          point: {
            x: (xs[i] + xs[i - 1]) / 2,
            y: (ys[j] + ys[j - 1]) / 2
          }
        };
  }();
  for (const { area: a, point: pt } of cells) {
    if (a <= 0)
      continue;
    if (!pointInPolygon2(pt, floor.boundary))
      continue;
    const owners = floor.rooms.filter((r2) => pointInPolygon2(pt, r2.boundary));
    if (owners.length && floor.voidBoundaries?.some((p) => pointInPolygon2(pt, p)))
      totals.roomVoidOverlap += a;
    if (owners.length > 1)
      totals.overlap += a;
    if (wallPolygons.some((p) => pointInPolygon2(pt, p))) {
      totals.wall += a;
      continue;
    }
    if (floor.voidBoundaries?.some((p) => pointInPolygon2(pt, p))) {
      totals.void += a;
      continue;
    }
    const r = owners[0];
    if (!r) {
      totals.unassigned += a;
      continue;
    }
    roomUsable[r.id] = (roomUsable[r.id] ?? 0) + a;
    const use = r.spaceUse ?? roomSpaceUse(r);
    const category = use === "VOID" ? "void" : use === "OUTDOOR" ? "balcony" : use === "CORE" ? "core" : use === "COMMON" ? "common" : use === "SERVICE" ? "service" : r.unitId ? "unitUsable" : "unassigned";
    totals[category] += a;
  }
  const gross = polygonArea2(floor.boundary);
  const accounted = totals.unitUsable + totals.balcony + totals.core + totals.common + totals.service + totals.wall + totals.void + totals.unassigned;
  const unitBuiltUp = {};
  for (const u of floor.apartmentUnits ?? [])
    unitBuiltUp[u.id] = polygonArea2(u.boundary);
  const balconies = floor.rooms.filter((r) => r.spaceUse === "OUTDOOR" || r.type === "balcony").map((r) => ({
    id: r.id,
    unitId: r.unitId,
    boundary: r.boundary,
    area: roomUsable[r.id] ?? 0,
    grossArea: polygonArea2(r.boundary),
    usableDepth: Math.min(r.width, r.height) - 230,
    usableWidth: Math.max(r.width, r.height) - 230,
    accessDoorIds: floor.doors.filter((d) => d.connectsRooms.includes(r.id)).map((d) => d.id),
    adjacentRoomIds: floor.doors.filter((d) => d.connectsRooms.includes(r.id)).flatMap((d) => d.connectsRooms.filter((id) => id !== r.id))
  }));
  return {
    supported,
    units: "mm2",
    convention: "CENTRELINE_CELLS_MINUS_CLIPPED_WALL_UNION",
    gross,
    ...totals,
    accounted,
    delta: gross - accounted,
    roomUsable,
    unitBuiltUp,
    balconies
  };
}
function roomSpaceUse(room) {
  if (room.type === "balcony")
    return "OUTDOOR";
  if (room.unitId)
    return "UNIT";
  if (room.type === "service_shaft")
    return "SERVICE";
  if (room.type === "lift" || room.type === "staircase")
    return "CORE";
  return "COMMON";
}

// packages/geometry-engine/dist/units.js
function sqMmToSqFt(sqMm) {
  return sqMm / (UNITS.MM_PER_FOOT * UNITS.MM_PER_FOOT);
}
function sqMmToSqM(sqMm) {
  return sqMm / (UNITS.MM_PER_METER * UNITS.MM_PER_METER);
}

// packages/geometry-engine/dist/regulatory-measurements.js
function rectangularBounds(p) {
  if (p.points.length !== 4 || p.points.some((v, i) => !Number.isFinite(v.x) || !Number.isFinite(v.y) || v.x !== p.points[(i + 1) % 4].x && v.y !== p.points[(i + 1) % 4].y))
    return null;
  const b = polygonBoundingBox(p);
  return b.width > 0 && b.height > 0 && Math.abs(polygonArea2(p) - b.width * b.height) < 1e-3 ? { ...b, minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height } : null;
}
function measureClearRoom(floor, room) {
  const b = rectangularBounds(room.boundary);
  if (!b)
    return null;
  let x0 = b.minX, y0 = b.minY, x1 = b.maxX, y1 = b.maxY;
  for (const wall of floor.walls) {
    const wb = rectangularBounds(wallToPolygon(wall));
    if (!wb)
      return null;
    if (wb.maxX <= b.minX || wb.minX >= b.maxX || wb.maxY <= b.minY || wb.minY >= b.maxY)
      continue;
    if (wb.minX <= b.minX && wb.maxY >= b.maxY && wb.minY <= b.minY)
      x0 = Math.max(x0, wb.maxX);
    else if (wb.maxX >= b.maxX && wb.maxY >= b.maxY && wb.minY <= b.minY)
      x1 = Math.min(x1, wb.minX);
    else if (wb.minY <= b.minY && wb.maxX >= b.maxX && wb.minX <= b.minX)
      y0 = Math.max(y0, wb.maxY);
    else if (wb.maxY >= b.maxY && wb.maxX >= b.maxX && wb.minX <= b.minX)
      y1 = Math.min(y1, wb.minY);
    else
      return null;
  }
  if (x1 <= x0 || y1 <= y0)
    return null;
  return {
    minX: x0,
    minY: y0,
    maxX: x1,
    maxY: y1,
    width: x1 - x0,
    height: y1 - y0
  };
}
function measureMarkedParking(building) {
  const bays = [
    ...building.floors.filter((f) => f.floorUse === "STILT_PARKING" || f.level === 0).flatMap((f) => f.rooms.filter((r) => r.type === "parking" && !r.tags.includes("STILT_CIRCULATION")).map((r) => ({
      id: r.id,
      name: r.name,
      boundary: r.boundary,
      kind: /^C[- ]?\d+/i.test(r.name) ? "CAR_STALL" : /^B[- ]?\d+/i.test(r.name) ? "BIKE_STALL" : "UNKNOWN",
      floorId: f.id
    }))),
    ...(building.site.siteZones ?? []).filter((z) => z.regulatoryUse === "CAR_STALL" || z.regulatoryUse === "BIKE_STALL").map((z) => ({
      id: z.id,
      name: z.name,
      boundary: z.boundary,
      kind: z.regulatoryUse,
      floorId: "site"
    }))
  ];
  const invalid = [];
  const valid = bays.filter((b, i) => {
    const rect = rectangularBounds(b.boundary), small = rect ? Math.min(rect.width, rect.height) : 0, large = rect ? Math.max(rect.width, rect.height) : 0;
    const inside = isValidPolygon(building.site.plotBoundary) && isConvex(building.site.plotBoundary) && polygonIntersectionArea(b.boundary, polygonSignedArea(building.site.plotBoundary) < 0 ? { points: [...building.site.plotBoundary.points].reverse() } : building.site.plotBoundary) >= polygonArea2(b.boundary) - 1e-3;
    const overlap = bays.some((o, j) => j !== i && (o.floorId === b.floorId || o.floorId === "site" || b.floorId === "site") && polygonIntersectionArea(b.boundary, o.boundary) >= 1e-3);
    const physicalFloor = building.floors.find((f) => f.id === b.floorId);
    const obstructed = physicalFloor?.walls.some((w) => {
      const solid = wallToPolygon(w);
      const clip = polygonSignedArea(solid) < 0 ? { points: [...solid.points].reverse() } : solid;
      return polygonIntersectionArea(b.boundary, clip) >= 1e-3;
    }) || physicalFloor?.columns.some((c) => {
      const p = {
        points: [
          { x: c.position.x - c.width / 2, y: c.position.y - c.depth / 2 },
          { x: c.position.x + c.width / 2, y: c.position.y - c.depth / 2 },
          { x: c.position.x + c.width / 2, y: c.position.y + c.depth / 2 },
          { x: c.position.x - c.width / 2, y: c.position.y + c.depth / 2 }
        ]
      };
      return polygonIntersectionArea(b.boundary, p) >= 1e-3;
    });
    const insideFloor = !physicalFloor || polygonIntersectionArea(b.boundary, physicalFloor.boundary) >= polygonArea2(b.boundary) - 1e-3;
    const occupied = physicalFloor?.rooms.some((r) => r.type !== "parking" && r.spaceUse !== "VOID" && polygonIntersectionArea(b.boundary, r.boundary) >= 1e-3);
    const okay = !!inside && insideFloor && !occupied && !overlap && !obstructed && (b.kind === "CAR_STALL" ? small >= 2500 && large >= 5e3 : b.kind === "BIKE_STALL" ? small >= 1e3 && large >= 2e3 : false);
    if (!okay)
      invalid.push(b.id);
    return okay;
  });
  const drives = (building.site.siteZones ?? []).filter((z) => z.regulatoryUse === "DRIVEWAY");
  const widths = drives.map((z) => {
    const r = rectangularBounds(z.boundary);
    return r ? Math.min(r.width, r.height) : null;
  });
  const driveConflicts = drives.some((d) => bays.some((b) => polygonIntersectionArea(d.boundary, b.boundary) >= 1e-3));
  return {
    cars: valid.filter((b) => b.kind === "CAR_STALL").length,
    bikes: valid.filter((b) => b.kind === "BIKE_STALL").length,
    invalid,
    bayIds: bays.map((b) => b.id),
    driveIds: drives.map((d) => d.id),
    driveConflicts,
    drivewayWidthMm: widths.length && widths.every((v) => v !== null) ? Math.min(...widths) : null
  };
}
function measureWindowAdjacency(floor, room) {
  const inside = (p, poly) => {
    let b = false;
    const v = poly.points;
    for (let i = 0, j = v.length - 1; i < v.length; j = i++)
      if (v[i].y > p.y !== v[j].y > p.y && p.x < (v[j].x - v[i].x) * (p.y - v[i].y) / (v[j].y - v[i].y) + v[i].x)
        b = !b;
    return b;
  };
  let areaMm2 = 0;
  const invalid = [], shaftIds = /* @__PURE__ */ new Set();
  const windows = floor.windows.filter((w) => w.roomId === room.id);
  for (const w of windows) {
    const wall = floor.walls.find((v) => v.id === w.wallId);
    if (w.type === "fixed" || !wall || !wall.roomIds.includes(room.id) || !Number.isFinite(w.width) || !Number.isFinite(w.height) || w.width <= 0 || w.height <= 0) {
      invalid.push(w.id);
      continue;
    }
    const a = wall.startPoint, b = wall.endPoint, dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    if (!len) {
      invalid.push(w.id);
      continue;
    }
    const t = ((w.position.x - a.x) * dx + (w.position.y - a.y) * dy) / (len * len);
    const offset = Math.abs((w.position.x - a.x) * dy - (w.position.y - a.y) * dx) / len;
    if (t < 0 || t > 1 || offset > wall.thickness / 2 + 1 || w.width > len) {
      invalid.push(w.id);
      continue;
    }
    const d = wall.thickness / 2 + 1, samples = [1, -1].map((k) => ({
      x: w.position.x - k * dy / len * d,
      y: w.position.y + k * dx / len * d
    }));
    const outdoor = samples.some((p) => !inside(p, floor.boundary));
    const adjacent = floor.rooms.filter((r) => r.id !== room.id && ["balcony", "ots", "service_shaft"].includes(r.type) && samples.some((p) => inside(p, r.boundary)));
    if (outdoor || adjacent.length) {
      areaMm2 += w.width * w.height;
      adjacent.filter((r) => r.type === "service_shaft" || r.type === "ots").forEach((r) => shaftIds.add(r.id));
    } else
      invalid.push(w.id);
  }
  return {
    areaMm2,
    windowIds: windows.map((w) => w.id),
    invalid,
    shaftIds: [...shaftIds]
  };
}

// packages/geometry-engine/dist/hardening-geometry.js
function columnFootprint(c) {
  return {
    points: [
      { x: c.position.x - c.width / 2, y: c.position.y - c.depth / 2 },
      { x: c.position.x + c.width / 2, y: c.position.y - c.depth / 2 },
      { x: c.position.x + c.width / 2, y: c.position.y + c.depth / 2 },
      { x: c.position.x - c.width / 2, y: c.position.y + c.depth / 2 }
    ]
  };
}
function segmentFootprint(a, b, width) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!length || width <= 0)
    throw new Error("Invalid segment footprint");
  const dx = (b.y - a.y) / length * width / 2, dy = -(b.x - a.x) / length * width / 2;
  return {
    points: [
      { x: a.x + dx, y: a.y + dy },
      { x: b.x + dx, y: b.y + dy },
      { x: b.x - dx, y: b.y - dy },
      { x: a.x - dx, y: a.y - dy }
    ]
  };
}
function beamFootprint(b) {
  return segmentFootprint(b.startPoint, b.endPoint, b.widthMm);
}
function columnEdgeDistance(a, b) {
  const dx = Math.max(0, Math.abs(a.position.x - b.position.x) - (a.width + b.width) / 2), dy = Math.max(0, Math.abs(a.position.y - b.position.y) - (a.depth + b.depth) / 2);
  return Math.hypot(dx, dy);
}
function projectOnSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  if (!length)
    return null;
  const along = ((p.x - a.x) * dx + (p.y - a.y) * dy) / length;
  return {
    length,
    along,
    distance: Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / length,
    pointAt: (t) => ({
      x: a.x + dx / length * t,
      y: a.y + dy / length * t
    })
  };
}
function hardeningOverlapArea(a, b) {
  if (isConvex(b)) {
    const clip = polygonSignedArea(b) < 0 ? { points: [...b.points].reverse() } : b;
    return polygonIntersectionArea(a, clip);
  }
  const cells = partitionPlanarCells([a, b]);
  if (!cells.supported)
    throw new Error("Unsupported overlap geometry");
  const inside = (p, poly) => {
    let value = false;
    for (let i = 0, j = poly.points.length - 1; i < poly.points.length; j = i++) {
      const x = poly.points[i], y = poly.points[j];
      if (x.y > p.y !== y.y > p.y && p.x < (y.x - x.x) * (p.y - x.y) / (y.y - x.y) + x.x)
        value = !value;
    }
    return value;
  };
  return cells.cells.reduce((sum, c) => sum + (inside(c.point, a) && inside(c.point, b) ? c.area : 0), 0);
}
function zoneHasBoundaryAccess(site, zoneId) {
  const onEdge = (p, poly) => poly.points.some((a, i) => {
    const b = poly.points[(i + 1) % poly.points.length], q = projectOnSegment(p, a, b);
    return q !== null && q.distance < 1e-3 && q.along >= 0 && q.along <= q.length;
  });
  const linked = (a, b) => {
    const x = rectangularBounds(a), y = rectangularBounds(b);
    if (!x || !y)
      return false;
    const width = Math.min(x.maxX, y.maxX) - Math.max(x.minX, y.minX), height = Math.min(x.maxY, y.maxY) - Math.max(x.minY, y.minY);
    return width >= 0 && height >= 0 && (width >= 1200 || height >= 1200);
  };
  const walk = (id, seen) => {
    if (seen.has(id))
      return false;
    seen.add(id);
    const z = site.siteZones?.find((z2) => z2.id === id);
    if (!z)
      return false;
    return z.accessLinks.some((link) => {
      const gate = site.accessPoints.find((g) => g.id === link);
      if (gate)
        return gate.width >= 1200 && onEdge(gate.position, z.boundary) && onEdge(gate.position, site.plotBoundary);
      const next = site.siteZones?.find((n) => n.id === link);
      return !!next && ["vehicle_circulation", "pedestrian_circulation"].includes(next.kind) && linked(z.boundary, next.boundary) && walk(next.id, new Set(seen));
    });
  };
  return walk(zoneId, /* @__PURE__ */ new Set());
}
function floorOpeningFootprints(floor) {
  const invalidIds = [], polygons = [];
  for (const opening of [...floor.doors, ...floor.windows]) {
    const host = floor.walls.find((w) => w.id === opening.wallId), q = host && projectOnSegment(opening.position, host.startPoint, host.endPoint);
    if (!host || !q || ![opening.width, opening.height, host.thickness].every(Number.isFinite) || opening.width <= 0 || opening.height <= 0 || host.thickness <= 0 || q.distance > host.thickness / 2 || q.along - opening.width / 2 < 0 || q.along + opening.width / 2 > q.length) {
      invalidIds.push(opening.id);
      continue;
    }
    const swing = floor.doors.some((d) => d.id === opening.id && !["sliding", "open_passage"].includes(d.type));
    polygons.push({
      id: opening.id,
      polygon: segmentFootprint(q.pointAt(q.along - opening.width / 2), q.pointAt(q.along + opening.width / 2), swing ? 2 * opening.width : host.thickness)
    });
  }
  return { invalidIds, polygons };
}

// packages/geometry-engine/dist/residential-envelope.js
function residentialRoadFrame(plot, facing) {
  const b = polygonBoundingBox(plot), x0 = b.x, y0 = b.y, x1 = b.x + b.width, y1 = b.y + b.height;
  const toLocal = (p) => facing === "south" ? { x: x1 - p.x, y: y1 - p.y } : facing === "east" ? { x: p.y - y0, y: x1 - p.x } : facing === "west" ? { x: y1 - p.y, y: p.x - x0 } : { x: p.x - x0, y: p.y - y0 };
  const fromLocal = (p) => facing === "south" ? { x: x1 - p.x, y: y1 - p.y } : facing === "east" ? { x: x1 - p.y, y: y0 + p.x } : facing === "west" ? { x: x0 + p.y, y: y1 - p.x } : { x: x0 + p.x, y: y0 + p.y };
  return { toLocal, fromLocal };
}
function clipResidentialHalfPlane(p, value) {
  const points = [];
  p.points.forEach((a, i) => {
    const b = p.points[(i + 1) % p.points.length], av = value(a), bv = value(b);
    if (av >= 0)
      points.push(a);
    if (av < 0 && bv > 0 || av > 0 && bv < 0) {
      const t = av / (av - bv);
      points.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    }
  });
  return {
    points: points.filter((q, i) => i === 0 || q.x !== points[i - 1].x || q.y !== points[i - 1].y)
  };
}
function permissibleResidentialEnvelope(plot, setbacks, facing) {
  if (!isValidPolygon(plot) || !isConvex(plot) || Object.values(setbacks).some((v) => !Number.isFinite(v) || v < 0))
    throw new Error("Finite convex plot and nonnegative declared margins required");
  const frame = residentialRoadFrame(plot, facing), raw = plot.points.map(frame.toLocal);
  const source = {
    points: polygonSignedArea({ points: raw }) < 0 ? [...raw].reverse() : raw
  };
  const rectangle = rectangularBounds(source);
  if (rectangle) {
    const x0 = rectangle.minX + setbacks.left, x1 = rectangle.maxX - setbacks.right, y0 = rectangle.minY + setbacks.front, y1 = rectangle.maxY - setbacks.rear;
    if (x1 <= x0 || y1 <= y0)
      throw new Error("Setbacks consume the entire plot");
    return {
      points: [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 }
      ].map(frame.fromLocal)
    };
  }
  let inset = source;
  source.points.forEach((a, i) => {
    const b = source.points[(i + 1) % source.points.length], dx = b.x - a.x, dy = b.y - a.y;
    const nx = -dy, ny = dx;
    const margin = Math.abs(nx) * (nx > 0 ? setbacks.left : setbacks.right) + Math.abs(ny) * (ny > 0 ? setbacks.front : setbacks.rear);
    inset = clipResidentialHalfPlane(inset, (q) => nx * (q.x - a.x) + ny * (q.y - a.y) - margin);
  });
  if (inset.points.length < 3 || polygonArea2(inset) < 1e-3)
    throw new Error("Setbacks consume the entire plot");
  return { points: inset.points.map(frame.fromLocal) };
}
function permissibleSitePolygon(site) {
  if (site.orientation !== 0)
    throw new Error("Rotated north-angle site frames require an explicit surveyed transformation");
  return permissibleResidentialEnvelope(site.plotBoundary, site.setbacks, site.roadFacing);
}
function inscribedResidentialRectangle(p) {
  const exact = rectangularBounds(p);
  if (exact)
    return p;
  const b = polygonBoundingBox(p);
  let best, area = 0;
  for (let top = 0; top <= 6; top++)
    for (let bottom = 0; bottom <= 6; bottom++) {
      const y0 = b.y + b.height * top / 30, y1 = b.y + b.height * (1 - bottom / 30);
      const spans = [y0, y1].map((y) => {
        const xs = [];
        p.points.forEach((a, i) => {
          const c = p.points[(i + 1) % p.points.length];
          if (a.y === c.y) {
            if (y === a.y)
              xs.push(a.x, c.x);
          } else if (y >= Math.min(a.y, c.y) && y <= Math.max(a.y, c.y))
            xs.push(a.x + (y - a.y) * (c.x - a.x) / (c.y - a.y));
        });
        return [Math.min(...xs), Math.max(...xs)];
      });
      const x0 = Math.max(spans[0][0], spans[1][0]), x1 = Math.min(spans[0][1], spans[1][1]);
      if (x1 <= x0 || y1 <= y0)
        continue;
      const q = {
        points: [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 }
        ]
      };
      const next = polygonArea2(q);
      if (next > area && containsPolygon(p, q)) {
        best = q;
        area = next;
      }
    }
  if (!best)
    throw new Error("No inscribed structural rectangle");
  return best;
}
function residentialEnvelopeRemainder(outer, rectangle) {
  const b = rectangularBounds(rectangle);
  if (!b)
    throw new Error("Rectangle required");
  const cuts = [
    (p) => p.x - b.minX,
    (p) => b.maxX - p.x,
    (p) => p.y - b.minY,
    (p) => b.maxY - p.y
  ];
  let inside = outer;
  const pieces = [];
  for (const cut of cuts) {
    const outside = clipResidentialHalfPlane(inside, (p) => -cut(p));
    if (outside.points.length >= 3 && polygonArea2(outside) > 1e-3)
      pieces.push(outside);
    inside = clipResidentialHalfPlane(inside, cut);
  }
  return pieces;
}
var strictlyInside = (p, poly) => {
  let result = false;
  for (let i = 0, j = poly.points.length - 1; i < poly.points.length; j = i++) {
    const a = poly.points[i], b = poly.points[j];
    if (a.y > p.y !== b.y > p.y && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x)
      result = !result;
  }
  return result;
};
function uncoveredResidentialOverlap(a, b, solids) {
  const ab = polygonBoundingBox(a), bb = polygonBoundingBox(b);
  if (ab.x + ab.width <= bb.x || bb.x + bb.width <= ab.x || ab.y + ab.height <= bb.y || bb.y + bb.height <= ab.y)
    return 0;
  const relevant = solids.filter((p) => {
    const q = polygonBoundingBox(p);
    return q.x + q.width > ab.x && q.x < ab.x + ab.width && q.y + q.height > ab.y && q.y < ab.y + ab.height;
  });
  const cells = partitionPlanarCells([a, b, ...relevant]);
  if (!cells.supported)
    throw new Error("Unsupported clear-opening arrangement");
  return cells.cells.reduce((sum, c) => sum + (strictlyInside(c.point, a) && strictlyInside(c.point, b) && !relevant.some((p) => strictlyInside(c.point, p)) ? c.area : 0), 0);
}
function fitsResidentialBearingWalls(column, walls) {
  const bearing = walls.filter((w) => (w.loadBearing || w.wallUse === "EXTERNAL" || w.wallUse === "UNIT_SEPARATION") && w.thickness === column.width && w.thickness === column.depth);
  if (!bearing.length)
    return false;
  const solids = bearing.map(wallToPolygon);
  for (const wall of bearing)
    for (const end of [wall.startPoint, wall.endPoint]) {
      if (bearing.some((other) => other.id !== wall.id && [other.startPoint, other.endPoint].some((q) => q.x === end.x && q.y === end.y) && Math.abs((other.endPoint.x - other.startPoint.x) * (wall.endPoint.y - wall.startPoint.y) - (other.endPoint.y - other.startPoint.y) * (wall.endPoint.x - wall.startPoint.x)) > 1e-3))
        solids.push(columnFootprint({ ...column, position: end }));
    }
  const p = columnFootprint(column);
  return uncoveredResidentialOverlap(p, p, solids) < 1e-3;
}
function uncoveredResidentialSegments(source, covered) {
  const projection = projectOnSegment(source.start, source.start, source.end);
  if (!projection)
    return [];
  let intervals = [[0, projection.length]];
  for (const segment of covered) {
    const a = projectOnSegment(segment.start, source.start, source.end), b = projectOnSegment(segment.end, source.start, source.end);
    if (a.distance > 1e-7 || b.distance > 1e-7)
      continue;
    const lo = Math.min(a.along, b.along), hi = Math.max(a.along, b.along);
    intervals = intervals.flatMap(([start, end]) => hi <= start || lo >= end ? [[start, end]] : [
      ...lo > start ? [[start, lo]] : [],
      ...hi < end ? [[hi, end]] : []
    ]);
  }
  return intervals.filter(([a, b]) => b - a > 1e-6).map(([a, b]) => ({
    start: projection.pointAt(a),
    end: projection.pointAt(b)
  }));
}

// packages/geometry-engine/dist/architectural-solids.js
function proposeArchitecturalStair(room, host, rise, id, targetFlightWidth = 1200, targetRiser = 175, accessCenter) {
  const points = room.boundary.points;
  const x = Math.min(...points.map((p) => p.x)), y = Math.min(...points.map((p) => p.y));
  const w = Math.max(...points.map((p) => p.x)) - x, h = Math.max(...points.map((p) => p.y)) - y;
  if (points.length !== 4 || points.some((p) => ![x, x + w].includes(p.x) || ![y, y + h].includes(p.y)))
    throw new Error(`Unsupported stair enclosure: ${room.id}`);
  const horizontal = Math.abs(host.startPoint.y - host.endPoint.y) < 1e-3;
  const inset = host.thickness / 2, width = (horizontal ? w : h) - 2 * inset, depth = (horizontal ? h : w) - 2 * inset;
  const far = horizontal ? Math.abs(host.startPoint.y - (y + h)) < 1e-3 : Math.abs(host.startPoint.x - (x + w)) < 1e-3;
  const point = (u, v) => horizontal ? { x: x + inset + u, y: far ? y + h - inset - v : y + inset + v } : { x: far ? x + w - inset - v : x + inset + v, y: y + inset + u };
  const poly = (u, v, a, b) => ({
    points: [
      point(u, v),
      point(u + a, v),
      point(u + a, v + b),
      point(u, v + b)
    ]
  });
  const flightWidth = Math.min(targetFlightWidth, width / 2), landing = flightWidth;
  const riserCount = 2 * Math.ceil(rise / (2 * targetRiser)), count = riserCount / 2, run = depth - 2 * landing;
  if (!(run > 0 && count >= 2 && flightWidth > 0))
    throw new Error(`Stair flights and landings do not fit: ${room.id}`);
  const center = accessCenter ?? {
    x: (host.startPoint.x + host.endPoint.x) / 2,
    y: (host.startPoint.y + host.endPoint.y) / 2
  };
  const len = Math.hypot(host.endPoint.x - host.startPoint.x, host.endPoint.y - host.startPoint.y), ux = (host.endPoint.x - host.startPoint.x) / len, uy = (host.endPoint.y - host.startPoint.y) / len;
  return {
    id,
    floorId: room.floorId,
    polygon: room.boundary,
    flight1: poly(0, landing, flightWidth, run),
    flight2: poly(width - flightWidth, landing, flightWidth, run),
    midLanding: poly(0, depth - landing, width, landing),
    floorLanding: poly(0, -inset, width, landing + inset),
    riserCount,
    flightRiserCounts: [count, count],
    treadWidthMm: run / (count - 1),
    clearWidthMm: flightWidth,
    accessEdge: {
      type: "OPEN_PASSAGE",
      startPoint: { x: center.x - ux * 600, y: center.y - uy * 600 },
      endPoint: { x: center.x + ux * 600, y: center.y + uy * 600 }
    }
  };
}

// packages/geometry-engine/dist/architectural-validation.js
function inspectArchitecturalGeometry(building) {
  const issues = [];
  const openness = [];
  for (const f of building.floors) {
    if (!f.architecture)
      continue;
    const add = (code, elementId, severity = "ERROR") => issues.push({ code, floorId: f.id, elementId, severity });
    for (const r of f.rooms) {
      if (r.architecturalRole === "PARKING_BAY" && f.walls.some((w) => w.roomIds.length === 1 && w.roomIds.includes(r.id) && isPhysicalBoundary(w)))
        add("PARKING_BAY_ENCLOSED", r.id);
      if (r.architecturalRole === "BALCONY_SLAB") {
        if (!f.doors.some((d) => d.connectsRooms.includes(r.id) && d.connectsRooms.some((id) => id !== r.id && f.rooms.some((q) => q.id === id && q.unitId === r.unitId))))
          add("BALCONY_ACCESS_MISSING", r.id);
        add("BALCONY_DRAINAGE_AND_PROJECTION_REVIEW", r.id, "REVIEW_REQUIRED");
      }
      if (r.architecturalRole === "OPEN_TO_SKY_VOID" && !r.openToSky)
        add("VOID_FLAG_MISSING", r.id);
    }
    if (f.floorUse === "STILT_PARKING") {
      let openEdges = 0;
      const p = f.boundary.points;
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        const closed = f.walls.filter(isPhysicalBoundary).some((w) => {
          const u = projectOnSegment(w.startPoint, a, b), v = projectOnSegment(w.endPoint, a, b);
          return u && v && u.distance < 1e-3 && v.distance < 1e-3 && Math.min(u.length, Math.max(u.along, v.along)) - Math.max(0, Math.min(u.along, v.along)) > 1e-3;
        });
        if (!closed)
          openEdges++;
      }
      openness.push({ floorId: f.id, openEdges, perimeterEdges: p.length });
      if (p.length === 4 && openEdges < 2)
        add("STILT_OPEN_FACES_REQUIRE_REVIEW", f.id, "REVIEW_REQUIRED");
    }
    for (const stair of f.canonicalStaircases ?? []) {
      if (polygonArea2(stair.flight1) <= 0 || polygonArea2(stair.flight2) <= 0 || polygonArea2(stair.midLanding) <= 0 || !containsPolygon(f.boundary, stair.polygon))
        add("INVALID_STAIR_GEOMETRY", stair.id);
      const mid = {
        x: (stair.accessEdge.startPoint.x + stair.accessEdge.endPoint.x) / 2,
        y: (stair.accessEdge.startPoint.y + stair.accessEdge.endPoint.y) / 2
      };
      const blocked = f.walls.filter(isPhysicalBoundary).some((w) => {
        const p = projectOnSegment(mid, w.startPoint, w.endPoint);
        if (!p || p.distance > 1e-3 || p.along < 0 || p.along > p.length)
          return false;
        return !f.doors.some((d) => d.wallId === w.id && Math.hypot(d.position.x - mid.x, d.position.y - mid.y) < d.width / 2);
      });
      if (blocked)
        add("STAIR_EXIT_BLOCKED", stair.id);
      add("STAIR_HEADROOM_AND_FIRE_PROTECTION_REVIEW", stair.id, "REVIEW_REQUIRED");
    }
    if (f.floorUse === "ROOF" && f.architecture.drainage.status === "NOT_VERIFIED")
      add("ROOF_DRAINAGE_INPUT_REQUIRED", f.id, "REVIEW_REQUIRED");
  }
  return { issues, openness, statutoryStatus: "NOT_VERIFIED" };
}

// packages/constraint-engine/dist/types.js
var ConstraintSeverity;
(function(ConstraintSeverity2) {
  ConstraintSeverity2["HARD"] = "hard";
  ConstraintSeverity2["SOFT"] = "soft";
  ConstraintSeverity2["WARNING"] = "warning";
  ConstraintSeverity2["INFORMATIONAL"] = "informational";
})(ConstraintSeverity || (ConstraintSeverity = {}));
var ConstraintCategory;
(function(ConstraintCategory2) {
  ConstraintCategory2["GEOMETRY"] = "geometry";
  ConstraintCategory2["PROGRAM"] = "program";
  ConstraintCategory2["ACCESSIBILITY"] = "accessibility";
  ConstraintCategory2["CIRCULATION"] = "circulation";
  ConstraintCategory2["DAYLIGHT"] = "daylight";
  ConstraintCategory2["PRIVACY"] = "privacy";
  ConstraintCategory2["FUNCTIONAL_ZONING"] = "functional_zoning";
  ConstraintCategory2["STRUCTURAL"] = "structural";
  ConstraintCategory2["VASTU"] = "vastu";
  ConstraintCategory2["REGULATORY"] = "regulatory";
  ConstraintCategory2["USER_PREFERENCE"] = "user_preference";
})(ConstraintCategory || (ConstraintCategory = {}));
var EvaluationStatus;
(function(EvaluationStatus2) {
  EvaluationStatus2["PASS"] = "PASS";
  EvaluationStatus2["FAIL"] = "FAIL";
  EvaluationStatus2["WARNING"] = "WARNING";
  EvaluationStatus2["NOT_APPLICABLE"] = "NOT_APPLICABLE";
  EvaluationStatus2["NOT_ANALYZED"] = "NOT_ANALYZED";
  EvaluationStatus2["NOT_CHECKED"] = "NOT_CHECKED";
  EvaluationStatus2["INSUFFICIENT_INPUT"] = "INSUFFICIENT_INPUT";
  EvaluationStatus2["NOT_IMPLEMENTED"] = "NOT_IMPLEMENTED";
})(EvaluationStatus || (EvaluationStatus = {}));

// packages/constraint-engine/dist/constraints/hard/plot-containment.js
var RoomContainment = {
  id: "HC-001",
  name: "Room Containment",
  description: "Every room boundary must be fully inside its floor boundary",
  category: ConstraintCategory.GEOMETRY,
  severity: ConstraintSeverity.HARD,
  enabled: true,
  evaluate(context) {
    const results = [];
    for (const floor of context.building.floors) {
      if (floor.boundary.points.length < 3)
        continue;
      for (const room of floor.rooms) {
        if (room.boundary.points.length < 3)
          continue;
        const contained = containsPolygon(floor.boundary, room.boundary);
        if (!contained) {
          const fix = {
            description: `Move or resize "${room.name}" to fit within the floor boundary`,
            actionType: "move",
            targetEntity: room.id,
            priority: 1
          };
          results.push({
            constraintId: "HC-001",
            passed: false,
            severity: ConstraintSeverity.HARD,
            score: 0,
            maxScore: 0,
            message: `Room "${room.name}" extends outside the floor boundary on "${floor.name}"`,
            affectedEntities: [room.id],
            explanation: `The boundary of "${room.name}" is not fully contained within the "${floor.name}" boundary. This makes the plan structurally invalid. Move or resize the room so it fits entirely within the buildable area.`,
            suggestedFixes: [fix]
          });
        }
      }
    }
    if (results.length === 0) {
      results.push({
        constraintId: "HC-001",
        passed: true,
        severity: ConstraintSeverity.HARD,
        score: 0,
        maxScore: 0,
        message: "All rooms are contained within their floor boundaries",
        affectedEntities: [],
        explanation: "All room boundaries are fully inside their respective floor boundaries."
      });
    }
    return results;
  }
};
var FloorContainment = {
  id: "HC-002",
  name: "Floor Containment",
  description: "Every floor boundary must be inside the buildable envelope (plot minus setbacks)",
  category: ConstraintCategory.GEOMETRY,
  severity: ConstraintSeverity.HARD,
  enabled: true,
  evaluate(context) {
    const results = [];
    for (const floor of context.building.floors) {
      if (floor.boundary.points.length < 3)
        continue;
      if (context.buildableEnvelope.points.length < 3)
        continue;
      const contained = containsPolygon(context.buildableEnvelope, floor.boundary);
      if (!contained) {
        results.push({
          constraintId: "HC-002",
          passed: false,
          severity: ConstraintSeverity.HARD,
          score: 0,
          maxScore: 0,
          message: `Floor "${floor.name}" extends outside the buildable area (plot minus setbacks)`,
          affectedEntities: [floor.id],
          explanation: `The "${floor.name}" boundary exceeds the buildable envelope defined by plot dimensions minus required setbacks. Reduce the floor footprint to respect setback requirements.`,
          suggestedFixes: [{
            description: `Reduce floor footprint to fit within setback limits`,
            actionType: "resize",
            targetEntity: floor.id,
            priority: 1
          }]
        });
      }
    }
    if (results.length === 0) {
      results.push({
        constraintId: "HC-002",
        passed: true,
        severity: ConstraintSeverity.HARD,
        score: 0,
        maxScore: 0,
        message: "All floors are within the buildable envelope",
        affectedEntities: [],
        explanation: "All floor boundaries respect the required setback distances from plot edges."
      });
    }
    return results;
  }
};

// packages/constraint-engine/dist/constraints/hard/room-overlap.js
var NoIllegalOverlap = {
  id: "HC-003",
  name: "No Illegal Overlap",
  description: "No two rooms on the same floor may overlap beyond tolerance",
  category: ConstraintCategory.GEOMETRY,
  severity: ConstraintSeverity.HARD,
  enabled: true,
  evaluate(context) {
    const results = [];
    for (const floor of context.building.floors) {
      const rooms = floor.rooms;
      for (let i = 0; i < rooms.length; i++) {
        for (let j = i + 1; j < rooms.length; j++) {
          const a = rooms[i];
          const b = rooms[j];
          const overlapArea = polygonIntersectionArea(a.boundary, b.boundary);
          if (overlapArea > TOLERANCES.OVERLAP) {
            const sqFt = sqMmToSqFt(overlapArea);
            results.push({
              constraintId: "HC-003",
              passed: false,
              severity: ConstraintSeverity.HARD,
              score: 0,
              maxScore: 0,
              message: `"${a.name}" overlaps "${b.name}" by approximately ${sqFt.toFixed(1)} sq ft`,
              affectedEntities: [a.id, b.id],
              explanation: `The boundary of "${a.name}" intersects with the boundary of "${b.name}". The overlapping region has an area of approximately ${sqFt.toFixed(1)} sq ft (${Math.round(overlapArea)} sq mm). Move one of the rooms so their boundaries do not overlap.`,
              suggestedFixes: [
                {
                  description: `Move "${b.name}" away from "${a.name}" to eliminate overlap`,
                  actionType: "move",
                  targetEntity: b.id,
                  priority: 1
                }
              ]
            });
          }
        }
      }
    }
    if (results.length === 0) {
      results.push({
        constraintId: "HC-003",
        passed: true,
        severity: ConstraintSeverity.HARD,
        score: 0,
        maxScore: 0,
        message: "No rooms overlap",
        affectedEntities: [],
        explanation: "All rooms have non-overlapping boundaries."
      });
    }
    return results;
  }
};

// packages/constraint-engine/dist/constraints/hard/geometry-validity.js
var ValidPolygons = {
  id: "HC-004",
  name: "Valid Polygons",
  description: "All room and floor boundaries must be valid closed polygons",
  category: ConstraintCategory.GEOMETRY,
  severity: ConstraintSeverity.HARD,
  enabled: true,
  evaluate(context) {
    const results = [];
    for (const floor of context.building.floors) {
      for (const room of floor.rooms) {
        if (!isValidPolygon(room.boundary)) {
          results.push({
            constraintId: "HC-004",
            passed: false,
            severity: ConstraintSeverity.HARD,
            score: 0,
            maxScore: 0,
            message: `Room "${room.name}" has an invalid boundary polygon`,
            affectedEntities: [room.id],
            explanation: `The boundary of "${room.name}" is not a valid closed polygon. It may have fewer than 3 points, self-intersections, or zero area. Correct the room geometry.`,
            suggestedFixes: [{
              description: `Correct the boundary polygon of "${room.name}"`,
              actionType: "resize",
              targetEntity: room.id,
              priority: 1
            }]
          });
        }
      }
    }
    if (results.length === 0) {
      results.push({
        constraintId: "HC-004",
        passed: true,
        severity: ConstraintSeverity.HARD,
        score: 0,
        maxScore: 0,
        message: "All boundaries are valid polygons",
        affectedEntities: [],
        explanation: "All room and floor boundary polygons are geometrically valid."
      });
    }
    return results;
  }
};
var PositiveArea = {
  id: "HC-005",
  name: "Positive Area",
  description: "All rooms must have area greater than zero",
  category: ConstraintCategory.GEOMETRY,
  severity: ConstraintSeverity.HARD,
  enabled: true,
  evaluate(context) {
    const results = [];
    for (const floor of context.building.floors) {
      for (const room of floor.rooms) {
        if (room.area <= 0) {
          results.push({
            constraintId: "HC-005",
            passed: false,
            severity: ConstraintSeverity.HARD,
            score: 0,
            maxScore: 0,
            message: `Room "${room.name}" has non-positive area (${room.area} sq mm)`,
            affectedEntities: [room.id],
            explanation: `"${room.name}" has an area of ${room.area} sq mm, which is zero or negative. Rooms must have positive width and height to be valid.`,
            suggestedFixes: [{
              description: `Set positive dimensions for "${room.name}"`,
              actionType: "resize",
              targetEntity: room.id,
              priority: 1
            }]
          });
        }
      }
    }
    if (results.length === 0) {
      results.push({
        constraintId: "HC-005",
        passed: true,
        severity: ConstraintSeverity.HARD,
        score: 0,
        maxScore: 0,
        message: "All rooms have positive area",
        affectedEntities: [],
        explanation: "Every room has a valid positive area."
      });
    }
    return results;
  }
};
var WallIntegrity = {
  id: "HC-006",
  name: "Wall Integrity",
  description: "All walls must have non-zero length and valid thickness",
  category: ConstraintCategory.GEOMETRY,
  severity: ConstraintSeverity.HARD,
  enabled: true,
  evaluate(context) {
    const results = [];
    for (const floor of context.building.floors) {
      for (const wall of floor.walls) {
        const len = segmentLength({ start: wall.startPoint, end: wall.endPoint });
        if (len < TOLERANCES.LINEAR) {
          results.push({
            constraintId: "HC-006",
            passed: false,
            severity: ConstraintSeverity.HARD,
            score: 0,
            maxScore: 0,
            message: `A wall on "${floor.name}" has zero length`,
            affectedEntities: [wall.id],
            explanation: `Wall ${wall.id} has a length of ${len.toFixed(1)} mm, which is below the minimum threshold. Correct the wall endpoints.`,
            suggestedFixes: [{
              description: "Remove the zero-length wall or correct its endpoints",
              actionType: "remove",
              targetEntity: wall.id,
              priority: 2
            }]
          });
        }
        if (wall.thickness <= 0) {
          results.push({
            constraintId: "HC-006",
            passed: false,
            severity: ConstraintSeverity.HARD,
            score: 0,
            maxScore: 0,
            message: `A wall on "${floor.name}" has invalid thickness (${wall.thickness} mm)`,
            affectedEntities: [wall.id],
            explanation: `Wall ${wall.id} has thickness ${wall.thickness} mm. Walls must have positive thickness.`,
            suggestedFixes: [{
              description: "Set a valid wall thickness (e.g., 150mm for internal)",
              actionType: "resize",
              targetEntity: wall.id,
              priority: 2
            }]
          });
        }
      }
    }
    if (results.length === 0) {
      results.push({
        constraintId: "HC-006",
        passed: true,
        severity: ConstraintSeverity.HARD,
        score: 0,
        maxScore: 0,
        message: "All walls have valid geometry",
        affectedEntities: [],
        explanation: "All walls have non-zero length and valid thickness."
      });
    }
    return results;
  }
};

// packages/constraint-engine/dist/constraints/hard/required-rooms.js
var RequiredRoomsPresent = {
  id: "HC-020",
  name: "Required Rooms Present",
  description: "All user-required room types must exist in the building",
  category: ConstraintCategory.PROGRAM,
  severity: ConstraintSeverity.HARD,
  enabled: true,
  evaluate(context) {
    const results = [];
    const requiredCounts = {
      ...Object.fromEntries(context.requiredRoomTypes.map((type) => [type, 1])),
      ...context.requiredRoomCounts
    };
    if (Object.keys(requiredCounts).length === 0) {
      results.push({
        constraintId: "HC-020",
        passed: true,
        severity: ConstraintSeverity.HARD,
        score: 0,
        maxScore: 0,
        message: "No required room types specified",
        affectedEntities: [],
        explanation: "No specific room types were required for this plan."
      });
      return results;
    }
    const presentCounts = /* @__PURE__ */ new Map();
    for (const floor of context.building.floors) {
      for (const room of floor.rooms) {
        presentCounts.set(room.type, (presentCounts.get(room.type) ?? 0) + 1);
      }
    }
    for (const [requiredType, rawRequiredCount] of Object.entries(requiredCounts)) {
      const requiredCount = Math.max(0, Math.floor(rawRequiredCount ?? 0));
      const presentCount = presentCounts.get(requiredType) ?? 0;
      if (presentCount < requiredCount) {
        const missingCount = requiredCount - presentCount;
        results.push({
          constraintId: "HC-020",
          passed: false,
          severity: ConstraintSeverity.HARD,
          score: 0,
          maxScore: 0,
          message: presentCount === 0 ? `Required room type "${requiredType}" is missing from the plan (0 of ${requiredCount} present)` : `Plan has ${presentCount} of ${requiredCount} required "${requiredType}" spaces`,
          affectedEntities: [],
          explanation: `The normalized room program requires ${requiredCount} "${requiredType}" spaces, but the plan contains ${presentCount}. Add ${missingCount} more.`,
          suggestedFixes: [{
            description: `Add ${missingCount} "${requiredType}" ${missingCount === 1 ? "space" : "spaces"} to the plan`,
            actionType: "add",
            priority: 1,
            parameters: { roomType: requiredType, missingCount }
          }]
        });
      }
    }
    if (results.length === 0) {
      results.push({
        constraintId: "HC-020",
        passed: true,
        severity: ConstraintSeverity.HARD,
        score: 0,
        maxScore: 0,
        message: "All required room types are present",
        affectedEntities: [],
        explanation: "Every required room type has at least one instance in the building."
      });
    }
    return results;
  }
};

// packages/constraint-engine/dist/helpers/connectivity.js
var OUTSIDE_NODE = "__outside__";
function buildConnectivityGraph(floor) {
  const nodes = /* @__PURE__ */ new Set();
  const edges = /* @__PURE__ */ new Map();
  for (const room of floor.rooms) {
    nodes.add(room.id);
    edges.set(room.id, /* @__PURE__ */ new Set());
  }
  nodes.add(OUTSIDE_NODE);
  edges.set(OUTSIDE_NODE, /* @__PURE__ */ new Set());
  for (const door of floor.doors) {
    const [roomA, roomB] = door.connectsRooms;
    const isOutsideA = !roomA || roomA === "" || roomA === "outside" || roomA === OUTSIDE_NODE;
    const isOutsideB = !roomB || roomB === "" || roomB === "outside" || roomB === OUTSIDE_NODE;
    if (isOutsideA && !isOutsideB && roomB) {
      if (edges.has(roomB)) {
        edges.get(OUTSIDE_NODE).add(roomB);
        edges.get(roomB).add(OUTSIDE_NODE);
      }
    } else if (isOutsideB && !isOutsideA && roomA) {
      if (edges.has(roomA)) {
        edges.get(OUTSIDE_NODE).add(roomA);
        edges.get(roomA).add(OUTSIDE_NODE);
      }
    } else if (roomA && roomB) {
      if (edges.has(roomA) && edges.has(roomB)) {
        edges.get(roomA).add(roomB);
        edges.get(roomB).add(roomA);
      }
    }
  }
  return { nodes, edges };
}
function findUnreachableRooms(floor) {
  if (floor.doors.length === 0) {
    return floor.rooms.map((room) => room.id);
  }
  const graph = buildConnectivityGraph(floor);
  const visited = /* @__PURE__ */ new Set();
  const queue = [OUTSIDE_NODE];
  visited.add(OUTSIDE_NODE);
  while (queue.length > 0) {
    const current = queue.shift();
    const neighbors = graph.edges.get(current) ?? /* @__PURE__ */ new Set();
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  const unreachable = [];
  for (const room of floor.rooms) {
    if (!visited.has(room.id)) {
      unreachable.push(room.id);
    }
  }
  return unreachable;
}
function doorTransitionsToRoom(floor, roomId) {
  if (floor.doors.length === 0)
    return Infinity;
  const graph = buildConnectivityGraph(floor);
  const distances = /* @__PURE__ */ new Map();
  const queue = [OUTSIDE_NODE];
  distances.set(OUTSIDE_NODE, 0);
  while (queue.length > 0) {
    const current = queue.shift();
    const currentDist = distances.get(current);
    const neighbors = graph.edges.get(current) ?? /* @__PURE__ */ new Set();
    for (const neighbor of neighbors) {
      if (!distances.has(neighbor)) {
        distances.set(neighbor, currentDist + 1);
        queue.push(neighbor);
      }
    }
  }
  return distances.get(roomId) ?? Infinity;
}

// packages/constraint-engine/dist/constraints/hard/accessibility.js
var RoomAccessibility = {
  id: "HC-010",
  name: "Room Accessibility",
  description: "Every room must be reachable from the entrance via doors",
  category: ConstraintCategory.ACCESSIBILITY,
  severity: ConstraintSeverity.HARD,
  enabled: true,
  evaluate(context) {
    const results = [];
    for (const floor of context.building.floors) {
      if (floor.rooms.length === 0)
        continue;
      if (context.allowIncompleteDraft && floor.doors.length === 0)
        continue;
      const unreachable = findUnreachableRooms(floor);
      for (const roomId of unreachable) {
        const room = floor.rooms.find((r) => r.id === roomId);
        const roomName = room?.name ?? roomId;
        results.push({
          constraintId: "HC-010",
          passed: false,
          severity: ConstraintSeverity.HARD,
          score: 0,
          maxScore: 0,
          message: `"${roomName}" is not reachable from the entrance`,
          affectedEntities: [roomId],
          explanation: `"${roomName}" on "${floor.name}" has no path connecting it to the entrance through doors. Add a door connecting this room to an adjacent accessible room.`,
          suggestedFixes: [{
            description: `Add a door connecting "${roomName}" to an adjacent accessible space`,
            actionType: "add",
            targetEntity: roomId,
            priority: 1
          }]
        });
      }
    }
    if (results.length === 0) {
      results.push({
        constraintId: "HC-010",
        passed: true,
        severity: ConstraintSeverity.HARD,
        score: 0,
        maxScore: 0,
        message: "All rooms are accessible",
        affectedEntities: [],
        explanation: "Every room is reachable from the entrance via doors."
      });
    }
    return results;
  }
};
var CorridorWidth = {
  id: "HC-013",
  name: "Corridor Width",
  description: "Every corridor must meet minimum width requirement",
  category: ConstraintCategory.ACCESSIBILITY,
  severity: ConstraintSeverity.HARD,
  enabled: true,
  evaluate(context) {
    const results = [];
    const minWidth = context.config.minimumCorridorWidth;
    for (const floor of context.building.floors) {
      for (const room of floor.rooms) {
        if (room.type !== RoomType.Corridor)
          continue;
        const smallestDim = Math.min(room.width, room.height);
        if (smallestDim < minWidth) {
          results.push({
            constraintId: "HC-013",
            passed: false,
            severity: ConstraintSeverity.HARD,
            score: 0,
            maxScore: 0,
            message: `Corridor "${room.name}" is too narrow (${smallestDim} mm, minimum: ${minWidth} mm)`,
            affectedEntities: [room.id],
            explanation: `"${room.name}" has a minimum dimension of ${smallestDim} mm, which is below the required ${minWidth} mm for corridors. Widen the corridor to meet accessibility requirements.`,
            suggestedFixes: [{
              description: `Widen "${room.name}" to at least ${minWidth} mm`,
              actionType: "resize",
              targetEntity: room.id,
              priority: 2
            }]
          });
        }
      }
    }
    if (results.length === 0) {
      results.push({
        constraintId: "HC-013",
        passed: true,
        severity: ConstraintSeverity.HARD,
        score: 0,
        maxScore: 0,
        message: "All corridors meet minimum width",
        affectedEntities: [],
        explanation: "All corridors have adequate width for circulation."
      });
    }
    return results;
  }
};

// packages/constraint-engine/dist/constraints/hard/door-validity.js
var OUTSIDE_IDS = /* @__PURE__ */ new Set(["", "outside", "__outside__"]);
function isFinitePoint(value) {
  if (!value || typeof value !== "object")
    return false;
  const point = value;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
var DoorOnWall = {
  id: "HC-011",
  name: "Door On Wall",
  description: "Every door must be placed on an existing wall",
  category: ConstraintCategory.GEOMETRY,
  severity: ConstraintSeverity.HARD,
  enabled: true,
  evaluate(context) {
    const results = [];
    for (const floor of context.building.floors) {
      if (floor.doors.length === 0)
        continue;
      const wallsById = new Map(floor.walls.map((wall) => [wall.id, wall]));
      const roomIds = new Set(floor.rooms.map((room) => room.id));
      for (const door of floor.doors) {
        const wall = wallsById.get(door.wallId);
        if (!wall) {
          results.push({
            constraintId: "HC-011",
            passed: false,
            severity: ConstraintSeverity.HARD,
            score: 0,
            maxScore: 0,
            message: `A door on "${floor.name}" references a non-existent wall`,
            affectedEntities: [door.id],
            explanation: `Door ${door.id} references wall "${door.wallId}" which does not exist on "${floor.name}". The door must be placed on a valid wall segment.`,
            suggestedFixes: [{
              description: "Place the door on an existing wall between the connected rooms",
              actionType: "move",
              targetEntity: door.id,
              priority: 1
            }]
          });
          continue;
        }
        if (door.floorId !== floor.id || wall.floorId !== floor.id) {
          results.push({
            constraintId: "HC-011",
            passed: false,
            severity: ConstraintSeverity.HARD,
            score: 0,
            maxScore: 0,
            message: `Door "${door.id}" has inconsistent floor references`,
            affectedEntities: [door.id, wall.id],
            explanation: `The door, host wall, and containing floor must all reference "${floor.id}".`,
            suggestedFixes: [{
              description: "Move the door to a wall on the same floor",
              actionType: "move",
              targetEntity: door.id,
              priority: 1
            }]
          });
        }
        const [fromRoomId, toRoomId] = door.connectsRooms;
        const fromOutside = OUTSIDE_IDS.has(fromRoomId);
        const toOutside = OUTSIDE_IDS.has(toRoomId);
        const invalidEndpoints = fromRoomId === toRoomId || fromOutside && toOutside || !fromOutside && !roomIds.has(fromRoomId) || !toOutside && !roomIds.has(toRoomId);
        if (invalidEndpoints) {
          results.push({
            constraintId: "HC-011",
            passed: false,
            severity: ConstraintSeverity.HARD,
            score: 0,
            maxScore: 0,
            message: `Door "${door.id}" does not connect two valid spaces`,
            affectedEntities: [door.id],
            explanation: "A door must connect two different rooms, or exactly one room and the outside. Both room references must exist on the same floor.",
            suggestedFixes: [{
              description: "Assign the door to the actual spaces on both sides of its host wall",
              actionType: "move",
              targetEntity: door.id,
              priority: 1
            }]
          });
        }
        if (!isFinitePoint(door.position)) {
          results.push({
            constraintId: "HC-011",
            passed: false,
            severity: ConstraintSeverity.HARD,
            score: 0,
            maxScore: 0,
            message: `Door "${door.id}" has an invalid position`,
            affectedEntities: [door.id],
            explanation: "Door position must be a finite {x, y} coordinate on its host wall.",
            suggestedFixes: [{
              description: "Place the door at a valid coordinate on its host wall",
              actionType: "move",
              targetEntity: door.id,
              priority: 1
            }]
          });
          continue;
        }
        const placement = validateDoorPlacement(door, wall);
        if (!placement.valid) {
          results.push({
            constraintId: "HC-011",
            passed: false,
            severity: ConstraintSeverity.HARD,
            score: 0,
            maxScore: 0,
            message: `Door "${door.id}" is not valid on its host wall`,
            affectedEntities: [door.id, wall.id],
            explanation: placement.reason ?? "The door opening does not fit on its host wall.",
            suggestedFixes: [{
              description: "Move or resize the door so it fits entirely on its host wall",
              actionType: "move",
              targetEntity: door.id,
              priority: 1
            }]
          });
        }
      }
    }
    if (results.length === 0) {
      results.push({
        constraintId: "HC-011",
        passed: true,
        severity: ConstraintSeverity.HARD,
        score: 0,
        maxScore: 0,
        message: "All doors are placed on valid walls",
        affectedEntities: [],
        explanation: "Every door references an existing wall, fits on that wall, and connects valid spaces on the same floor."
      });
    }
    return results;
  }
};
var DoorClearance = {
  id: "HC-012",
  name: "Door Swing Clearance",
  description: "Door swing arc should not be blocked",
  category: ConstraintCategory.ACCESSIBILITY,
  severity: ConstraintSeverity.WARNING,
  enabled: true,
  evaluate(_context) {
    return [{
      constraintId: "HC-012",
      passed: true,
      severity: ConstraintSeverity.WARNING,
      score: 10,
      maxScore: 10,
      message: "Door swing clearance not fully validated in this phase",
      affectedEntities: [],
      explanation: "Door swing clearance requires full wall polygon data. Deferred to interactive editor validation."
    }];
  }
};

// packages/constraint-engine/dist/constraints/hard/window-validity.js
function isFinitePoint2(value) {
  if (!value || typeof value !== "object")
    return false;
  const point = value;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
var WindowOnWall = {
  id: "HC-015",
  name: "Window On Wall",
  description: "Every window must be placed on an existing wall",
  category: ConstraintCategory.GEOMETRY,
  severity: ConstraintSeverity.HARD,
  enabled: true,
  evaluate(context) {
    const results = [];
    for (const floor of context.building.floors) {
      if (floor.windows.length === 0)
        continue;
      const wallsById = new Map(floor.walls.map((wall) => [wall.id, wall]));
      const roomIds = new Set(floor.rooms.map((room) => room.id));
      for (const win of floor.windows) {
        const wall = wallsById.get(win.wallId);
        if (!wall) {
          results.push({
            constraintId: "HC-015",
            passed: false,
            severity: ConstraintSeverity.HARD,
            score: 0,
            maxScore: 0,
            message: `A window on "${floor.name}" references a non-existent wall`,
            affectedEntities: [win.id],
            explanation: `Window ${win.id} references wall "${win.wallId}" which does not exist on "${floor.name}". Place the window on a valid external wall.`,
            suggestedFixes: [{
              description: "Place the window on an existing external wall",
              actionType: "move",
              targetEntity: win.id,
              priority: 2
            }]
          });
          continue;
        }
        if (win.floorId !== floor.id || wall.floorId !== floor.id || !roomIds.has(win.roomId)) {
          results.push({
            constraintId: "HC-015",
            passed: false,
            severity: ConstraintSeverity.HARD,
            score: 0,
            maxScore: 0,
            message: `Window "${win.id}" has invalid floor or room references`,
            affectedEntities: [win.id, wall.id],
            explanation: "The window, its host wall, and its room must all exist on the same floor.",
            suggestedFixes: [{
              description: "Attach the window to an existing room and wall on the same floor",
              actionType: "move",
              targetEntity: win.id,
              priority: 2
            }]
          });
        }
        if (!isFinitePoint2(win.position)) {
          results.push({
            constraintId: "HC-015",
            passed: false,
            severity: ConstraintSeverity.HARD,
            score: 0,
            maxScore: 0,
            message: `Window "${win.id}" has an invalid position`,
            affectedEntities: [win.id],
            explanation: "Window position must be a finite {x, y} coordinate on its host wall.",
            suggestedFixes: [{
              description: "Place the window at a valid coordinate on its host wall",
              actionType: "move",
              targetEntity: win.id,
              priority: 2
            }]
          });
          continue;
        }
        const placement = validateWindowPlacement(win, wall);
        if (!placement.valid) {
          results.push({
            constraintId: "HC-015",
            passed: false,
            severity: ConstraintSeverity.HARD,
            score: 0,
            maxScore: 0,
            message: `Window "${win.id}" is not valid on its host wall`,
            affectedEntities: [win.id, wall.id],
            explanation: placement.reason ?? "The window opening does not fit on its host wall.",
            suggestedFixes: [{
              description: "Move or resize the window so it fits on an external wall",
              actionType: "move",
              targetEntity: win.id,
              priority: 2
            }]
          });
        }
      }
    }
    if (results.length === 0) {
      results.push({
        constraintId: "HC-015",
        passed: true,
        severity: ConstraintSeverity.HARD,
        score: 0,
        maxScore: 0,
        message: "All windows are placed on valid walls",
        affectedEntities: [],
        explanation: "Every window references an existing room and external wall, and fits on that wall on the same floor."
      });
    }
    return results;
  }
};

// packages/constraint-engine/dist/constraints/hard/stair-validity.js
var StairConnectivity = {
  id: "HC-014",
  name: "Stair Connectivity",
  description: "Stairs must connect two existing consecutive floor levels",
  category: ConstraintCategory.ACCESSIBILITY,
  severity: ConstraintSeverity.HARD,
  enabled: true,
  evaluate(context) {
    const results = [];
    const floorLevels = new Set(context.building.floors.map((f) => f.level));
    for (const floor of context.building.floors) {
      for (const stair of floor.stairs) {
        const [fromLevel, toLevel] = stair.connectsFloors;
        if (!floorLevels.has(fromLevel) || !floorLevels.has(toLevel)) {
          results.push({
            constraintId: "HC-014",
            passed: false,
            severity: ConstraintSeverity.HARD,
            score: 0,
            maxScore: 0,
            message: `Staircase on "${floor.name}" connects to a non-existent floor level`,
            affectedEntities: [stair.id],
            explanation: `Staircase ${stair.id} declares connection between levels ${fromLevel} and ${toLevel}, but one or both levels do not exist in the building. Ensure both connected floors exist.`,
            suggestedFixes: [{
              description: "Add the missing floor level or correct the stair connection",
              actionType: "add",
              priority: 1
            }]
          });
        } else if (Math.abs(toLevel - fromLevel) !== 1) {
          results.push({
            constraintId: "HC-014",
            passed: false,
            severity: ConstraintSeverity.HARD,
            score: 0,
            maxScore: 0,
            message: `Staircase on "${floor.name}" connects non-consecutive floors (${fromLevel} to ${toLevel})`,
            affectedEntities: [stair.id],
            explanation: `Staircase ${stair.id} connects level ${fromLevel} to level ${toLevel}, which are not consecutive. Standard stairs connect adjacent floor levels.`,
            suggestedFixes: [{
              description: "Connect the staircase to consecutive floor levels",
              actionType: "reorient",
              targetEntity: stair.id,
              priority: 1
            }]
          });
        }
      }
    }
    if (results.length === 0) {
      results.push({
        constraintId: "HC-014",
        passed: true,
        severity: ConstraintSeverity.HARD,
        score: 0,
        maxScore: 0,
        message: "All stairs connect valid consecutive floors",
        affectedEntities: [],
        explanation: "Every staircase connects two existing consecutive floor levels."
      });
    }
    return results;
  }
};
var StairDimensions = {
  id: "HC-016",
  name: "Stair Dimensions",
  description: "Stair width and riser height must meet minimum requirements",
  category: ConstraintCategory.GEOMETRY,
  severity: ConstraintSeverity.HARD,
  enabled: true,
  evaluate(context) {
    const results = [];
    const MIN_STAIR_WIDTH = 900;
    const MAX_RISER_HEIGHT = 200;
    for (const floor of context.building.floors) {
      for (const stair of floor.stairs) {
        if (stair.width < MIN_STAIR_WIDTH) {
          results.push({
            constraintId: "HC-016",
            passed: false,
            severity: ConstraintSeverity.HARD,
            score: 0,
            maxScore: 0,
            message: `Staircase on "${floor.name}" is too narrow (${stair.width} mm, minimum: ${MIN_STAIR_WIDTH} mm)`,
            affectedEntities: [stair.id],
            explanation: `Staircase width is ${stair.width} mm but the minimum required width is ${MIN_STAIR_WIDTH} mm for safe passage.`,
            suggestedFixes: [{
              description: `Widen staircase to at least ${MIN_STAIR_WIDTH} mm`,
              actionType: "resize",
              targetEntity: stair.id,
              priority: 1
            }]
          });
        }
        if (stair.riserHeight > MAX_RISER_HEIGHT) {
          results.push({
            constraintId: "HC-016",
            passed: false,
            severity: ConstraintSeverity.HARD,
            score: 0,
            maxScore: 0,
            message: `Staircase on "${floor.name}" has excessive riser height (${stair.riserHeight} mm, maximum: ${MAX_RISER_HEIGHT} mm)`,
            affectedEntities: [stair.id],
            explanation: `Riser height is ${stair.riserHeight} mm but should not exceed ${MAX_RISER_HEIGHT} mm for comfort and safety.`,
            suggestedFixes: [{
              description: `Reduce riser height to ${MAX_RISER_HEIGHT} mm or less (add more risers)`,
              actionType: "resize",
              targetEntity: stair.id,
              priority: 2
            }]
          });
        }
      }
    }
    if (results.length === 0) {
      results.push({
        constraintId: "HC-016",
        passed: true,
        severity: ConstraintSeverity.HARD,
        score: 0,
        maxScore: 0,
        message: "All stairs meet dimension requirements",
        affectedEntities: [],
        explanation: "All staircase widths and riser heights are within acceptable limits."
      });
    }
    return results;
  }
};

// packages/constraint-engine/dist/constraints/hard/floor-consistency.js
var FloorRoomConsistency = {
  id: "HC-030",
  name: "Floor Entity Consistency",
  description: "Every entity must belong to and reference entities on its parent floor",
  category: ConstraintCategory.PROGRAM,
  severity: ConstraintSeverity.HARD,
  enabled: true,
  evaluate(context) {
    const results = [];
    for (const floor of context.building.floors) {
      const roomIds = new Set(floor.rooms.map((room) => room.id));
      const wallIds = new Set(floor.walls.map((wall) => wall.id));
      const collections = [floor.rooms, floor.walls, floor.doors, floor.windows, floor.stairs, floor.columns];
      for (const entities of collections) {
        for (const entity of entities) {
          if (entity.floorId === floor.id)
            continue;
          results.push({
            constraintId: "HC-030",
            passed: false,
            severity: ConstraintSeverity.HARD,
            score: 0,
            maxScore: 0,
            message: `Entity "${entity.id}" has mismatched floorId (expected "${floor.id}", found "${entity.floorId}")`,
            affectedEntities: [entity.id],
            explanation: `The entity is listed on "${floor.name}" but its floorId points to a different floor.`,
            suggestedFixes: [{
              description: `Correct the entity floorId to "${floor.id}"`,
              actionType: "move",
              targetEntity: entity.id,
              priority: 3
            }]
          });
        }
      }
      const addReferenceFailure = (entityId, reference, kind) => {
        results.push({
          constraintId: "HC-030",
          passed: false,
          severity: ConstraintSeverity.HARD,
          score: 0,
          maxScore: 0,
          message: `${kind} "${entityId}" references "${reference}" outside "${floor.name}"`,
          affectedEntities: [entityId],
          explanation: `Reference "${reference}" cannot be resolved within the parent floor.`,
          suggestedFixes: [{ description: "Repair or remove the cross-floor reference", actionType: "move", targetEntity: entityId, priority: 3 }]
        });
      };
      for (const wall of floor.walls) {
        (wall.roomIds ?? []).filter((roomId) => !roomIds.has(roomId)).forEach((roomId) => addReferenceFailure(wall.id, roomId, "Wall"));
      }
      for (const door of floor.doors) {
        if (!wallIds.has(door.wallId))
          addReferenceFailure(door.id, door.wallId, "Door");
        (door.connectsRooms ?? []).filter((roomId) => roomId !== "" && roomId !== "exterior" && roomId !== "__outside__" && !roomIds.has(roomId)).forEach((roomId) => addReferenceFailure(door.id, roomId, "Door"));
      }
      for (const window of floor.windows) {
        if (!wallIds.has(window.wallId))
          addReferenceFailure(window.id, window.wallId, "Window");
        if (!roomIds.has(window.roomId))
          addReferenceFailure(window.id, window.roomId, "Window");
      }
    }
    if (results.length === 0) {
      results.push({
        constraintId: "HC-030",
        passed: true,
        severity: ConstraintSeverity.HARD,
        score: 0,
        maxScore: 0,
        message: "All floor entities and references are consistent",
        affectedEntities: [],
        explanation: "Every entity belongs to its parent floor and all local references resolve on that floor."
      });
    }
    return results;
  }
};

// packages/constraint-engine/dist/constraints/hard/minimum-size.js
var MinimumRoomSize = {
  id: "HC-023",
  name: "Minimum Room Size",
  description: "Every room must meet minimum area and dimension requirements for its type",
  category: ConstraintCategory.GEOMETRY,
  severity: ConstraintSeverity.HARD,
  enabled: true,
  evaluate(context) {
    const results = [];
    const { minimumRoomSizes, minimumDimensions } = context.config;
    for (const floor of context.building.floors) {
      for (const room of floor.rooms) {
        const minArea = minimumRoomSizes[room.type];
        if (minArea !== void 0 && room.area < minArea) {
          const actualSqM = sqMmToSqM(room.area);
          const minSqM = sqMmToSqM(minArea);
          const actualSqFt = sqMmToSqFt(room.area);
          const minSqFt = sqMmToSqFt(minArea);
          results.push({
            constraintId: "HC-023",
            passed: false,
            severity: ConstraintSeverity.HARD,
            score: 0,
            maxScore: 0,
            message: `"${room.name}" is too small (${actualSqFt.toFixed(0)} sq ft, minimum: ${minSqFt.toFixed(0)} sq ft for ${room.type})`,
            affectedEntities: [room.id],
            explanation: `"${room.name}" has an area of ${actualSqM.toFixed(1)} sq m (${actualSqFt.toFixed(0)} sq ft), which is below the minimum of ${minSqM.toFixed(1)} sq m (${minSqFt.toFixed(0)} sq ft) for a ${room.type}. Increase the room dimensions.`,
            suggestedFixes: [{
              description: `Increase "${room.name}" area to at least ${minSqM.toFixed(1)} sq m`,
              actionType: "resize",
              targetEntity: room.id,
              priority: 1,
              parameters: { minimumArea: minArea }
            }]
          });
        }
        const minDim = minimumDimensions[room.type];
        if (minDim !== void 0) {
          const smallest = Math.min(room.width, room.height);
          if (smallest < minDim) {
            results.push({
              constraintId: "HC-023",
              passed: false,
              severity: ConstraintSeverity.HARD,
              score: 0,
              maxScore: 0,
              message: `"${room.name}" has a dimension too narrow (${smallest} mm, minimum: ${minDim} mm for ${room.type})`,
              affectedEntities: [room.id],
              explanation: `"${room.name}" has a minimum dimension of ${smallest} mm. For a ${room.type}, the shortest side must be at least ${minDim} mm. Widen the room.`,
              suggestedFixes: [{
                description: `Widen "${room.name}" to at least ${minDim} mm on the shortest side`,
                actionType: "resize",
                targetEntity: room.id,
                priority: 1,
                parameters: { minimumDimension: minDim }
              }]
            });
          }
        }
      }
    }
    if (results.length === 0) {
      results.push({
        constraintId: "HC-023",
        passed: true,
        severity: ConstraintSeverity.HARD,
        score: 0,
        maxScore: 0,
        message: "All rooms meet minimum size requirements",
        affectedEntities: [],
        explanation: "Every room meets the minimum area and dimension requirements for its type."
      });
    }
    return results;
  }
};

// packages/constraint-engine/dist/constraints/hard/vertical-continuity.js
function geometryKey(entity) {
  return [entity.x, entity.y, entity.width, entity.height ?? entity.length ?? 0].join("|");
}
var VerticalCirculationContinuity = {
  id: "HC-031",
  name: "Vertical Circulation Continuity",
  description: "Every occupied floor must participate in one aligned staircase core",
  category: ConstraintCategory.ACCESSIBILITY,
  severity: ConstraintSeverity.HARD,
  enabled: true,
  evaluate(context) {
    const floors = [...context.building.floors].sort((a, b) => a.level - b.level);
    if (floors.length <= 1) {
      return [{
        constraintId: "HC-031",
        passed: true,
        severity: ConstraintSeverity.HARD,
        score: 0,
        maxScore: 0,
        status: EvaluationStatus.NOT_APPLICABLE,
        message: "Vertical circulation: single floor \u2014 not applicable",
        affectedEntities: [],
        explanation: "A single-floor plan does not require cross-floor stair continuity."
      }];
    }
    const results = [];
    const stairRooms = floors.map((floor) => floor.rooms.find((room) => room.type === RoomType.Staircase));
    const missingRoomFloors = floors.filter((_, index) => !stairRooms[index]);
    const missingStairFloors = floors.filter((floor) => floor.stairs.length === 0);
    if (missingRoomFloors.length > 0 || missingStairFloors.length > 0) {
      const affected = [...missingRoomFloors, ...missingStairFloors].map((floor) => floor.id);
      results.push({
        constraintId: "HC-031",
        passed: false,
        severity: ConstraintSeverity.HARD,
        score: 0,
        maxScore: 0,
        message: `Vertical circulation is missing on ${new Set(affected).size} floor(s)`,
        affectedEntities: [...new Set(affected)],
        explanation: "Every occupied floor in a multi-floor building requires an explicit staircase room and stair entity.",
        suggestedFixes: [{ description: "Add the missing aligned staircase continuation", actionType: "add", priority: 1 }]
      });
    }
    const presentRooms = stairRooms.filter((room) => Boolean(room));
    if (presentRooms.length > 1 && new Set(presentRooms.map(geometryKey)).size !== 1) {
      results.push({
        constraintId: "HC-031",
        passed: false,
        severity: ConstraintSeverity.HARD,
        score: 0,
        maxScore: 0,
        message: "Staircase rooms are not vertically aligned",
        affectedEntities: presentRooms.map((room) => room.id),
        explanation: "The staircase footprint must use the same coordinates and dimensions on connected floors.",
        suggestedFixes: [{ description: "Align staircase footprints to one vertical core", actionType: "move", priority: 1 }]
      });
    }
    const stairs = floors.flatMap((floor) => floor.stairs);
    if (stairs.length > 1 && new Set(stairs.map(geometryKey)).size !== 1) {
      results.push({
        constraintId: "HC-031",
        passed: false,
        severity: ConstraintSeverity.HARD,
        score: 0,
        maxScore: 0,
        message: "Stair entities are not vertically aligned",
        affectedEntities: stairs.map((stair) => stair.id),
        explanation: "Every stair entity assigned to the primary core must share its plan footprint."
      });
    }
    const coveredPairs = new Set(stairs.map((stair) => {
      const pair = [...stair.connectsFloors].sort((a, b) => a - b);
      return `${pair[0]}:${pair[1]}`;
    }));
    const missingPairs = floors.slice(0, -1).filter((floor, index) => {
      const next = floors[index + 1];
      return !coveredPairs.has(`${floor.level}:${next.level}`);
    });
    if (missingPairs.length > 0) {
      results.push({
        constraintId: "HC-031",
        passed: false,
        severity: ConstraintSeverity.HARD,
        score: 0,
        maxScore: 0,
        message: "One or more adjacent floor pairs lack an explicit stair connection",
        affectedEntities: missingPairs.map((floor) => floor.id),
        explanation: "Every adjacent pair of occupied floor levels must be connected by an explicit stair relationship."
      });
    }
    if (results.length > 0)
      return results;
    return [{
      constraintId: "HC-031",
      passed: true,
      severity: ConstraintSeverity.HARD,
      score: 0,
      maxScore: 0,
      message: "Vertical stair core is continuous across all floors",
      affectedEntities: [],
      explanation: "Stair rooms and stair entities align, and every adjacent floor pair is connected."
    }];
  }
};

// packages/constraint-engine/dist/helpers/room-queries.js
function getAllRooms(building) {
  return building.floors.flatMap((f) => [...f.rooms]);
}
function getRoomsByType(building, type) {
  return getAllRooms(building).filter((r) => r.type === type);
}
function getMasterBedroom(building) {
  const bedrooms = getRoomsByType(building, "bedroom");
  if (bedrooms.length === 0)
    return null;
  const highPriority = bedrooms.filter((b) => b.priority >= 8);
  if (highPriority.length > 0) {
    return highPriority.reduce((a, b) => a.area > b.area ? a : b);
  }
  return bedrooms.reduce((a, b) => a.area > b.area ? a : b);
}
function hasExternalWall(room, floorBoundary) {
  if (floorBoundary.points.length < 3)
    return false;
  return polygonsAdjacent(room.boundary, floorBoundary);
}

// packages/constraint-engine/dist/constraints/soft/adjacency.js
function adjacencyCheck(id, name, _description, sourceType, targetType, maxScore, context) {
  const sources = getRoomsByType(context.building, sourceType);
  const targets = getRoomsByType(context.building, targetType);
  if (sources.length === 0 || targets.length === 0) {
    return {
      constraintId: id,
      passed: true,
      severity: ConstraintSeverity.SOFT,
      score: maxScore,
      maxScore,
      message: `${name}: not applicable (missing room type)`,
      affectedEntities: [],
      explanation: `Cannot evaluate ${name.toLowerCase()} because one or both room types are not present in the plan.`
    };
  }
  let found = false;
  for (const s of sources) {
    for (const t of targets) {
      if (s.floorId === t.floorId && polygonsAdjacent(s.boundary, t.boundary)) {
        found = true;
        break;
      }
    }
    if (found)
      break;
  }
  if (found) {
    return {
      constraintId: id,
      passed: true,
      severity: ConstraintSeverity.SOFT,
      score: maxScore,
      maxScore,
      message: `${name}: satisfied`,
      affectedEntities: [],
      explanation: `At least one ${sourceType} is adjacent to a ${targetType}, supporting good functional flow.`
    };
  }
  return {
    constraintId: id,
    passed: false,
    severity: ConstraintSeverity.SOFT,
    score: 0,
    maxScore,
    message: `${name}: ${sourceType} is not adjacent to ${targetType}`,
    affectedEntities: [...sources.map((r) => r.id), ...targets.map((r) => r.id)],
    explanation: `No ${sourceType} shares a wall with any ${targetType}. For better workflow, place these rooms adjacent to each other.`,
    suggestedFixes: [{
      description: `Move ${sourceType} adjacent to ${targetType}`,
      actionType: "move",
      targetEntity: sources[0]?.id,
      priority: 2
    }]
  };
}
var KitchenDining = {
  id: "SC-ADJ-001",
  name: "Kitchen-Dining Adjacency",
  description: "Kitchen should be adjacent to dining for workflow efficiency",
  category: ConstraintCategory.ACCESSIBILITY,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    return [adjacencyCheck("SC-ADJ-001", "Kitchen-Dining Adjacency", this.description, RoomType.Kitchen, RoomType.Dining, 20, ctx)];
  }
};
var DiningLiving = {
  id: "SC-ADJ-002",
  name: "Dining-Living Adjacency",
  description: "Dining should be adjacent to living for social flow",
  category: ConstraintCategory.ACCESSIBILITY,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    return [adjacencyCheck("SC-ADJ-002", "Dining-Living Adjacency", this.description, RoomType.Dining, RoomType.Living, 15, ctx)];
  }
};
var MasterBathroom = {
  id: "SC-ADJ-003",
  name: "Master Bedroom-Bathroom Adjacency",
  description: "Master bedroom should have an attached bathroom",
  category: ConstraintCategory.ACCESSIBILITY,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    const master = getMasterBedroom(ctx.building);
    const bathrooms = getRoomsByType(ctx.building, RoomType.Bathroom);
    if (!master || bathrooms.length === 0) {
      return [{
        constraintId: "SC-ADJ-003",
        passed: true,
        severity: ConstraintSeverity.SOFT,
        score: 20,
        maxScore: 20,
        message: "Master-Bathroom: not applicable",
        affectedEntities: [],
        explanation: "No master bedroom or bathroom present."
      }];
    }
    const hasAttached = bathrooms.some((b) => b.floorId === master.floorId && polygonsAdjacent(master.boundary, b.boundary));
    return [{
      constraintId: "SC-ADJ-003",
      passed: hasAttached,
      severity: ConstraintSeverity.SOFT,
      score: hasAttached ? 20 : 0,
      maxScore: 20,
      message: hasAttached ? "Master bedroom has attached bathroom" : "Master bedroom lacks attached bathroom",
      affectedEntities: hasAttached ? [] : [master.id],
      explanation: hasAttached ? "The master bedroom is adjacent to a bathroom, providing convenience." : "The master bedroom has no adjacent bathroom. Place a bathroom next to the master bedroom.",
      suggestedFixes: hasAttached ? void 0 : [{
        description: "Place a bathroom adjacent to the master bedroom",
        actionType: "move",
        priority: 2
      }]
    }];
  }
};
var UtilityKitchen = {
  id: "SC-ADJ-004",
  name: "Utility-Kitchen Adjacency",
  description: "Utility room should be near the kitchen",
  category: ConstraintCategory.ACCESSIBILITY,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    return [adjacencyCheck("SC-ADJ-004", "Utility-Kitchen Adjacency", this.description, RoomType.Utility, RoomType.Kitchen, 10, ctx)];
  }
};
var ParkingEntrance = {
  id: "SC-ADJ-005",
  name: "Parking-Entrance Adjacency",
  description: "Parking should be near the entrance/foyer",
  category: ConstraintCategory.ACCESSIBILITY,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    return [adjacencyCheck("SC-ADJ-005", "Parking-Entrance Adjacency", this.description, RoomType.Parking, RoomType.Foyer, 10, ctx)];
  }
};
var PoojaAccess = {
  id: "SC-ADJ-006",
  name: "Pooja-Living Access",
  description: "Pooja room should be accessible from living area",
  category: ConstraintCategory.ACCESSIBILITY,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    return [adjacencyCheck("SC-ADJ-006", "Pooja-Living Access", this.description, RoomType.Pooja, RoomType.Living, 5, ctx)];
  }
};

// packages/constraint-engine/dist/constraints/soft/circulation.js
var CorridorRatio = {
  id: "SC-CIR-001",
  name: "Corridor Area Ratio",
  description: "Corridor area should not exceed 15% of total floor area",
  category: ConstraintCategory.CIRCULATION,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    let totalArea = 0;
    let corridorArea = 0;
    for (const room of ctx.allRooms) {
      totalArea += room.area;
      if (room.type === RoomType.Corridor) {
        corridorArea += room.area;
      }
    }
    if (totalArea === 0) {
      return [{
        constraintId: "SC-CIR-001",
        passed: true,
        severity: ConstraintSeverity.SOFT,
        score: 30,
        maxScore: 30,
        message: "Corridor ratio: not applicable (no rooms)",
        affectedEntities: [],
        explanation: "No rooms present to evaluate corridor ratio."
      }];
    }
    const ratio = corridorArea / totalArea;
    let score;
    let message;
    if (ratio <= 0.1) {
      score = 30;
      message = `Excellent circulation efficiency (corridor ratio: ${(ratio * 100).toFixed(1)}%)`;
    } else if (ratio <= 0.15) {
      score = 20;
      message = `Acceptable circulation (corridor ratio: ${(ratio * 100).toFixed(1)}%)`;
    } else if (ratio <= 0.2) {
      score = 10;
      message = `High corridor area (corridor ratio: ${(ratio * 100).toFixed(1)}%)`;
    } else {
      score = 0;
      message = `Excessive corridor area (corridor ratio: ${(ratio * 100).toFixed(1)}%)`;
    }
    return [{
      constraintId: "SC-CIR-001",
      passed: ratio <= 0.15,
      severity: ConstraintSeverity.SOFT,
      score,
      maxScore: 30,
      message,
      affectedEntities: ctx.allRooms.filter((r) => r.type === RoomType.Corridor).map((r) => r.id),
      explanation: `Corridors occupy ${(ratio * 100).toFixed(1)}% of the total floor area. Ideally, circulation space should be under 15% to maximize usable room area.`
    }];
  }
};
var NoDeadEnds = {
  id: "SC-CIR-002",
  name: "No Dead-End Corridors",
  description: "Corridors should connect to multiple spaces, not dead-end",
  category: ConstraintCategory.CIRCULATION,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    const corridors = ctx.allRooms.filter((r) => r.type === RoomType.Corridor);
    if (corridors.length === 0) {
      return [{
        constraintId: "SC-CIR-002",
        passed: true,
        severity: ConstraintSeverity.SOFT,
        score: 15,
        maxScore: 15,
        message: "No dead-end corridors: not applicable (no corridors)",
        affectedEntities: [],
        explanation: "No corridors present \u2014 rooms may connect directly."
      }];
    }
    return [{
      constraintId: "SC-CIR-002",
      passed: true,
      severity: ConstraintSeverity.SOFT,
      score: 15,
      maxScore: 15,
      message: "Corridor connectivity: acceptable",
      affectedEntities: [],
      explanation: "Corridor dead-end detection requires full door connectivity data."
    }];
  }
};
var DirectAccess = {
  id: "SC-CIR-003",
  name: "Direct Room Access",
  description: "Functionally related rooms should have direct access where appropriate",
  category: ConstraintCategory.CIRCULATION,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    const corridors = ctx.allRooms.filter((r) => r.type === RoomType.Corridor);
    const score = corridors.length <= 2 ? 15 : corridors.length <= 4 ? 10 : 5;
    return [{
      constraintId: "SC-CIR-003",
      passed: score >= 10,
      severity: ConstraintSeverity.SOFT,
      score,
      maxScore: 15,
      message: score >= 10 ? "Good direct access between functional areas" : "Too many corridors separating functional areas",
      affectedEntities: [],
      explanation: `The plan has ${corridors.length} corridor(s). Fewer corridors generally indicates better direct access between rooms.`
    }];
  }
};
var PathLength = {
  id: "SC-CIR-004",
  name: "Path Length from Entrance",
  description: "All rooms should be reachable within 3 door transitions from entrance",
  category: ConstraintCategory.CIRCULATION,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    const results = [];
    for (const floor of ctx.building.floors) {
      if (floor.doors.length === 0)
        continue;
      let allWithin3 = true;
      for (const room of floor.rooms) {
        const transitions = doorTransitionsToRoom(floor, room.id);
        if (transitions > 3) {
          allWithin3 = false;
        }
      }
      results.push({
        constraintId: "SC-CIR-004",
        passed: allWithin3,
        severity: ConstraintSeverity.SOFT,
        score: allWithin3 ? 20 : 5,
        maxScore: 20,
        message: allWithin3 ? `All rooms on "${floor.name}" reachable within 3 transitions` : `Some rooms on "${floor.name}" require more than 3 door transitions`,
        affectedEntities: [],
        explanation: allWithin3 ? "Good circulation \u2014 all rooms are easily accessible from the entrance." : "Some rooms are deep in the plan, requiring many door transitions. Consider reducing corridor chains."
      });
    }
    if (results.length === 0) {
      results.push({
        constraintId: "SC-CIR-004",
        passed: true,
        severity: ConstraintSeverity.SOFT,
        score: 20,
        maxScore: 20,
        message: "Path length: not evaluated (no doors defined)",
        affectedEntities: [],
        explanation: "Door connectivity not defined, path length cannot be measured."
      });
    }
    return results;
  }
};

// packages/constraint-engine/dist/constraints/soft/daylight.js
var BedroomExternal = {
  id: "SC-DAY-001",
  name: "Bedroom Daylight",
  description: "Each bedroom should have at least one external wall for natural light",
  category: ConstraintCategory.DAYLIGHT,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    const results = [];
    for (const floor of ctx.building.floors) {
      const bedrooms = floor.rooms.filter((r) => r.type === RoomType.Bedroom);
      for (const room of bedrooms) {
        const external = hasExternalWall(room, floor.boundary);
        results.push({
          constraintId: "SC-DAY-001",
          passed: external,
          severity: ConstraintSeverity.SOFT,
          score: external ? 20 : 0,
          maxScore: 20,
          message: external ? `"${room.name}" has natural light access` : `"${room.name}" lacks natural light (no external wall)`,
          affectedEntities: external ? [] : [room.id],
          explanation: external ? `"${room.name}" shares a wall with the building exterior, allowing natural light and ventilation.` : `"${room.name}" is surrounded by other rooms with no external wall. This limits natural light and ventilation. Consider repositioning it to touch the floor boundary.`,
          suggestedFixes: external ? void 0 : [{
            description: `Move "${room.name}" to an external wall position`,
            actionType: "move",
            targetEntity: room.id,
            priority: 3
          }],
          classification: "proxy"
        });
      }
    }
    if (results.length === 0) {
      results.push({
        constraintId: "SC-DAY-001",
        passed: true,
        severity: ConstraintSeverity.SOFT,
        score: 0,
        maxScore: 0,
        status: EvaluationStatus.NOT_APPLICABLE,
        classification: "proxy",
        message: "Bedroom daylight potential: not applicable",
        affectedEntities: [],
        explanation: "No bedrooms present in the plan."
      });
    }
    return results;
  }
};
var LivingExternal = {
  id: "SC-DAY-002",
  name: "Living Room Daylight",
  description: "Living room should have external wall access",
  category: ConstraintCategory.DAYLIGHT,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    for (const floor of ctx.building.floors) {
      const livings = floor.rooms.filter((r) => r.type === RoomType.Living);
      for (const room of livings) {
        const external = hasExternalWall(room, floor.boundary);
        return [{
          constraintId: "SC-DAY-002",
          passed: external,
          severity: ConstraintSeverity.SOFT,
          score: external ? 25 : 0,
          maxScore: 25,
          message: external ? `"${room.name}" has excellent natural light` : `"${room.name}" has no external wall access`,
          affectedEntities: external ? [] : [room.id],
          explanation: external ? `"${room.name}" is positioned on an external wall for maximum daylight.` : `"${room.name}" has no direct access to the building exterior. Living rooms benefit greatly from natural light.`,
          classification: "proxy"
        }];
      }
    }
    return [{
      constraintId: "SC-DAY-002",
      passed: true,
      severity: ConstraintSeverity.SOFT,
      score: 0,
      maxScore: 0,
      status: EvaluationStatus.NOT_APPLICABLE,
      classification: "proxy",
      message: "Living-room daylight potential: not applicable",
      affectedEntities: [],
      explanation: "No living room present."
    }];
  }
};
var KitchenExternal = {
  id: "SC-DAY-003",
  name: "Kitchen Daylight",
  description: "Kitchen should have external wall access for ventilation",
  category: ConstraintCategory.DAYLIGHT,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    for (const floor of ctx.building.floors) {
      const kitchens = floor.rooms.filter((r) => r.type === RoomType.Kitchen);
      for (const room of kitchens) {
        const external = hasExternalWall(room, floor.boundary);
        return [{
          constraintId: "SC-DAY-003",
          passed: external,
          severity: ConstraintSeverity.SOFT,
          score: external ? 15 : 0,
          maxScore: 15,
          message: external ? `"${room.name}" has ventilation access` : `"${room.name}" lacks ventilation (no external wall)`,
          affectedEntities: external ? [] : [room.id],
          explanation: external ? `"${room.name}" can be ventilated via the external wall.` : `"${room.name}" has no external wall for smoke exhaust and ventilation. This is a significant design concern.`,
          classification: "proxy"
        }];
      }
    }
    return [{
      constraintId: "SC-DAY-003",
      passed: true,
      severity: ConstraintSeverity.SOFT,
      score: 0,
      maxScore: 0,
      status: EvaluationStatus.NOT_APPLICABLE,
      classification: "proxy",
      message: "Kitchen daylight potential: not applicable",
      affectedEntities: [],
      explanation: "No kitchen present."
    }];
  }
};
var WindowOrientation = {
  id: "SC-DAY-004",
  name: "Window Orientation",
  description: "Windows facing East or South receive optimal natural daylight",
  category: ConstraintCategory.DAYLIGHT,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    let totalWindows = 0;
    for (const floor of ctx.building.floors) {
      totalWindows += floor.windows.length;
    }
    if (totalWindows === 0) {
      return [{
        constraintId: "SC-DAY-004",
        passed: true,
        severity: ConstraintSeverity.SOFT,
        score: 0,
        maxScore: 0,
        status: EvaluationStatus.INSUFFICIENT_INPUT,
        classification: "proxy",
        message: "Window orientation potential: insufficient input",
        affectedEntities: [],
        explanation: "No windows defined in this draft layout."
      }];
    }
    return [{
      constraintId: "SC-DAY-004",
      passed: true,
      severity: ConstraintSeverity.SOFT,
      score: 0,
      maxScore: 0,
      status: EvaluationStatus.NOT_ANALYZED,
      classification: "proxy",
      message: `Window orientation: not analyzed (${totalWindows} opening${totalWindows === 1 ? "" : "s"} documented)`,
      affectedEntities: [],
      explanation: "Openings are documented, but the current engine does not calculate solar exposure or orientation performance."
    }];
  }
};
var AllHabitableLight = {
  id: "SC-DAY-005",
  name: "All Habitable Rooms Have Light",
  description: "Bonus: every habitable room (bedroom, living, kitchen) has external access",
  category: ConstraintCategory.DAYLIGHT,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    const habitableTypes = /* @__PURE__ */ new Set([RoomType.Bedroom, RoomType.Living, RoomType.Kitchen, RoomType.Dining]);
    let allHaveLight = true;
    for (const floor of ctx.building.floors) {
      for (const room of floor.rooms) {
        if (habitableTypes.has(room.type)) {
          if (!hasExternalWall(room, floor.boundary)) {
            allHaveLight = false;
            break;
          }
        }
      }
      if (!allHaveLight)
        break;
    }
    return [{
      constraintId: "SC-DAY-005",
      passed: allHaveLight,
      severity: ConstraintSeverity.SOFT,
      score: allHaveLight ? 10 : 0,
      maxScore: 10,
      message: allHaveLight ? "All habitable rooms have natural light access" : "Some habitable rooms lack natural light",
      affectedEntities: [],
      explanation: allHaveLight ? "Every bedroom, living, kitchen, and dining room has direct external wall access \u2014 excellent design." : "One or more habitable rooms are fully interior. Consider rearranging the plan so all habitable rooms touch an external wall.",
      classification: "proxy"
    }];
  }
};

// packages/constraint-engine/dist/helpers/zone-classification.js
var Zone;
(function(Zone2) {
  Zone2["PUBLIC"] = "public";
  Zone2["PRIVATE"] = "private";
  Zone2["SERVICE"] = "service";
  Zone2["CIRCULATION"] = "circulation";
  Zone2["OUTDOOR"] = "outdoor";
})(Zone || (Zone = {}));
var ZONE_MAP = {
  living: Zone.PUBLIC,
  dining: Zone.PUBLIC,
  foyer: Zone.PUBLIC,
  drawing: Zone.PUBLIC,
  family_living: Zone.PUBLIC,
  bedroom: Zone.PRIVATE,
  bathroom: Zone.PRIVATE,
  study: Zone.PRIVATE,
  pooja: Zone.PRIVATE,
  kitchen: Zone.SERVICE,
  utility: Zone.SERVICE,
  servant_quarter: Zone.SERVICE,
  storage: Zone.SERVICE,
  corridor: Zone.CIRCULATION,
  staircase: Zone.CIRCULATION,
  balcony: Zone.OUTDOOR,
  terrace: Zone.OUTDOOR,
  garden: Zone.OUTDOOR,
  parking: Zone.OUTDOOR,
  custom: Zone.PRIVATE
};
function getRoomZone(roomOrType) {
  const type = typeof roomOrType === "string" ? roomOrType : roomOrType.type;
  return ZONE_MAP[type] ?? Zone.PRIVATE;
}
function getPublicRooms(rooms) {
  return rooms.filter((r) => getRoomZone(r) === Zone.PUBLIC);
}
function getPrivateRooms(rooms) {
  return rooms.filter((r) => getRoomZone(r) === Zone.PRIVATE);
}
function getServiceRooms(rooms) {
  return rooms.filter((r) => getRoomZone(r) === Zone.SERVICE);
}

// packages/constraint-engine/dist/constraints/soft/privacy.js
var BedroomSeparation = {
  id: "SC-PRI-001",
  name: "Bedroom-Entrance Separation",
  description: "Bedrooms should not be adjacent to foyer/entrance areas",
  category: ConstraintCategory.PRIVACY,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    const results = [];
    const entranceTypes = /* @__PURE__ */ new Set([RoomType.Foyer, RoomType.Corridor]);
    for (const floor of ctx.building.floors) {
      const bedrooms = floor.rooms.filter((r) => r.type === RoomType.Bedroom);
      const entrances = floor.rooms.filter((r) => entranceTypes.has(r.type));
      for (const bedroom of bedrooms) {
        let adjacentToEntrance = false;
        for (const entrance of entrances) {
          if (polygonsAdjacent(bedroom.boundary, entrance.boundary)) {
            adjacentToEntrance = true;
            break;
          }
        }
        results.push({
          constraintId: "SC-PRI-001",
          passed: !adjacentToEntrance,
          severity: ConstraintSeverity.SOFT,
          score: adjacentToEntrance ? 0 : 15,
          maxScore: 15,
          message: adjacentToEntrance ? `"${bedroom.name}" is adjacent to entrance \u2014 privacy concern` : `"${bedroom.name}" is well-separated from entrance`,
          affectedEntities: adjacentToEntrance ? [bedroom.id] : [],
          explanation: adjacentToEntrance ? `"${bedroom.name}" shares a wall with a corridor or foyer. This reduces acoustic and visual privacy. Consider placing buffer rooms between bedrooms and the entrance.` : `"${bedroom.name}" has adequate separation from public circulation areas.`
        });
      }
    }
    if (results.length === 0) {
      results.push({
        constraintId: "SC-PRI-001",
        passed: true,
        severity: ConstraintSeverity.SOFT,
        score: 15,
        maxScore: 15,
        message: "Bedroom separation: no bedrooms to evaluate",
        affectedEntities: [],
        explanation: "No bedrooms present."
      });
    }
    return results;
  }
};
var MasterIsolation = {
  id: "SC-PRI-002",
  name: "Master Bedroom Isolation",
  description: "Master bedroom should be isolated from public zones",
  category: ConstraintCategory.PRIVACY,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    const master = getMasterBedroom(ctx.building);
    if (!master) {
      return [{
        constraintId: "SC-PRI-002",
        passed: true,
        severity: ConstraintSeverity.SOFT,
        score: 20,
        maxScore: 20,
        message: "Master isolation: no master bedroom identified",
        affectedEntities: [],
        explanation: "No master bedroom present to evaluate."
      }];
    }
    const publicRooms = getPublicRooms(ctx.allRooms);
    let adjacentToPublic = false;
    for (const pub of publicRooms) {
      if (master.floorId === pub.floorId && polygonsAdjacent(master.boundary, pub.boundary)) {
        adjacentToPublic = true;
        break;
      }
    }
    return [{
      constraintId: "SC-PRI-002",
      passed: !adjacentToPublic,
      severity: ConstraintSeverity.SOFT,
      score: adjacentToPublic ? 0 : 20,
      maxScore: 20,
      message: adjacentToPublic ? `"${master.name}" is adjacent to a public room \u2014 privacy concern` : `"${master.name}" is well-isolated from public areas`,
      affectedEntities: adjacentToPublic ? [master.id] : [],
      explanation: adjacentToPublic ? `"${master.name}" shares a wall with a public room (living, dining, or foyer). For maximum privacy, place buffer spaces between the master suite and public areas.` : `"${master.name}" is separated from public zones, providing good acoustic and visual privacy.`
    }];
  }
};
var BathroomVisibility = {
  id: "SC-PRI-003",
  name: "Bathroom Visibility",
  description: "Bathroom doors should not open directly into living/dining areas",
  category: ConstraintCategory.PRIVACY,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    const bathrooms = getRoomsByType(ctx.building, RoomType.Bathroom);
    const publicSpaces = ctx.allRooms.filter((r) => r.type === RoomType.Living || r.type === RoomType.Dining);
    if (bathrooms.length === 0 || publicSpaces.length === 0) {
      return [{
        constraintId: "SC-PRI-003",
        passed: true,
        severity: ConstraintSeverity.SOFT,
        score: 15,
        maxScore: 15,
        message: "Bathroom visibility: not applicable",
        affectedEntities: [],
        explanation: "No bathrooms or public spaces to evaluate."
      }];
    }
    let visible = false;
    for (const bath of bathrooms) {
      for (const pub of publicSpaces) {
        if (bath.floorId === pub.floorId && polygonsAdjacent(bath.boundary, pub.boundary)) {
          visible = true;
          break;
        }
      }
      if (visible)
        break;
    }
    return [{
      constraintId: "SC-PRI-003",
      passed: !visible,
      severity: ConstraintSeverity.SOFT,
      score: visible ? 0 : 15,
      maxScore: 15,
      message: visible ? "A bathroom is directly adjacent to a living/dining area" : "Bathrooms are well-hidden from public spaces",
      affectedEntities: [],
      explanation: visible ? "A bathroom opens directly adjacent to living or dining. Consider adding a buffer corridor or repositioning." : "No bathroom directly abuts a public living space \u2014 good privacy."
    }];
  }
};
var GuestSeparation = {
  id: "SC-PRI-004",
  name: "Guest Bedroom Separation",
  description: "Guest bedroom should be separated from family bedrooms",
  category: ConstraintCategory.PRIVACY,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    const bedrooms = getRoomsByType(ctx.building, RoomType.Bedroom);
    if (bedrooms.length < 2) {
      return [{
        constraintId: "SC-PRI-004",
        passed: true,
        severity: ConstraintSeverity.SOFT,
        score: 10,
        maxScore: 10,
        message: "Guest separation: fewer than 2 bedrooms",
        affectedEntities: [],
        explanation: "Fewer than 2 bedrooms \u2014 guest separation not applicable."
      }];
    }
    let hasSeparated = false;
    for (const bed of bedrooms) {
      const adjToOther = bedrooms.some((other) => other.id !== bed.id && other.floorId === bed.floorId && polygonsAdjacent(bed.boundary, other.boundary));
      if (!adjToOther) {
        hasSeparated = true;
        break;
      }
    }
    return [{
      constraintId: "SC-PRI-004",
      passed: hasSeparated,
      severity: ConstraintSeverity.SOFT,
      score: hasSeparated ? 10 : 0,
      maxScore: 10,
      message: hasSeparated ? "At least one bedroom is separated from others (potential guest room)" : "All bedrooms are clustered together",
      affectedEntities: [],
      explanation: hasSeparated ? "At least one bedroom is physically separated from the others, suitable for guest use." : "All bedrooms are adjacent to each other. Consider separating at least one for guest privacy."
    }];
  }
};

// packages/constraint-engine/dist/constraints/soft/zoning.js
var PublicPrivateSeparation = {
  id: "SC-ZON-001",
  name: "Public-Private Zone Separation",
  description: "Public zone rooms should be separated from private zone rooms",
  category: ConstraintCategory.FUNCTIONAL_ZONING,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    const publicRooms = getPublicRooms(ctx.allRooms);
    const privateRooms = getPrivateRooms(ctx.allRooms);
    if (publicRooms.length === 0 || privateRooms.length === 0) {
      return [{
        constraintId: "SC-ZON-001",
        passed: true,
        severity: ConstraintSeverity.SOFT,
        score: 25,
        maxScore: 25,
        message: "Zone separation: not applicable (missing zone)",
        affectedEntities: [],
        explanation: "Cannot evaluate zone separation \u2014 one zone has no rooms."
      }];
    }
    let crossZoneAdjacencies = 0;
    for (const pub of publicRooms) {
      for (const priv of privateRooms) {
        if (pub.floorId === priv.floorId && polygonsAdjacent(pub.boundary, priv.boundary)) {
          crossZoneAdjacencies++;
        }
      }
    }
    const maxPairs = publicRooms.length * privateRooms.length;
    const ratio = crossZoneAdjacencies / maxPairs;
    let score;
    if (ratio <= 0.1)
      score = 25;
    else if (ratio <= 0.3)
      score = 18;
    else if (ratio <= 0.5)
      score = 10;
    else
      score = 3;
    return [{
      constraintId: "SC-ZON-001",
      passed: score >= 18,
      severity: ConstraintSeverity.SOFT,
      score,
      maxScore: 25,
      message: crossZoneAdjacencies === 0 ? "Excellent public-private zone separation" : `${crossZoneAdjacencies} cross-zone adjacencies between public and private rooms`,
      affectedEntities: [],
      explanation: `The plan has ${crossZoneAdjacencies} point(s) where public rooms directly touch private rooms. Fewer direct contacts means better functional separation.`
    }];
  }
};
var ServiceZoneGrouping = {
  id: "SC-ZON-002",
  name: "Service Zone Grouping",
  description: "Service rooms (kitchen, utility) should be grouped together",
  category: ConstraintCategory.FUNCTIONAL_ZONING,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    const serviceRooms = getServiceRooms(ctx.allRooms);
    if (serviceRooms.length < 2) {
      return [{
        constraintId: "SC-ZON-002",
        passed: true,
        severity: ConstraintSeverity.SOFT,
        score: 15,
        maxScore: 15,
        message: "Service grouping: fewer than 2 service rooms",
        affectedEntities: [],
        explanation: "Not enough service rooms to evaluate grouping."
      }];
    }
    let hasGrouping = false;
    for (let i = 0; i < serviceRooms.length; i++) {
      for (let j = i + 1; j < serviceRooms.length; j++) {
        if (serviceRooms[i].floorId === serviceRooms[j].floorId && polygonsAdjacent(serviceRooms[i].boundary, serviceRooms[j].boundary)) {
          hasGrouping = true;
          break;
        }
      }
      if (hasGrouping)
        break;
    }
    return [{
      constraintId: "SC-ZON-002",
      passed: hasGrouping,
      severity: ConstraintSeverity.SOFT,
      score: hasGrouping ? 15 : 0,
      maxScore: 15,
      message: hasGrouping ? "Service rooms are grouped together" : "Service rooms are scattered \u2014 not grouped",
      affectedEntities: hasGrouping ? [] : serviceRooms.map((r) => r.id),
      explanation: hasGrouping ? "At least two service rooms (kitchen, utility, etc.) are adjacent, supporting efficient service flow." : "Service rooms are not adjacent to each other. Grouping them improves workflow and plumbing efficiency."
    }];
  }
};
var NightDaySeparation = {
  id: "SC-ZON-003",
  name: "Night-Day Room Separation",
  description: "Night-use rooms (bedrooms) should be separated from day-use rooms",
  category: ConstraintCategory.FUNCTIONAL_ZONING,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    const nightRooms = ctx.allRooms.filter((r) => r.type === "bedroom" || r.type === "bathroom");
    const dayRooms = ctx.allRooms.filter((r) => r.type === "living" || r.type === "dining" || r.type === "kitchen");
    if (nightRooms.length === 0 || dayRooms.length === 0) {
      return [{
        constraintId: "SC-ZON-003",
        passed: true,
        severity: ConstraintSeverity.SOFT,
        score: 15,
        maxScore: 15,
        message: "Night-Day separation: not applicable",
        affectedEntities: [],
        explanation: "Cannot evaluate \u2014 missing night or day rooms."
      }];
    }
    let directContacts = 0;
    for (const night of nightRooms) {
      if (night.type !== "bedroom")
        continue;
      for (const day of dayRooms) {
        if (night.floorId === day.floorId && polygonsAdjacent(night.boundary, day.boundary)) {
          directContacts++;
        }
      }
    }
    const score = directContacts === 0 ? 15 : directContacts <= 1 ? 10 : 3;
    return [{
      constraintId: "SC-ZON-003",
      passed: directContacts <= 1,
      severity: ConstraintSeverity.SOFT,
      score,
      maxScore: 15,
      message: directContacts === 0 ? "Excellent night-day separation" : `${directContacts} bedroom(s) directly adjacent to living/kitchen areas`,
      affectedEntities: [],
      explanation: directContacts === 0 ? "No bedrooms directly touch active day-use rooms. Good acoustic separation." : `${directContacts} bedroom(s) share walls with kitchen, living, or dining rooms. This may cause noise disturbance.`
    }];
  }
};

// packages/constraint-engine/dist/constraints/soft/geometry-proportion.js
var AspectRatio = {
  id: "SC-GEO-001",
  name: "Room Aspect Ratios",
  description: "Rooms should have reasonable proportions (ideally \u2264 2:1)",
  category: ConstraintCategory.GEOMETRY,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    const results = [];
    for (const room of ctx.allRooms) {
      const aspect = room.width > room.height ? room.width / room.height : room.height / room.width;
      let score;
      let message;
      if (aspect <= 2) {
        score = 10;
        message = `"${room.name}" has good proportions (${aspect.toFixed(1)}:1)`;
      } else if (aspect <= 3) {
        score = 5;
        message = `"${room.name}" is somewhat elongated (${aspect.toFixed(1)}:1)`;
      } else {
        score = 0;
        message = `"${room.name}" is excessively elongated (${aspect.toFixed(1)}:1)`;
      }
      results.push({
        constraintId: "SC-GEO-001",
        passed: aspect <= 2,
        severity: ConstraintSeverity.SOFT,
        score,
        maxScore: 10,
        message,
        affectedEntities: aspect > 2 ? [room.id] : [],
        explanation: aspect <= 2 ? `"${room.name}" has a balanced ${aspect.toFixed(1)}:1 aspect ratio, ideal for furniture placement.` : `"${room.name}" has an aspect ratio of ${aspect.toFixed(1)}:1. Ratios above 2:1 make rooms feel corridor-like and limit furniture arrangement.`,
        suggestedFixes: aspect > 2 ? [{
          description: `Adjust "${room.name}" to a more balanced proportion`,
          actionType: "resize",
          targetEntity: room.id,
          priority: 3
        }] : void 0
      });
    }
    if (results.length === 0) {
      results.push({
        constraintId: "SC-GEO-001",
        passed: true,
        severity: ConstraintSeverity.SOFT,
        score: 10,
        maxScore: 10,
        message: "No rooms to evaluate aspect ratios",
        affectedEntities: [],
        explanation: "No rooms present."
      });
    }
    return results;
  }
};
var RoomSizeRange = {
  id: "SC-GEO-002",
  name: "Room Size Within Range",
  description: "Room areas should be within configured min/max for their type",
  category: ConstraintCategory.GEOMETRY,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    const results = [];
    for (const room of ctx.allRooms) {
      const withinRange = (room.minArea === void 0 || room.area >= room.minArea) && (room.maxArea === void 0 || room.area <= room.maxArea);
      results.push({
        constraintId: "SC-GEO-002",
        passed: withinRange,
        severity: ConstraintSeverity.SOFT,
        score: withinRange ? 10 : 3,
        maxScore: 10,
        message: withinRange ? `"${room.name}" is within target size range` : `"${room.name}" is outside target size range`,
        affectedEntities: withinRange ? [] : [room.id],
        explanation: withinRange ? `"${room.name}" area is within the expected range for its type.` : `"${room.name}" area is outside the configured min/max target. Adjust size for optimal space utilization.`
      });
    }
    if (results.length === 0) {
      results.push({
        constraintId: "SC-GEO-002",
        passed: true,
        severity: ConstraintSeverity.SOFT,
        score: 10,
        maxScore: 10,
        message: "Room sizes: no rooms to evaluate",
        affectedEntities: [],
        explanation: "No rooms present."
      });
    }
    return results;
  }
};
var DimensionBalance = {
  id: "SC-GEO-003",
  name: "Bedroom Size Balance",
  description: "Bedroom sizes should be reasonably balanced (stdev < 20% of mean)",
  category: ConstraintCategory.GEOMETRY,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(ctx) {
    const bedrooms = ctx.allRooms.filter((r) => r.type === RoomType.Bedroom);
    if (bedrooms.length < 2) {
      return [{
        constraintId: "SC-GEO-003",
        passed: true,
        severity: ConstraintSeverity.SOFT,
        score: 15,
        maxScore: 15,
        message: "Bedroom balance: fewer than 2 bedrooms",
        affectedEntities: [],
        explanation: "Need at least 2 bedrooms to evaluate size balance."
      }];
    }
    const areas = bedrooms.map((b) => b.area);
    const mean = areas.reduce((s, a) => s + a, 0) / areas.length;
    const variance = areas.reduce((s, a) => s + (a - mean) ** 2, 0) / areas.length;
    const stdev = Math.sqrt(variance);
    const cv = mean > 0 ? stdev / mean : 0;
    const balanced = cv < 0.2;
    return [{
      constraintId: "SC-GEO-003",
      passed: balanced,
      severity: ConstraintSeverity.SOFT,
      score: balanced ? 15 : cv < 0.35 ? 8 : 0,
      maxScore: 15,
      message: balanced ? "Bedroom sizes are well-balanced" : `Bedroom sizes vary significantly (CV: ${(cv * 100).toFixed(0)}%)`,
      affectedEntities: balanced ? [] : bedrooms.map((b) => b.id),
      explanation: balanced ? `Bedroom areas have a coefficient of variation of ${(cv * 100).toFixed(0)}%, indicating balanced sizing.` : `Bedroom areas vary by ${(cv * 100).toFixed(0)}% (coefficient of variation). Consider making bedrooms more similar in size unless one is intentionally a master suite.`
    }];
  }
};

// packages/constraint-engine/dist/constraints/soft/structural.js
var WallAlignment = {
  id: "SC-STR-001",
  name: "Wall Alignment Across Floors",
  description: "Walls on different floors should align vertically for structural efficiency",
  category: ConstraintCategory.STRUCTURAL,
  severity: ConstraintSeverity.WARNING,
  enabled: true,
  evaluate(ctx) {
    if (ctx.building.floors.length < 2) {
      return [{
        constraintId: "SC-STR-001",
        passed: true,
        severity: ConstraintSeverity.WARNING,
        score: 0,
        maxScore: 0,
        status: EvaluationStatus.NOT_APPLICABLE,
        classification: "heuristic",
        message: "Wall alignment: single floor \u2014 not applicable",
        affectedEntities: [],
        explanation: "Wall alignment across floors is only relevant for multi-storey buildings."
      }];
    }
    const floor0Rooms = ctx.building.floors[0]?.rooms ?? [];
    const floor1Rooms = ctx.building.floors[1]?.rooms ?? [];
    if (floor0Rooms.length === 0 || floor1Rooms.length === 0) {
      return [{
        constraintId: "SC-STR-001",
        passed: true,
        severity: ConstraintSeverity.WARNING,
        score: 0,
        maxScore: 0,
        status: EvaluationStatus.INSUFFICIENT_INPUT,
        classification: "heuristic",
        message: "Wall alignment: insufficient data",
        affectedEntities: [],
        explanation: "Cannot evaluate wall alignment \u2014 one or more floors have no rooms."
      }];
    }
    return [{
      constraintId: "SC-STR-001",
      passed: true,
      severity: ConstraintSeverity.WARNING,
      score: 7,
      maxScore: 10,
      status: EvaluationStatus.WARNING,
      classification: "heuristic",
      message: "Wall alignment: partially evaluated (detailed check requires wall data)",
      affectedEntities: [],
      explanation: "Full wall alignment analysis requires complete wall geometry on both floors. A structural engineer should verify vertical alignment for multi-storey designs."
    }];
  }
};
var ColumnGrid = {
  id: "SC-STR-002",
  name: "Column Grid Regularity",
  description: "Columns should form a regular grid pattern where present",
  category: ConstraintCategory.STRUCTURAL,
  severity: ConstraintSeverity.INFORMATIONAL,
  enabled: true,
  evaluate(ctx) {
    let totalColumns = 0;
    for (const floor of ctx.building.floors) {
      totalColumns += floor.columns.length;
    }
    if (totalColumns === 0) {
      return [{
        constraintId: "SC-STR-002",
        passed: true,
        severity: ConstraintSeverity.INFORMATIONAL,
        score: 0,
        maxScore: 0,
        status: EvaluationStatus.NOT_ANALYZED,
        classification: "not_implemented",
        message: "Structural analysis: not analyzed \u2014 no column system is defined",
        affectedEntities: [],
        explanation: "No structural columns are defined in this plan. Column grid analysis is not applicable."
      }];
    }
    return [{
      constraintId: "SC-STR-002",
      passed: true,
      severity: ConstraintSeverity.INFORMATIONAL,
      score: 0,
      maxScore: 0,
      status: EvaluationStatus.NOT_IMPLEMENTED,
      classification: "not_implemented",
      message: `Structural analysis: not implemented (${totalColumns} columns documented)`,
      affectedEntities: [],
      explanation: `The plan includes ${totalColumns} structural columns. Grid regularity analysis will be available in a future phase.`
    }];
  }
};

// packages/constraint-engine/dist/constraints/soft/space-utilization.js
var WARNING_THRESHOLD = 0.35;
var FloorSpaceUtilization = {
  id: "SC-EFF-001",
  name: "Floor Space Utilization",
  description: "Each floor should avoid excessive unallocated residual area",
  category: ConstraintCategory.FUNCTIONAL_ZONING,
  severity: ConstraintSeverity.SOFT,
  enabled: true,
  evaluate(context) {
    return context.building.floors.map((floor) => {
      const floorArea = polygonArea2(floor.boundary);
      const assignedArea = floor.rooms.reduce((sum, room) => sum + room.area, 0);
      const unusedRatio = floorArea > 0 ? Math.max(0, floorArea - assignedArea) / floorArea : 1;
      const passed = unusedRatio <= WARNING_THRESHOLD;
      const score = Math.max(0, Math.round(20 * (1 - Math.max(0, unusedRatio - 0.1) / 0.5)));
      return {
        constraintId: "SC-EFF-001",
        passed,
        severity: ConstraintSeverity.SOFT,
        score,
        maxScore: 20,
        message: passed ? `${floor.name} uses ${Math.round((1 - unusedRatio) * 100)}% of its floor boundary` : `${floor.name} has ${Math.round(unusedRatio * 100)}% unexplained unused area`,
        affectedEntities: passed ? [] : [floor.id],
        explanation: passed ? "Residual area is within the schematic planning allowance." : "This area is not represented as a room, circulation space, terrace, void, or other intentional use.",
        suggestedFixes: passed ? void 0 : [{
          description: `Redistribute rooms or reduce ${floor.name}'s footprint`,
          actionType: "resize",
          targetEntity: floor.id,
          priority: 4
        }]
      };
    });
  }
};

// packages/constraint-engine/dist/config.js
var DEFAULT_WEIGHTS = {
  [ConstraintCategory.GEOMETRY]: 0.15,
  [ConstraintCategory.ACCESSIBILITY]: 0.2,
  [ConstraintCategory.CIRCULATION]: 0.15,
  [ConstraintCategory.DAYLIGHT]: 0.15,
  [ConstraintCategory.PRIVACY]: 0.12,
  [ConstraintCategory.FUNCTIONAL_ZONING]: 0.08,
  [ConstraintCategory.VASTU]: 0.1,
  [ConstraintCategory.USER_PREFERENCE]: 0.05
};
var DEFAULT_WEIGHTS_NO_VASTU = {
  [ConstraintCategory.GEOMETRY]: 0.17,
  [ConstraintCategory.ACCESSIBILITY]: 0.22,
  [ConstraintCategory.CIRCULATION]: 0.17,
  [ConstraintCategory.DAYLIGHT]: 0.17,
  [ConstraintCategory.PRIVACY]: 0.13,
  [ConstraintCategory.FUNCTIONAL_ZONING]: 0.09,
  [ConstraintCategory.VASTU]: 0,
  [ConstraintCategory.USER_PREFERENCE]: 0.05
};

// packages/constraint-engine/dist/evaluation-status.js
var NON_SCORABLE = /* @__PURE__ */ new Set([
  EvaluationStatus.NOT_APPLICABLE,
  EvaluationStatus.NOT_ANALYZED,
  EvaluationStatus.NOT_CHECKED,
  EvaluationStatus.INSUFFICIENT_INPUT,
  EvaluationStatus.NOT_IMPLEMENTED
]);

// packages/constraint-engine/dist/apartment-closure.js
function sharesBoundarySegment(polyA, polyB, minOverlap) {
  const ptsA = polyA.points;
  const ptsB = polyB.points;
  for (let i = 0; i < ptsA.length; i++) {
    const a1 = ptsA[i];
    const a2 = ptsA[(i + 1) % ptsA.length];
    const isHorizA = Math.abs(a1.y - a2.y) <= 2;
    const isVertA = Math.abs(a1.x - a2.x) <= 2;
    if (!isHorizA && !isVertA)
      continue;
    for (let j = 0; j < ptsB.length; j++) {
      const b1 = ptsB[j];
      const b2 = ptsB[(j + 1) % ptsB.length];
      if (isHorizA && Math.abs(b1.y - b2.y) <= 2 && Math.abs(a1.y - b1.y) <= 5) {
        const overlap = Math.min(Math.max(a1.x, a2.x), Math.max(b1.x, b2.x)) - Math.max(Math.min(a1.x, a2.x), Math.min(b1.x, b2.x));
        if (overlap >= minOverlap - 2)
          return true;
      } else if (isVertA && Math.abs(b1.x - b2.x) <= 2 && Math.abs(a1.x - b1.x) <= 5) {
        const overlap = Math.min(Math.max(a1.y, a2.y), Math.max(b1.y, b2.y)) - Math.max(Math.min(a1.y, a2.y), Math.min(b1.y, b2.y));
        if (overlap >= minOverlap - 2)
          return true;
      }
    }
  }
  return false;
}
function validateApartmentClosure(building, manifest) {
  const dynamicManifest = manifest ?? building.dynamicManifest ?? building.metadata?.dynamicManifest;
  const issues = [];
  const add = (code, message, severity = "error") => issues.push({ code, severity, message });
  const ledgers = building.floors.map((floor) => {
    const rooms = floor.rooms;
    const graph = new Map(rooms.map((r) => [r.id, /* @__PURE__ */ new Set()]));
    for (const r of rooms) {
      if (r.tags.some((t) => t.startsWith("flat:")) && !r.unitId)
        add("ROOM_OWNERSHIP_MISSING", r.id);
      const unit = floor.apartmentUnits?.find((u) => u.id === r.unitId);
      if (r.unitId) {
        if (!unit) {
          add("ROOM_OUTSIDE_UNIT", r.id);
        } else if (!containsPolygon(unit.boundary, r.boundary)) {
          const isBalcony = r.type === "balcony" || r.type === "utility" || r.spaceUse === "OUTDOOR" || r.tags.some((t) => t.includes("balcony") || t.includes("balc")) || r.name.toLowerCase().includes("balc");
          if (isBalcony) {
            const hasConnectingDoor = floor.doors.some((d) => d.connectsRooms.includes(r.id) && d.connectsRooms.some((otherId) => otherId !== r.id && rooms.some((other) => other.id === otherId && other.unitId === r.unitId)));
            const sharesSegment = sharesBoundarySegment(r.boundary, unit.boundary, 1200) || rooms.some((other) => other.unitId === r.unitId && other.id !== r.id && sharesBoundarySegment(r.boundary, other.boundary, 1200));
            if (!hasConnectingDoor && !sharesSegment) {
              add("ROOM_OUTSIDE_UNIT", r.id);
            }
          } else {
            add("ROOM_OUTSIDE_UNIT", r.id);
          }
        }
      }
      if (floor.voidBoundaries?.some((p) => polygonIntersectionArea(p, r.boundary) > 1))
        add("ROOM_OVERLAPS_VOID", r.id);
      if (!containsPolygon(floor.boundary, r.boundary))
        add("ROOM_OUTSIDE_FLOOR", r.id);
    }
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        if (polygonIntersectionArea(rooms[i].boundary, rooms[j].boundary) > 1) {
          add("ROOM_OVERLAP", `${rooms[i].id} / ${rooms[j].id}`);
        }
      }
    }
    const units = floor.apartmentUnits ?? [];
    const manifestUnits = Array.isArray(dynamicManifest?.units) ? dynamicManifest.units : Array.isArray(dynamicManifest?.units?.units) ? dynamicManifest.units.units : [];
    const expectedFlats = typeof dynamicManifest?.flatsPerFloor === "number" ? dynamicManifest.flatsPerFloor : typeof dynamicManifest?.units?.exactCount === "number" ? dynamicManifest.units.exactCount : void 0;
    if (expectedFlats !== void 0 && units.length !== expectedFlats) {
      add("UNIT_COUNT_MISMATCH", `expected ${expectedFlats} units, found ${units.length}`);
    }
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (!containsPolygon(floor.boundary, u.boundary))
        add("UNIT_OUTSIDE_FLOOR", u.id);
      for (let j = i + 1; j < units.length; j++) {
        if (polygonIntersectionArea(u.boundary, units[j].boundary) > 1) {
          add("UNIT_OVERLAP", `${u.id}/${units[j].id}`);
        }
      }
      for (const r of rooms.filter((r2) => !r2.unitId)) {
        if (polygonIntersectionArea(u.boundary, r.boundary) > 1) {
          add("UNIT_CORE_CONFLICT", `${u.id}/${r.id}`);
        }
      }
    }
    for (const wall of floor.walls) {
      if (wall.roomIds.length > 2 || wall.thickness <= 0 || !wall.wallUse)
        add("WALL_TOPOLOGY_INVALID", wall.id);
      const isPartyWall = wall.unitIds && wall.unitIds.length > 1 || wall.wallUse === "UNIT_SEPARATION";
      if (isPartyWall && wall.thickness < 230) {
        add("PARTY_WALL_THICKNESS_INSUFFICIENT", `${wall.id}: ${wall.thickness} mm (minimum 230 mm party wall required)`);
      }
      for (const id of wall.roomIds) {
        const room = rooms.find((r) => r.id === id);
        const pts = room?.boundary.points ?? [];
        const onEdge = (p) => pts.some((a, i) => {
          const b = pts[(i + 1) % pts.length];
          const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
          return L > 0 && Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) / L <= 1 && p.x >= Math.min(a.x, b.x) - 1 && p.x <= Math.max(a.x, b.x) + 1 && p.y >= Math.min(a.y, b.y) - 1 && p.y <= Math.max(a.y, b.y) + 1;
        });
        if (!onEdge(wall.startPoint) || !onEdge(wall.endPoint))
          add("WALL_ROOM_BOUNDARY_MISMATCH", `${wall.id}/${id}`);
      }
    }
    const validDoors = /* @__PURE__ */ new Set();
    for (const door of floor.doors) {
      const host = floor.walls.find((w) => w.id === door.wallId);
      const a = rooms.find((r) => r.id === door.connectsRooms[0]), b = rooms.find((r) => r.id === door.connectsRooms[1]);
      if (!host || !openingFitsApartmentWall(host, door.position, door.width) || !a || !b || !host.roomIds.includes(a.id) || !host.roomIds.includes(b.id)) {
        add("OPENING_HOST_INVALID", door.id);
        continue;
      }
      validDoors.add(door.id);
      graph.get(a.id).add(b.id);
      graph.get(b.id).add(a.id);
      if (a.unitId && b.unitId && a.unitId !== b.unitId)
        add("UNIT_ACCESS_CROSSES_OWNERSHIP", door.id);
      const inside = a.unitId ? a : b.unitId ? b : null;
      if (inside && a.unitId !== b.unitId && !["foyer", "living", "dining"].includes(inside.type))
        add("PRIMARY_ENTRANCE_PRIVATE_ROOM", door.id);
      const isEntrance = (a.spaceUse === "COMMON" || a.spaceUse === "CORE" || !a.unitId) && b.unitId || (b.spaceUse === "COMMON" || b.spaceUse === "CORE" || !b.unitId) && a.unitId;
      if (isEntrance && door.width < 1e3) {
        add("PRIMARY_ENTRANCE_DOOR_WIDTH_SUBSTANDARD", `${door.id}: width ${door.width} mm < 1000 mm`);
      }
      const isBedroomEntrance = a.type === "bedroom" && (b.type === "living" || b.type === "dining" || b.type === "corridor" || b.type === "foyer") || b.type === "bedroom" && (a.type === "living" || a.type === "dining" || a.type === "corridor" || a.type === "foyer");
      if (a.unitId && a.unitId === b.unitId && isBedroomEntrance) {
        if (door.width < 800) {
          add("BEDROOM_DOOR_WIDTH_SUBSTANDARD", `${door.id}: width ${door.width} mm < 800 mm`);
        } else if (door.width < 900) {
          add("BEDROOM_DOOR_WIDTH_BELOW_TARGET", `${door.id}: width ${door.width} mm < 900 mm target`, "warning");
        }
      }
      if (a.unitId && a.unitId === b.unitId && (a.type === "bathroom" || b.type === "bathroom" || a.type === "utility" || b.type === "utility")) {
        if (door.width < 700) {
          add("SERVICE_DOOR_WIDTH_SUBSTANDARD", `${door.id}: width ${door.width} mm < 700 mm`);
        } else if (door.width < 750) {
          add("SERVICE_DOOR_WIDTH_BELOW_TARGET", `${door.id}: width ${door.width} mm < 750 mm target`, "warning");
        }
      }
    }
    for (const window of floor.windows) {
      const host = floor.walls.find((w) => w.id === window.wallId);
      if (!host || !openingFitsApartmentWall(host, window.position, window.width) || !host.roomIds.includes(window.roomId) || host.wallUse !== "EXTERNAL" && host.wallUse !== "SHAFT")
        add("WINDOW_HOST_INVALID", window.id);
    }
    const openings = [...floor.doors, ...floor.windows];
    for (let i = 0; i < openings.length; i++) {
      for (let j = i + 1; j < openings.length; j++) {
        const a = openings[i], b = openings[j];
        if (a.wallId === b.wallId && Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) < (a.width + b.width) / 2 - 1) {
          add("OPENING_OVERLAP", `${a.id}/${b.id}`);
        }
      }
    }
    const walk = (starts, accept) => {
      const visited = new Set(starts);
      const queue = [...starts];
      for (let i = 0; i < queue.length; i++) {
        for (const id of graph.get(queue[i]) ?? []) {
          const r = rooms.find((r2) => r2.id === id);
          if (r && accept(r) && !visited.has(id)) {
            visited.add(id);
            queue.push(id);
          }
        }
      }
      return visited;
    };
    const commonRooms = rooms.filter((r) => r.spaceUse === "COMMON");
    const commonReach = walk(commonRooms.slice(0, 1).map((r) => r.id), (r) => r.spaceUse === "COMMON" || r.spaceUse === "CORE");
    for (const r of rooms.filter((r2) => r2.spaceUse === "COMMON" || r2.spaceUse === "CORE")) {
      if (!commonReach.has(r.id))
        add("COMMON_CORE_ACCESS_DISCONNECTED", r.id);
    }
    for (let uIdx = 0; uIdx < units.length; uIdx++) {
      const u = units[uIdx];
      const unitRooms = rooms.filter((r) => r.unitId === u.id);
      const entrances = floor.doors.filter((d) => validDoors.has(d.id) && d.connectsRooms.some((id) => unitRooms.some((r) => r.id === id)) && d.connectsRooms.some((id) => rooms.some((r) => r.id === id && r.spaceUse === "COMMON")));
      if (entrances.length !== 1)
        add("PRIMARY_ENTRANCE_MISSING", `${u.id}: ${entrances.length} entrances`);
      const entryIds = entrances.flatMap((d) => d.connectsRooms.filter((id) => unitRooms.some((r) => r.id === id)));
      const reached = walk(entryIds, (r) => r.unitId === u.id);
      for (const r of unitRooms)
        if (!reached.has(r.id))
          add("ROOM_ACCESS_DISCONNECTED", r.id);
      if (!entrances.some((d) => d.connectsRooms.some((id) => commonReach.has(id))))
        add("UNIT_ACCESS_DISCONNECTED", u.id);
      const unitSpec = manifestUnits.find((item) => item.unitIndex !== void 0 && item.unitIndex === u.unitIndex || item.unitIndex !== void 0 && item.unitIndex === uIdx + 1 || item.id && (u.id === item.id || u.id.endsWith(String(item.id)) || String(item.id).endsWith(u.id)) || item.unitIndex !== void 0 && u.id.endsWith(String(item.unitIndex)));
      const bedRoomsList = unitRooms.filter((r) => r.type === "bedroom" || r.tags.includes("role:bedroom"));
      const inferredBhk = bedRoomsList.length > 0 ? `${bedRoomsList.length}BHK` : "3BHK";
      const bhkType = unitSpec?.bhkType ?? unitSpec?.type ?? u.unitType ?? inferredBhk;
      const match = String(bhkType).match(/^([1234])BHK$/i);
      const defaultBeds = match ? parseInt(match[1], 10) : 3;
      const expectedBeds = typeof unitSpec?.bedrooms === "number" ? unitSpec.bedrooms : defaultBeds;
      const expectedBaths = typeof unitSpec?.bathrooms === "number" ? unitSpec.bathrooms : unitSpec?.attachedBathCount !== void 0 ? unitSpec.attachedBathCount + 1 : expectedBeds;
      const livingCount = unitRooms.filter((r) => r.type === "living" || r.tags.includes("role:living")).length;
      if (livingCount === 0)
        add("UNIT_ROOM_MANIFEST_INCOMPLETE", `${u.id}: missing living room for ${bhkType}`);
      const kitchenCount = unitRooms.filter((r) => r.type === "kitchen" || r.tags.includes("role:kitchen")).length;
      if (kitchenCount === 0)
        add("UNIT_ROOM_MANIFEST_INCOMPLETE", `${u.id}: missing kitchen for ${bhkType}`);
      const bedCount = bedRoomsList.length;
      if (bedCount !== expectedBeds) {
        add("UNIT_ROOM_MANIFEST_INCOMPLETE", `${u.id}: expected exactly ${expectedBeds} bedrooms for ${bhkType}, found ${bedCount}`);
      }
      const bathCount = unitRooms.filter((r) => r.type === "bathroom" || r.tags.includes("role:bathroom")).length;
      if (bathCount < expectedBaths) {
        add("UNIT_ROOM_MANIFEST_INCOMPLETE", `${u.id}: expected at least ${expectedBaths} bathrooms for ${bhkType}, found ${bathCount}`);
      }
      if (unitSpec?.hasUtilityBalcony || typeof unitSpec?.utilities === "number" && unitSpec.utilities > 0) {
        const hasUtil = unitRooms.some((r) => r.type === "utility" || r.type === "balcony" || r.tags.some((t) => t.includes("utility") || t.includes("balcony")));
        if (!hasUtil)
          add("UNIT_ROOM_MANIFEST_INCOMPLETE", `${u.id}: missing utility balcony for ${bhkType}`);
      }
    }
    for (const r of rooms) {
      if (r.bathroomAccessClass === "UNKNOWN")
        add("BATHROOM_OWNERSHIP_UNKNOWN", r.id, "warning");
      if (r.bathroomOwnerRoomId) {
        const owner = rooms.find((o) => o.id === r.bathroomOwnerRoomId);
        if (!owner || owner.unitId !== r.unitId || owner.type !== "bedroom" || !graph.get(r.id)?.has(owner.id))
          add("BATHROOM_OWNER_ACCESS_MISSING", r.id);
        if ([...graph.get(r.id) ?? []].some((id) => id !== owner?.id))
          add("ATTACHED_BATHROOM_NOT_PRIVATE", r.id);
      }
      const hasBalconyOrUtilityVentilation = r.type === "living" && [...graph.get(r.id) ?? []].some((adjId) => {
        const adj = rooms.find((o) => o.id === adjId);
        return adj?.type === "balcony" || adj?.spaceUse === "OUTDOOR" || adj?.name.toLowerCase().includes("balcony");
      }) || r.type === "kitchen" && [...graph.get(r.id) ?? []].some((adjId) => {
        const adj = rooms.find((o) => o.id === adjId);
        return adj?.type === "utility" || adj?.type === "service_shaft" || adj?.spaceUse === "SERVICE" || adj?.spaceUse === "OUTDOOR" || adj?.name.toLowerCase().includes("utility");
      });
      if (r.unitId && ["living", "bedroom", "kitchen"].includes(r.type) && !floor.windows.some((w) => w.roomId === r.id) && !hasBalconyOrUtilityVentilation)
        add("DAYLIGHT_OPENING_UNVERIFIED", r.id, "warning");
    }
    const ledger = measureApartmentAreaLedger(floor);
    if (!Number.isFinite(ledger.delta) || Math.abs(ledger.delta) >= 1e-3)
      add("AREA_LEDGER_MISMATCH", `${floor.id}: ${ledger.delta} mm2`);
    if (!ledger.supported)
      add("AREA_LEDGER_UNSUPPORTED", floor.id);
    if (ledger.overlap >= 1e-3)
      add("AREA_LEDGER_OVERLAP", `${floor.id}: ${ledger.overlap} mm2`);
    if (ledger.unassigned >= 1e-3)
      add("AREA_UNASSIGNED", `${floor.id}: ${ledger.unassigned} mm2`);
    for (const balcony of ledger.balconies) {
      if (!balcony.unitId || !balcony.accessDoorIds.some((id) => validDoors.has(id)))
        add("BALCONY_ACCESS_MISSING", balcony.id);
      if (!floor.walls.some((w) => w.roomIds.length === 1 && w.roomIds.includes(balcony.id)))
        add("BALCONY_EXTERIOR_EDGE_MISSING", balcony.id);
      if (balcony.usableDepth < 1200)
        add("BALCONY_CLEAR_DEPTH_SUBSTANDARD", `${balcony.id}: clear depth ${balcony.usableDepth} mm < 1200 mm`);
      if (balcony.usableDepth < 1500 || balcony.usableWidth < 2800)
        add("BALCONY_TOO_SMALL", balcony.id, "warning");
    }
    for (const u of units) {
      const nonUtilityBalconies = ledger.balconies.filter((b) => {
        if (b.unitId !== u.id)
          return false;
        const r = rooms.find((room) => room.id === b.id);
        const isUtil = b.id.toLowerCase().includes("utility") || r?.type === "utility" || r?.name.toLowerCase().includes("utility");
        return !isUtil;
      });
      if (nonUtilityBalconies.length > 1)
        add("BALCONY_FRAGMENTATION_HIGH", u.id, "warning");
    }
    if (ledger.unassigned / ledger.gross > 0.15)
      add("UNASSIGNED_AREA_HIGH", floor.id, "warning");
    return ledger;
  });
  return { buildingId: building.id, buildingRevision: building.version, issues, hardErrors: issues.filter((i) => i.severity === "error").length, warnings: issues.filter((i) => i.severity === "warning").length, ledgers, regulatoryStatus: "NOT_VERIFIED", professionalReview: "REQUIRED" };
}

// packages/constraint-engine/dist/raw-planar-conservation.js
function validateRawPlanarConservation(building) {
  return building.floors.map((f) => {
    const ledger = measureApartmentAreaLedger(f), accepted = ledger.supported && Number.isFinite(ledger.delta) && Math.abs(ledger.delta) < 1e-3 && ledger.unassigned < 1e-3 && ledger.overlap < 1e-3 && ledger.roomVoidOverlap < 1e-3;
    return {
      floorId: f.id,
      accepted,
      deltaMm2: ledger.delta,
      unassignedMm2: ledger.unassigned,
      overlapMm2: ledger.overlap,
      roomVoidOverlapMm2: ledger.roomVoidOverlap
    };
  });
}

// packages/planning-engine/src/validator/geometry-validator.ts
var GeometryValidator = class {
  autoCorrect;
  columnMergeThresholdMm;
  minOpeningSeparationMm;
  constructor(options = {}) {
    this.autoCorrect = options.autoCorrect ?? true;
    this.columnMergeThresholdMm = options.columnMergeThresholdMm ?? 2e3;
    this.minOpeningSeparationMm = options.minOpeningSeparationMm ?? 150;
  }
  /**
   * Run the full 5-point mathematical geometry audit and auto-correction.
   */
  audit(building, autoCorrect = this.autoCorrect) {
    const allErrors = [];
    let currentBuilding = building;
    const overlapResult = this.auditRoomAndWallOverlaps(currentBuilding, autoCorrect);
    currentBuilding = overlapResult.building;
    allErrors.push(...overlapResult.errors);
    const columnResult = this.auditAndFixColumnAndBeamGrid(currentBuilding, autoCorrect);
    currentBuilding = columnResult.building;
    allErrors.push(...columnResult.errors);
    const openingResult = this.auditAndFixOpenings(currentBuilding, autoCorrect);
    currentBuilding = openingResult.building;
    allErrors.push(...openingResult.errors);
    const stairResult = this.auditStaircaseContinuity(currentBuilding, autoCorrect);
    currentBuilding = stairResult.building;
    allErrors.push(...stairResult.errors);
    const annoResult = this.auditAnnotationCollisions(currentBuilding, autoCorrect);
    currentBuilding = annoResult.building;
    allErrors.push(...annoResult.errors);
    const finalGeometry = this.auditRoomAndWallOverlaps(currentBuilding, false);
    allErrors.push(...finalGeometry.errors.filter((e) => !allErrors.some((old) => old.code === e.code && old.floorId === e.floorId && !old.autoCorrected)));
    const criticalCount = allErrors.filter((e) => e.severity === "CRITICAL" && !e.autoCorrected).length;
    const report = {
      isValid: criticalCount === 0,
      planarDeltaMm2: finalGeometry.planarDeltaMm2,
      errors: Object.freeze(allErrors)
    };
    return {
      building: currentBuilding,
      report
    };
  }
  // ───────────────────────────────────────────────────────────────────────────
  // 1. ROOM & WALL OVERLAPS (Sutherland-Hodgman math & Planar Delta)
  // ───────────────────────────────────────────────────────────────────────────
  auditRoomAndWallOverlaps(building, autoCorrect) {
    const errors = [];
    let totalPlanarDelta = 0;
    const updatedFloors = building.floors.map((floor) => {
      const rooms = [...floor.rooms];
      for (let i = 0; i < rooms.length; i++) {
        for (let j = i + 1; j < rooms.length; j++) {
          const roomA = rooms[i];
          const roomB = rooms[j];
          const overlapArea = polygonIntersectionArea(roomA.boundary, roomB.boundary);
          if (overlapArea >= 1e-3) {
            const locX = (roomA.x + roomB.x) / 2;
            const locY = (roomA.y + roomB.y) / 2;
            errors.push({
              code: "ROOM_OVERLAP",
              severity: "CRITICAL",
              elementIds: [roomA.id, roomB.id],
              floorId: floor.id,
              locationMm: { x: locX, y: locY },
              description: `Unintended room overlap between "${roomA.name}" and "${roomB.name}" (${overlapArea.toFixed(2)} mm\xB2)`,
              autoCorrected: autoCorrect
            });
            if (autoCorrect) {
              const xOverlapMin = Math.max(roomA.x, roomB.x);
              const xOverlapMax = Math.min(roomA.x + roomA.width, roomB.x + roomB.width);
              const yOverlapMin = Math.max(roomA.y, roomB.y);
              const yOverlapMax = Math.min(roomA.y + roomA.height, roomB.y + roomB.height);
              const overlapWidth = xOverlapMin < xOverlapMax ? xOverlapMax - xOverlapMin : 0;
              const overlapHeight = yOverlapMin < yOverlapMax ? yOverlapMax - yOverlapMin : 0;
              if (overlapWidth > 0 && overlapHeight > 0) {
                if (overlapWidth <= overlapHeight) {
                  if (roomA.x < roomB.x) {
                    const newWidthB = Math.max(100, roomB.width - overlapWidth);
                    const newXB = roomB.x + overlapWidth;
                    rooms[j] = this.rebuildRectRoom(roomB, newXB, roomB.y, newWidthB, roomB.height);
                  } else {
                    const newWidthA = Math.max(100, roomA.width - overlapWidth);
                    const newXA = roomA.x + overlapWidth;
                    rooms[i] = this.rebuildRectRoom(roomA, newXA, roomA.y, newWidthA, roomA.height);
                  }
                } else {
                  if (roomA.y < roomB.y) {
                    const newHeightB = Math.max(100, roomB.height - overlapHeight);
                    const newYB = roomB.y + overlapHeight;
                    rooms[j] = this.rebuildRectRoom(roomB, roomB.x, newYB, roomB.width, newHeightB);
                  } else {
                    const newHeightA = Math.max(100, roomA.height - overlapHeight);
                    const newYA = roomA.y + overlapHeight;
                    rooms[i] = this.rebuildRectRoom(roomA, roomA.x, newYA, roomA.width, newHeightA);
                  }
                }
              }
            }
          }
        }
      }
      const measuredFloor = { ...floor, rooms };
      const ledger = measureApartmentAreaLedger(measuredFloor);
      const floorDelta = Math.abs(ledger.delta);
      totalPlanarDelta += floorDelta;
      for (const [code, area, description] of [
        ["PLANAR_DELTA_NONZERO", floorDelta, "Disjoint component area differs from gross floor area"],
        ["UNASSIGNED_AREA", ledger.unassigned, "Floor contains unassigned area"],
        ["ROOM_VOID_OVERLAP", ledger.roomVoidOverlap, "Room overlaps an explicit void"]
      ]) {
        if (!Number.isFinite(area) || area >= 1e-3) errors.push({
          code,
          severity: "CRITICAL",
          elementIds: [floor.id],
          floorId: floor.id,
          locationMm: floor.boundary.points[0] ?? { x: 0, y: 0 },
          description: `${description}: ${area} mm\xB2`,
          autoCorrected: false
        });
      }
      if (!ledger.supported) errors.push({
        code: "UNSUPPORTED_LEDGER_GEOMETRY",
        severity: "CRITICAL",
        elementIds: [floor.id],
        floorId: floor.id,
        locationMm: floor.boundary.points[0] ?? { x: 0, y: 0 },
        description: "The canonical cell ledger requires finite orthogonal polygons.",
        autoCorrected: false
      });
      return {
        ...floor,
        rooms
      };
    });
    return this.confirmRepairs(building, {
      building: {
        ...building,
        floors: updatedFloors,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      },
      errors,
      planarDeltaMm2: totalPlanarDelta
    }, autoCorrect, (candidate) => this.auditRoomAndWallOverlaps(candidate, false));
  }
  // ───────────────────────────────────────────────────────────────────────────
  // 2. COLUMN & BEAM POSITIONING (Snapping, Deduplication, S-BEAM Centerlines)
  // ───────────────────────────────────────────────────────────────────────────
  auditAndFixColumnAndBeamGrid(building, autoCorrect) {
    const errors = [];
    const updatedFloors = building.floors.map((floor) => {
      let columns = [...floor.columns];
      const walls = floor.walls;
      const habitableRoomTypes = /* @__PURE__ */ new Set([
        RoomType.Kitchen,
        RoomType.Bedroom,
        RoomType.Living,
        RoomType.Dining,
        RoomType.Bathroom,
        RoomType.Pooja,
        RoomType.Study
      ]);
      const wallCorners = [];
      walls.forEach((w) => {
        wallCorners.push(w.startPoint, w.endPoint);
      });
      columns = columns.map((col) => {
        let isFloating = false;
        let hostRoom;
        for (const room of floor.rooms) {
          if (habitableRoomTypes.has(room.type) && pointInPolygon(col.position, room.boundary)) {
            let minWallDist = Number.POSITIVE_INFINITY;
            for (const wall of walls) {
              const seg = { start: wall.startPoint, end: wall.endPoint };
              const d = pointToSegmentDistance(col.position, seg);
              if (d < minWallDist) minWallDist = d;
            }
            const maxEmbeddedDistance = 150;
            if (minWallDist > maxEmbeddedDistance) {
              isFloating = true;
              hostRoom = room;
              break;
            }
          }
        }
        if (isFloating && hostRoom) {
          errors.push({
            code: "FLOATING_COLUMN",
            severity: "CRITICAL",
            elementIds: [col.id],
            floorId: floor.id,
            locationMm: col.position,
            description: `Column ${col.id} is floating inside ${hostRoom.name} (${hostRoom.type}) interior`,
            autoCorrected: autoCorrect
          });
          if (autoCorrect) {
            let bestPoint = col.position;
            let minDist = Number.POSITIVE_INFINITY;
            for (const wall of walls) {
              const segA = wall.startPoint;
              const segB = wall.endPoint;
              const l2 = (segB.x - segA.x) ** 2 + (segB.y - segA.y) ** 2;
              let pt;
              if (l2 === 0) {
                pt = segA;
              } else {
                let t = ((col.position.x - segA.x) * (segB.x - segA.x) + (col.position.y - segA.y) * (segB.y - segA.y)) / l2;
                t = Math.max(0, Math.min(1, t));
                pt = { x: Math.round(segA.x + t * (segB.x - segA.x)), y: Math.round(segA.y + t * (segB.y - segA.y)) };
              }
              const d = distance(col.position, pt);
              if (d < minDist) {
                minDist = d;
                bestPoint = pt;
              }
            }
            for (const corner of wallCorners) {
              if (distance(bestPoint, corner) < 500) {
                bestPoint = corner;
                break;
              }
            }
            return {
              ...col,
              position: { x: Math.round(bestPoint.x), y: Math.round(bestPoint.y) }
            };
          }
        }
        return col;
      });
      const dedupedColumns = [];
      const removedIds = /* @__PURE__ */ new Set();
      for (let i = 0; i < columns.length; i++) {
        const c1 = columns[i];
        if (removedIds.has(c1.id)) continue;
        let mergedCol = c1;
        for (let j = i + 1; j < columns.length; j++) {
          const c2 = columns[j];
          if (removedIds.has(c2.id)) continue;
          const dist = distance(c1.position, c2.position);
          const dx = Math.abs(c1.position.x - c2.position.x);
          const dy = Math.abs(c1.position.y - c2.position.y);
          const isAlongAxis = dx < 150 || dy < 150;
          if (dist < this.columnMergeThresholdMm && isAlongAxis) {
            errors.push({
              code: "DUPLICATE_COLUMN",
              severity: "CRITICAL",
              elementIds: [c1.id, c2.id],
              floorId: floor.id,
              locationMm: {
                x: Math.round((c1.position.x + c2.position.x) / 2),
                y: Math.round((c1.position.y + c2.position.y) / 2)
              },
              description: `Duplicate/proximate columns ${c1.id} and ${c2.id} closer than ${this.columnMergeThresholdMm}mm (${dist.toFixed(0)}mm)`,
              autoCorrected: autoCorrect
            });
            if (autoCorrect) {
              mergedCol = c1;
              removedIds.add(c2.id);
            }
          }
        }
        dedupedColumns.push(mergedCol);
      }
      const generatedBeams = [];
      const cols = dedupedColumns;
      if (autoCorrect) {
        const gridTolerance = 150;
        const xLines = /* @__PURE__ */ new Map();
        const yLines = /* @__PURE__ */ new Map();
        cols.forEach((col) => {
          let foundX = false;
          for (const [gx, list] of xLines.entries()) {
            if (Math.abs(col.position.x - gx) <= gridTolerance) {
              list.push(col);
              foundX = true;
              break;
            }
          }
          if (!foundX) xLines.set(col.position.x, [col]);
          let foundY = false;
          for (const [gy, list] of yLines.entries()) {
            if (Math.abs(col.position.y - gy) <= gridTolerance) {
              list.push(col);
              foundY = true;
              break;
            }
          }
          if (!foundY) yLines.set(col.position.y, [col]);
        });
        for (const [, list] of xLines.entries()) {
          const sorted = [...list].sort((a, b) => a.position.y - b.position.y);
          for (let idx = 0; idx < sorted.length - 1; idx++) {
            const cA = sorted[idx];
            const cB = sorted[idx + 1];
            const span = Math.abs(cB.position.y - cA.position.y);
            if (span >= 1e3 && span <= 9e3) {
              generatedBeams.push({
                id: generateId(),
                floorId: floor.id,
                startColumnId: cA.id,
                endColumnId: cB.id,
                startPoint: cA.position,
                endPoint: cB.position,
                widthMm: 230,
                depthMm: 450,
                type: "PRIMARY"
              });
            }
          }
        }
        for (const [, list] of yLines.entries()) {
          const sorted = [...list].sort((a, b) => a.position.x - b.position.x);
          for (let idx = 0; idx < sorted.length - 1; idx++) {
            const cA = sorted[idx];
            const cB = sorted[idx + 1];
            const span = Math.abs(cB.position.x - cA.position.x);
            if (span >= 1e3 && span <= 9e3) {
              generatedBeams.push({
                id: generateId(),
                floorId: floor.id,
                startColumnId: cA.id,
                endColumnId: cB.id,
                startPoint: cA.position,
                endPoint: cB.position,
                widthMm: 230,
                depthMm: 450,
                type: "PRIMARY"
              });
            }
          }
        }
        walls.forEach((wall) => {
          if (wall.type === WallType.Internal || wall.loadBearing) {
            const wallLen = distance(wall.startPoint, wall.endPoint);
            if (wallLen > 1500 && wallLen <= 8e3) {
              const isCovered = generatedBeams.some(
                (b) => distance(b.startPoint, wall.startPoint) < 300 && distance(b.endPoint, wall.endPoint) < 300
              );
              if (!isCovered) {
                generatedBeams.push({
                  id: generateId(),
                  floorId: floor.id,
                  startPoint: wall.startPoint,
                  endPoint: wall.endPoint,
                  widthMm: 230,
                  depthMm: 450,
                  type: "SECONDARY"
                });
              }
            }
          }
        });
        floor.rooms.filter((r) => r.type === RoomType.Balcony || r.type === RoomType.Terrace).forEach((balc) => {
          cols.forEach((col) => {
            const d = pointToSegmentDistance(col.position, {
              start: { x: balc.x, y: balc.y },
              end: { x: balc.x + balc.width, y: balc.y }
            });
            if (d < 500) {
              const cantileverEnd = {
                x: col.position.x,
                y: col.position.y > balc.y ? balc.y : balc.y + balc.height
              };
              generatedBeams.push({
                id: generateId(),
                floorId: floor.id,
                startColumnId: col.id,
                startPoint: col.position,
                endPoint: cantileverEnd,
                widthMm: 230,
                depthMm: 450,
                type: "CANTILEVER"
              });
            }
          });
        });
      }
      return {
        ...floor,
        columns: dedupedColumns,
        beams: autoCorrect ? generatedBeams : floor.beams
      };
    });
    return this.confirmRepairs(building, {
      building: {
        ...building,
        floors: updatedFloors
      },
      errors
    }, autoCorrect, (candidate) => this.auditAndFixColumnAndBeamGrid(candidate, false));
  }
  // ───────────────────────────────────────────────────────────────────────────
  // 3. OPENING & BOUNDARY COLLISIONS (Exterior Doors & Door/Window Overlaps)
  // ───────────────────────────────────────────────────────────────────────────
  auditAndFixOpenings(building, autoCorrect) {
    const errors = [];
    const updatedFloors = building.floors.map((floor) => {
      let doors = [...floor.doors];
      const windows = [...floor.windows];
      const walls = floor.walls;
      const outdoorRoomTypes = /* @__PURE__ */ new Set([
        RoomType.Balcony,
        RoomType.Terrace,
        RoomType.Garden,
        RoomType.Porch
      ]);
      const survivingDoors = [];
      for (const door of doors) {
        const wall = walls.find((w) => w.id === door.wallId);
        const isExternalWall = wall?.type === WallType.External || wall?.wallUse === "EXTERNAL";
        if (isExternalWall) {
          const hasOutdoorTarget = floor.rooms.some((room) => (outdoorRoomTypes.has(room.type) || room.type === RoomType.Utility) && door.connectsRooms.includes(room.id) && room.boundary.points.some((point, index) => {
            const end = room.boundary.points[(index + 1) % room.boundary.points.length];
            const segment = { start: point, end };
            const segmentLength2 = distance(point, end);
            return pointToSegmentDistance(door.position, segment) <= 1 && segmentLength2 >= door.width && distance(point, door.position) >= door.width / 2 && distance(end, door.position) >= door.width / 2;
          }));
          if (!hasOutdoorTarget) {
            errors.push({
              code: "EXTERIOR_DOOR_COLLISION",
              severity: "CRITICAL",
              elementIds: [door.id],
              floorId: floor.id,
              locationMm: door.position,
              description: `Exterior door ${door.id} on external wall ${door.wallId} lacks an adjacent Balcony or Terrace`,
              autoCorrected: autoCorrect
            });
            if (autoCorrect) {
              const convertedWindow = {
                id: door.id.replace("door", "wind") || generateId(),
                floorId: floor.id,
                wallId: door.wallId,
                position: door.position,
                width: 1200,
                height: 1200,
                sillHeight: 900,
                type: WindowType.Casement,
                styleId: "CASEMENT_ALUMINUM",
                roomId: door.connectsRooms[0] || ""
              };
              windows.push(convertedWindow);
              continue;
            }
          }
        }
        survivingDoors.push(door);
      }
      doors = survivingDoors;
      for (const wall of walls) {
        const wallDoors = doors.filter((d) => d.wallId === wall.id);
        const wallWindows = windows.filter((w) => w.wallId === wall.id);
        if (wallDoors.length === 0 || wallWindows.length === 0) continue;
        const wallLen = distance(wall.startPoint, wall.endPoint);
        if (wallLen <= 10) continue;
        const ux = (wall.endPoint.x - wall.startPoint.x) / wallLen;
        const uy = (wall.endPoint.y - wall.startPoint.y) / wallLen;
        for (const door of wallDoors) {
          const doorT = (door.position.x - wall.startPoint.x) * ux + (door.position.y - wall.startPoint.y) * uy;
          const doorStart = doorT - door.width / 2;
          const doorEnd = doorT + door.width / 2;
          for (let wIdx = 0; wIdx < wallWindows.length; wIdx++) {
            const wind = wallWindows[wIdx];
            const windT = (wind.position.x - wall.startPoint.x) * ux + (wind.position.y - wall.startPoint.y) * uy;
            const windStart = windT - wind.width / 2;
            const windEnd = windT + wind.width / 2;
            const overlaps = Math.max(doorStart, windStart) < Math.min(doorEnd, windEnd);
            if (overlaps) {
              errors.push({
                code: "OPENING_COLLISION",
                severity: "CRITICAL",
                elementIds: [door.id, wind.id],
                floorId: floor.id,
                locationMm: wind.position,
                description: `Door ${door.id} and Window ${wind.id} overlap on wall ${wall.id}`,
                autoCorrected: autoCorrect
              });
              if (autoCorrect) {
                let newWindT = doorEnd + this.minOpeningSeparationMm + wind.width / 2;
                if (newWindT + wind.width / 2 > wallLen) {
                  newWindT = doorStart - this.minOpeningSeparationMm - wind.width / 2;
                }
                newWindT = Math.max(wind.width / 2, Math.min(wallLen - wind.width / 2, newWindT));
                const newPos = {
                  x: Math.round(wall.startPoint.x + ux * newWindT),
                  y: Math.round(wall.startPoint.y + uy * newWindT)
                };
                const targetIdx = windows.findIndex((w) => w.id === wind.id);
                if (targetIdx !== -1) {
                  windows[targetIdx] = {
                    ...wind,
                    position: newPos
                  };
                }
              }
            }
          }
        }
      }
      return {
        ...floor,
        doors,
        windows
      };
    });
    return this.confirmRepairs(building, {
      building: {
        ...building,
        floors: updatedFloors
      },
      errors
    }, autoCorrect, (candidate) => this.auditAndFixOpenings(candidate, false));
  }
  // ───────────────────────────────────────────────────────────────────────────
  // 4. STAIRCASE CONTINUITY & ACCESS (Vertical Core & Unobstructed OPEN_PASSAGE)
  // ───────────────────────────────────────────────────────────────────────────
  auditStaircaseContinuity(building, autoCorrect) {
    const errors = [];
    const floors = building.floors;
    if (floors.length === 0) return { building, errors };
    const refFloor = floors.find((f) => f.stairs.length > 0) || floors[0];
    const refStair = refFloor.stairs[0];
    const masterCoord = refStair ? { x: refStair.x, y: refStair.y, width: refStair.width, length: refStair.length } : { x: 3e3, y: 3e3, width: 2400, height: 4800, length: 4800 };
    const updatedFloors = floors.map((floor) => {
      let stairs = [...floor.stairs];
      const canonicalStaircases = [...floor.canonicalStaircases ?? []];
      if (stairs.length === 0 && autoCorrect) {
        const newStair = {
          id: generateId(),
          floorId: floor.id,
          type: refStair?.type ?? StairType.UShaped,
          boundary: {
            points: [
              { x: masterCoord.x, y: masterCoord.y },
              { x: masterCoord.x + masterCoord.width, y: masterCoord.y },
              { x: masterCoord.x + masterCoord.width, y: masterCoord.y + masterCoord.length },
              { x: masterCoord.x, y: masterCoord.y + masterCoord.length }
            ]
          },
          x: masterCoord.x,
          y: masterCoord.y,
          width: masterCoord.width,
          length: masterCoord.length,
          direction: refStair?.direction ?? Direction.North,
          riserCount: refStair?.riserCount ?? 20,
          riserHeight: refStair?.riserHeight ?? 150,
          treadDepth: refStair?.treadDepth ?? 250,
          landingWidth: refStair?.landingWidth ?? 1200,
          connectsFloors: [floor.level, floor.level + 1]
        };
        stairs.push(newStair);
      }
      stairs = stairs.map((stair, index) => {
        const reference = refFloor.stairs.find((other) => stair.verticalCoreId && other.verticalCoreId === stair.verticalCoreId) ?? refFloor.stairs[index];
        if (!reference) return stair;
        const masterCoord2 = { x: reference.x, y: reference.y, width: reference.width, length: reference.length };
        const dx = Math.abs(stair.x - masterCoord2.x);
        const dy = Math.abs(stair.y - masterCoord2.y);
        if (dx > 50 || dy > 50) {
          errors.push({
            code: "STAIRCASE_DISCONTINUITY",
            severity: "CRITICAL",
            elementIds: [stair.id],
            floorId: floor.id,
            locationMm: { x: stair.x, y: stair.y },
            description: `Staircase on floor ${floor.id} is vertically misaligned with master core (dx=${dx.toFixed(0)}mm, dy=${dy.toFixed(0)}mm)`,
            autoCorrected: autoCorrect
          });
          if (autoCorrect) {
            return {
              ...stair,
              x: masterCoord2.x,
              y: masterCoord2.y,
              width: masterCoord2.width,
              length: masterCoord2.length,
              boundary: {
                points: [
                  { x: masterCoord2.x, y: masterCoord2.y },
                  { x: masterCoord2.x + masterCoord2.width, y: masterCoord2.y },
                  { x: masterCoord2.x + masterCoord2.width, y: masterCoord2.y + masterCoord2.length },
                  { x: masterCoord2.x, y: masterCoord2.y + masterCoord2.length }
                ]
              }
            };
          }
        }
        return stair;
      });
      stairs.forEach((stair) => {
        const flightW = Math.floor(stair.width / 2);
        const landingDepth = Math.max(1200, stair.landingWidth || 1200);
        const canonical = {
          id: stair.id,
          floorId: floor.id,
          polygon: stair.boundary,
          flight1: {
            points: [
              { x: stair.x, y: stair.y + landingDepth },
              { x: stair.x + flightW, y: stair.y + landingDepth },
              { x: stair.x + flightW, y: stair.y + stair.length },
              { x: stair.x, y: stair.y + stair.length }
            ]
          },
          flight2: {
            points: [
              { x: stair.x + flightW, y: stair.y + landingDepth },
              { x: stair.x + stair.width, y: stair.y + landingDepth },
              { x: stair.x + stair.width, y: stair.y + stair.length },
              { x: stair.x + flightW, y: stair.y + stair.length }
            ]
          },
          midLanding: {
            points: [
              { x: stair.x, y: stair.y },
              { x: stair.x + stair.width, y: stair.y },
              { x: stair.x + stair.width, y: stair.y + landingDepth },
              { x: stair.x, y: stair.y + landingDepth }
            ]
          },
          riserCount: stair.riserCount || 20,
          treadWidthMm: stair.treadDepth || 250,
          clearWidthMm: flightW,
          accessEdge: {
            startPoint: { x: stair.x, y: stair.y + stair.length },
            endPoint: { x: stair.x + flightW, y: stair.y + stair.length },
            type: "OPEN_PASSAGE"
          }
        };
        const existingIdx = canonicalStaircases.findIndex((cs) => cs.id === stair.id);
        if (existingIdx !== -1) {
          canonicalStaircases[existingIdx] = canonical;
        } else {
          canonicalStaircases.push(canonical);
        }
      });
      return {
        ...floor,
        stairs,
        canonicalStaircases: autoCorrect ? canonicalStaircases : floor.canonicalStaircases
      };
    });
    return this.confirmRepairs(building, {
      building: {
        ...building,
        floors: updatedFloors
      },
      errors
    }, autoCorrect, (candidate) => this.auditStaircaseContinuity(candidate, false));
  }
  // ───────────────────────────────────────────────────────────────────────────
  // 5. ANNOTATION & DIMENSION COLLISION DETECTOR
  // ───────────────────────────────────────────────────────────────────────────
  auditAnnotationCollisions(building, autoCorrect) {
    const errors = [];
    const updatedFloors = building.floors.map((floor) => {
      const annotations = [];
      floor.rooms.forEach((r) => {
        annotations.push({
          id: `room-label-${r.id}`,
          text: r.name,
          floorId: floor.id,
          box: {
            x: r.x + r.width / 2 - 600,
            y: r.y + r.height / 2 - 200,
            width: 1200,
            height: 400
          }
        });
      });
      for (let i = 0; i < annotations.length; i++) {
        for (let j = i + 1; j < annotations.length; j++) {
          const annA = annotations[i];
          const annB = annotations[j];
          const boxesCollide = annA.box.x < annB.box.x + annB.box.width && annA.box.x + annA.box.width > annB.box.x && annA.box.y < annB.box.y + annB.box.height && annA.box.y + annA.box.height > annB.box.y;
          if (boxesCollide) {
            errors.push({
              code: "ANNOTATION_COLLISION",
              severity: "WARNING",
              elementIds: [annA.id, annB.id],
              floorId: floor.id,
              locationMm: { x: annA.box.x, y: annA.box.y },
              description: `Annotation bounding box collision between "${annA.text}" and "${annB.text}"`,
              autoCorrected: false
            });
            if (autoCorrect) {
              annB.box = {
                ...annB.box,
                y: annA.box.y + annA.box.height + 150
              };
            }
          }
        }
      }
      return floor;
    });
    return this.confirmRepairs(building, {
      building: {
        ...building,
        floors: updatedFloors
      },
      errors
    }, autoCorrect, (candidate) => this.auditAnnotationCollisions(candidate, false));
  }
  // ───────────────────────────────────────────────────────────────────────────
  // Helper: Rebuild rectangular room
  // ───────────────────────────────────────────────────────────────────────────
  confirmRepairs(original, result, autoCorrect, detect) {
    if (!autoCorrect) return { ...result, building: original, errors: result.errors.map((e) => ({ ...e, autoCorrected: false })) };
    const changed = JSON.stringify(original.floors) !== JSON.stringify(result.building.floors);
    const remaining = detect(result.building).errors;
    return { ...result, errors: result.errors.map((error) => ({
      ...error,
      autoCorrected: changed && !remaining.some((e) => e.code === error.code && e.floorId === error.floorId && e.elementIds.some((id) => error.elementIds.includes(id)))
    })) };
  }
  rebuildRectRoom(room, x, y, width, height) {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rw = Math.round(width);
    const rh = Math.round(height);
    return {
      ...room,
      x: rx,
      y: ry,
      width: rw,
      height: rh,
      area: rw * rh,
      boundary: {
        points: [
          { x: rx, y: ry },
          { x: rx + rw, y: ry },
          { x: rx + rw, y: ry + rh },
          { x: rx, y: ry + rh }
        ]
      }
    };
  }
};
function validateAndRepairBuildingGeometry(building, options) {
  const validator = new GeometryValidator(options);
  return validator.audit(building, options?.autoCorrect ?? true);
}

// packages/planning-engine/src/structural/solver-result.ts
var SolverGeometryInfeasibleError = class extends Error {
  constructor(message, elementIds = [], floorId) {
    super(message);
    this.elementIds = elementIds;
    this.floorId = floorId;
    this.name = "SolverGeometryInfeasibleError";
  }
  code = "SOLVER_GEOMETRY_INFEASIBLE";
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      elementIds: this.elementIds,
      floorId: this.floorId
    };
  }
};
function solverResult(original, candidate, errors) {
  return {
    accepted: errors.length === 0,
    building: errors.length ? original : candidate,
    errors,
    status: errors.length ? "SOLVER_GEOMETRY_INFEASIBLE" : "INTERNAL_ENGINEERING_GATE_PASSED",
    structuralAnalysis: "NOT_RUN"
  };
}
var infeasible = (message, ids = [], floorId) => new SolverGeometryInfeasibleError(message, ids, floorId);

// packages/planning-engine/src/structural/residential-acceptance.ts
function residentialAcceptanceErrors(candidate) {
  const errors = validateRawPlanarConservation(candidate).filter((r) => !r.accepted).map(
    (r) => infeasible(
      `Raw planar partition rejected: ${JSON.stringify(r)}`,
      [r.floorId],
      r.floorId
    )
  );
  for (const floor of candidate.floors.filter(
    (f) => f.floorUse === "RESIDENTIAL"
  ))
    errors.push(
      ...validateApartmentClosure({ ...candidate, floors: [floor] }).issues.filter((i) => i.severity === "error").map((i) => infeasible(i.message, [floor.id], floor.id))
    );
  const audit = new GeometryValidator({ autoCorrect: false }).audit(
    candidate,
    false
  ).report;
  errors.push(
    ...audit.errors.filter((e) => e.severity === "CRITICAL" && !e.autoCorrected).map((e) => infeasible(e.description, e.elementIds, e.floorId))
  );
  errors.push(
    ...validateBuildingSchema(candidate).map(
      (message) => infeasible(`Canonical schema: ${JSON.stringify(message)}`, [
        candidate.id
      ])
    )
  );
  errors.push(...inspectArchitecturalGeometry(candidate).issues.filter((i) => i.severity === "ERROR").map((i) => infeasible(i.code, [i.elementId], i.floorId)));
  return errors;
}

// packages/planning-engine/src/structural/column-grid-generator.ts
var ColumnGridGenerator = class {
  generate(building, structuralEnvelope) {
    const base = building.floors.find((f) => f.floorUse === "RESIDENTIAL"), bounds = base && rectangularBounds(structuralEnvelope ?? base.boundary);
    let plot;
    try {
      plot = permissibleSitePolygon(building.site);
    } catch (error) {
      return solverResult(building, building, [infeasible(String(error))]);
    }
    if (!base || !bounds || !plot || building.site.orientation !== 0)
      return solverResult(building, building, [
        infeasible(
          "A rectangular registered residential envelope and site frame are required."
        )
      ]);
    const axis = (start, end) => {
      const span = end - start, choices = [];
      for (let bays = Math.ceil(span / 6e3); bays <= Math.min(32, Math.floor(span / 3e3)); bays++)
        if (bays > 0)
          choices.push(
            Array.from(
              { length: bays + 1 },
              (_, i) => start + i * span / bays
            )
          );
      const regular = [...choices];
      for (const coordinates of regular)
        for (const shift of [-300, 300, -600, 600, -900, 900]) {
          const adjusted = coordinates.map(
            (v, i) => i === 0 || i === coordinates.length - 1 ? v : v + shift
          );
          if (adjusted.length > 2 && adjusted.every(
            (v, i) => i === 0 || v - adjusted[i - 1] >= 3e3 && v - adjusted[i - 1] <= 6e3
          ))
            choices.push(adjusted);
        }
      return choices.slice(0, 16);
    };
    const xOptions = axis(bounds.minX, bounds.maxX), yOptions = axis(bounds.minY, bounds.maxY);
    let trials = 0, lastErrors = [];
    for (const xs of xOptions)
      for (const ys of yOptions) {
        if (xs.length * ys.length > 256) continue;
        if (++trials > 64)
          return solverResult(building, building, [
            infeasible(
              "Bounded grid search exhausted 64 trials; no proposal was committed."
            )
          ]);
        const result = this.propose(building, xs, ys, plot, structuralEnvelope);
        if (result.accepted) return result;
        if (!lastErrors.length || result.errors.length < lastErrors.length)
          lastErrors = result.errors;
      }
    return solverResult(building, building, [
      infeasible(
        "No compatible wall-flush regular grid satisfies the 3000\u20136000mm project policy."
      ),
      ...lastErrors.slice(0, 5)
    ]);
  }
  propose(building, xs, ys, plot, structuralEnvelope) {
    const errors = [], floors = building.floors.map((f) => {
      const columns = [];
      const cuts = floorOpeningFootprints(f);
      if (cuts.invalidIds.length)
        errors.push(
          infeasible(
            "Invalid opening geometry prevents column clearance checks.",
            cuts.invalidIds,
            f.id
          )
        );
      for (let i = 0; i < xs.length; i++)
        for (let j = 0; j < ys.length; j++) {
          const position = { x: xs[i], y: ys[j] };
          const walls = f.walls.filter(
            (w) => (w.wallUse === "EXTERNAL" || w.wallUse === "UNIT_SEPARATION" || w.loadBearing) && [230, 300].includes(w.thickness)
          );
          const proto = {
            id: `hardening:${f.id}:column:${i}:${j}`,
            floorId: f.id,
            position,
            width: 230,
            depth: 230,
            shape: ColumnShape.Rectangular,
            isStructural: true,
            gridReference: `${i}:${j}`
          };
          const thickness = [230, 300].find(
            (n) => fitsResidentialBearingWalls(
              { ...proto, width: n, depth: n },
              walls
            )
          );
          const c = thickness ? { ...proto, width: thickness, depth: thickness } : proto;
          if (f.floorUse === "RESIDENTIAL" && !thickness)
            errors.push(
              infeasible(
                `Grid node at (${position.x}, ${position.y}) cannot fit flush in an exterior/party/load-bearing wall; revise the canonical layout.`,
                [c.id],
                f.id
              )
            );
          const p = columnFootprint(c);
          if (!containsPolygon(f.boundary, { points: [position] }) || !containsPolygon(plot, p))
            errors.push(
              infeasible(
                `Column at (${position.x}, ${position.y}) exceeds a registered floor/site envelope.`,
                [c.id],
                f.id
              )
            );
          if (f.rooms.some(
            (r) => [
              "balcony",
              "utility",
              "ots",
              "service_shaft",
              "lift",
              "staircase"
            ].includes(r.type) && this.restrictedOverlap(p, r, f, structuralEnvelope) >= 1e-3
          ))
            errors.push(
              infeasible(
                `Column at (${position.x}, ${position.y}) intersects a cantilever balcony or clear vertical opening.`,
                [c.id],
                f.id
              )
            );
          if (cuts.polygons.some(
            (o) => hardeningOverlapArea(p, o.polygon) >= 1e-3
          ))
            errors.push(
              infeasible(
                `Column at (${position.x}, ${position.y}) intersects an opening or conservative door swing envelope.`,
                [c.id],
                f.id
              )
            );
          columns.push(c);
        }
      for (let i = 0; i < columns.length; i++)
        for (let j = i + 1; j < columns.length; j++)
          if (columnEdgeDistance(columns[i], columns[j]) < 1800)
            errors.push(
              infeasible(
                "Column clear edge distance is below 1800mm.",
                [columns[i].id, columns[j].id],
                f.id
              )
            );
      return { ...f, columns };
    });
    const candidate = { ...building, floors };
    return solverResult(building, candidate, [
      ...errors,
      ...this.validate(candidate, structuralEnvelope).errors
    ]);
  }
  restrictedOverlap(p, room, floor, envelope) {
    const balcony = ["balcony", "utility"].includes(room.type);
    if (balcony && (!envelope || hardeningOverlapArea(room.boundary, envelope) >= 1e-3))
      return hardeningOverlapArea(p, room.boundary);
    return uncoveredResidentialOverlap(
      p,
      room.boundary,
      floor.walls.map(wallToPolygon)
    );
  }
  validate(building, structuralEnvelope) {
    const errors = [], base = building.floors[0];
    if (!base || !base.columns.length)
      errors.push(infeasible("No base columns are registered."));
    const signature = (f) => f.columns.map((c) => `${c.position.x},${c.position.y},${c.width},${c.depth}`).sort().join("|");
    for (const f of building.floors) {
      if (base && signature(f) !== signature(base))
        errors.push(
          infeasible(
            "Vertical column coordinates/sections differ across floors.",
            f.columns.map((c) => c.id),
            f.id
          )
        );
      for (const key2 of ["x", "y"]) {
        const coords = [...new Set(f.columns.map((c) => c.position[key2]))].sort(
          (a, b) => a - b
        );
        if (coords.length < 2)
          errors.push(
            infeasible("Two-dimensional column grid is missing.", [f.id], f.id)
          );
        for (let i = 1; i < coords.length; i++)
          if (coords[i] - coords[i - 1] < 3e3 || coords[i] - coords[i - 1] > 6e3)
            errors.push(
              infeasible(
                "Column bay span is outside 3000\u20136000mm.",
                [f.id],
                f.id
              )
            );
      }
      for (const c of f.columns) {
        if (c.floorId !== f.id || ![c.position.x, c.position.y, c.width, c.depth].every(
          Number.isFinite
        ) || c.width <= 0 || c.depth <= 0)
          errors.push(
            infeasible(
              "Invalid or misregistered column geometry.",
              [c.id],
              f.id
            )
          );
        const footprint = columnFootprint(c);
        if (f.floorUse === "RESIDENTIAL" && !fitsResidentialBearingWalls(c, f.walls))
          errors.push(
            infeasible(
              "Column does not fit flush within a registered bearing wall.",
              [c.id],
              f.id
            )
          );
        if (f.rooms.some(
          (r) => [
            "balcony",
            "utility",
            "ots",
            "service_shaft",
            "lift",
            "staircase"
          ].includes(r.type) && this.restrictedOverlap(footprint, r, f, structuralEnvelope) >= 1e-3
        ))
          errors.push(
            infeasible(
              "Column occupies a balcony or vertical opening.",
              [c.id],
              f.id
            )
          );
      }
      for (let i = 0; i < f.columns.length; i++)
        for (let j = i + 1; j < f.columns.length; j++)
          if (columnEdgeDistance(f.columns[i], f.columns[j]) < 1800)
            errors.push(
              infeasible(
                "Column cluster violates clear separation.",
                [f.columns[i].id, f.columns[j].id],
                f.id
              )
            );
    }
    return solverResult(building, building, errors);
  }
};

// packages/planning-engine/src/structural/beam-network-generator.ts
var BeamNetworkGenerator = class {
  generate(building) {
    const errors = [], floors = building.floors.map((f) => {
      const beams = [];
      const add = (a, b, type, startColumnId, endColumnId) => {
        if (a.x === b.x && a.y === b.y) return;
        const segments = uncoveredResidentialSegments(
          { start: a, end: b },
          beams.map((v) => ({ start: v.startPoint, end: v.endPoint }))
        );
        for (const segment of segments) {
          const beam = {
            id: `hardening:${f.id}:beam:${beams.length}`,
            floorId: f.id,
            startPoint: segment.start,
            endPoint: segment.end,
            widthMm: 230,
            depthMm: 450,
            type,
            startColumnId,
            endColumnId
          };
          const p = beamFootprint(beam);
          const openings = [
            ...f.voidBoundaries ?? [],
            ...f.rooms.filter(
              (r) => ["staircase", "lift", "service_shaft", "ots"].includes(
                r.type
              )
            ).map((r) => r.boundary),
            ...(f.canonicalStaircases ?? []).map((s) => s.polygon)
          ];
          if (openings.some(
            (h) => !isConvex(h) || (f.voidBoundaries?.includes(h) ? hardeningOverlapArea(p, h) : uncoveredResidentialOverlap(
              p,
              h,
              f.walls.map(wallToPolygon)
            )) >= 1e-3
          ))
            errors.push(
              infeasible(
                "Beam would obstruct a vertical floor opening; no relocation is inferred.",
                [beam.id],
                f.id
              )
            );
          beams.push(beam);
        }
      };
      for (const coordinate of ["x", "y"]) {
        const varying = coordinate === "x" ? "y" : "x";
        for (const line of new Set(
          f.columns.map((c) => c.position[coordinate])
        )) {
          const nodes = f.columns.filter((c) => c.position[coordinate] === line).sort((a, b) => a.position[varying] - b.position[varying]);
          for (let i = 1; i < nodes.length; i++) {
            const a = nodes[i - 1], b = nodes[i];
            if (Math.hypot(
              a.position.x - b.position.x,
              a.position.y - b.position.y
            ) > 6e3)
              errors.push(
                infeasible(
                  "Primary beam bay exceeds 6000mm.",
                  [a.id, b.id],
                  f.id
                )
              );
            add(a.position, b.position, "PRIMARY", a.id, b.id);
          }
        }
      }
      for (const w of f.walls.filter(
        (w2) => w2.wallUse === "EXTERNAL" || w2.type === "external" || w2.roomIds.some(
          (id) => f.rooms.some(
            (r) => r.id === id && r.tags.some(
              (t) => ["SECURITY_CABIN", "ELECTRICAL_METER_ROOM"].includes(t)
            )
          )
        )
      ))
        add(w.startPoint, w.endPoint, "SECONDARY");
      for (const r of f.rooms.filter(
        (r2) => r2.type === "balcony" || r2.type === "utility"
      ))
        r.boundary.points.forEach(
          (a, i) => add(
            a,
            r.boundary.points[(i + 1) % r.boundary.points.length],
            "CANTILEVER"
          )
        );
      if (f.columns.some(
        (c) => !beams.some(
          (b) => b.startColumnId === c.id || b.endColumnId === c.id
        )
      ))
        errors.push(
          infeasible(
            "Column node has no primary beam connection.",
            f.columns.map((c) => c.id),
            f.id
          )
        );
      const connected = /* @__PURE__ */ new Set();
      const seed2 = beams.findIndex((b) => b.type === "PRIMARY");
      if (seed2 >= 0) connected.add(seed2);
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 0; i < beams.length; i++)
          if (!connected.has(i) && [...connected].some(
            (j) => hardeningOverlapArea(
              beamFootprint(beams[i]),
              beamFootprint(beams[j])
            ) >= 1e-3 || containsPolygon(beamFootprint(beams[j]), {
              points: [beams[i].startPoint]
            }) || containsPolygon(beamFootprint(beams[j]), {
              points: [beams[i].endPoint]
            })
          )) {
            connected.add(i);
            changed = true;
          }
      }
      if (!f.columns.length || connected.size !== beams.length)
        errors.push(
          infeasible(
            "Beam network is disconnected from primary column supports.",
            [f.id],
            f.id
          )
        );
      return { ...f, beams };
    });
    return solverResult(
      building,
      { ...building, floors, beams: floors.flatMap((f) => f.beams) },
      errors
    );
  }
};

// packages/planning-engine/src/core/vertical-core-solver.ts
var key = (p) => p.points.map((q) => `${q.x}:${q.y}`).sort().join("|");
var VerticalCoreContinuitySolver = class {
  solve(building) {
    const errors = [], base = building.floors[0];
    if (!base)
      return solverResult(building, building, [
        infeasible("No registered floors for a vertical core.")
      ]);
    const ordered = [...building.floors].sort((a, b) => a.level - b.level);
    if (ordered.some((f, i) => i > 0 && f.level !== ordered[i - 1].level + 1))
      errors.push(infeasible("Physical floor levels are not contiguous."));
    const reference = base.canonicalStaircases ?? [], referenceLifts = base.rooms.filter((r) => r.type === "lift");
    if (!reference.length || !referenceLifts.length)
      errors.push(
        infeasible(
          "A canonical staircase and lift are required on the base level.",
          [base.id],
          base.id
        )
      );
    const common = (r) => !r.unitId && ["corridor", "foyer", "parking"].includes(r.type);
    for (const f of ordered) {
      const stairs = f.canonicalStaircases ?? [], lifts = f.rooms.filter((r) => r.type === "lift");
      if (stairs.some(
        (s) => s.floorId !== f.id || ["polygon", "flight1", "flight2", "midLanding"].some(
          (field) => !isValidPolygon(s[field])
        )
      ) || lifts.some((r) => r.floorId !== f.id || !isValidPolygon(r.boundary)))
        errors.push(
          infeasible("Invalid or misregistered core footprint.", [f.id], f.id)
        );
      if (stairs.length !== reference.length || stairs.some(
        (s) => !reference.some(
          (t) => ["polygon", "flight1", "flight2", "midLanding"].every(
            (field) => key(s[field]) === key(t[field])
          )
        )
      ))
        errors.push(
          infeasible(
            "Canonical stair flights/landing/enclosure footprints differ between floors.",
            [f.id],
            f.id
          )
        );
      if (lifts.length !== referenceLifts.length || lifts.some(
        (r) => !referenceLifts.some((t) => key(r.boundary) === key(t.boundary))
      ))
        errors.push(
          infeasible(
            "Lift well footprints differ between floors.",
            [f.id],
            f.id
          )
        );
      for (const stair of stairs) {
        const edge = stair.accessEdge, mid = {
          x: (edge.startPoint.x + edge.endPoint.x) / 2,
          y: (edge.startPoint.y + edge.endPoint.y) / 2
        };
        const lobby = f.rooms.find(
          (r) => common(r) && (f.level === ordered[0].level || r.type !== "parking") && containsPolygon(r.boundary, {
            points: [edge.startPoint, mid, edge.endPoint]
          })
        );
        if (edge.type !== "OPEN_PASSAGE" || !lobby)
          errors.push(
            infeasible(
              "Stair access edge is not registered to common OPEN_PASSAGE circulation.",
              [stair.id],
              f.id
            )
          );
        const stairRooms = f.rooms.filter(
          (r) => r.type === "staircase" && key(r.boundary) === key(stair.polygon)
        );
        if (f.doors.some(
          (d) => d.connectsRooms.some(
            (id) => stairRooms.some((r) => r.id === id)
          ) && d.connectsRooms.some(
            (id) => f.rooms.some((r) => r.id === id && !!r.unitId)
          )
        ))
          errors.push(
            infeasible(
              "Stair enclosure opens directly into a private apartment.",
              [stair.id],
              f.id
            )
          );
        if (f.level === ordered[0].level) {
          const discharge = f.doors.find(
            (d) => d.width >= 1200 && d.connectsRooms.some((id) => lobby?.id === id) && d.connectsRooms.some((id) => {
              const r = f.rooms.find((r2) => r2.id === id);
              return r?.type === "parking" && !r.unitId;
            })
          );
          const openParking = lobby?.type === "parking" && Math.hypot(
            edge.endPoint.x - edge.startPoint.x,
            edge.endPoint.y - edge.startPoint.y
          ) >= 1200;
          if (!discharge && !openParking)
            errors.push(
              infeasible(
                "Ground stair discharge needs an explicit >=1200mm opening to registered open stilt/driveway circulation.",
                [stair.id],
                f.id
              )
            );
          if (!(building.site.siteZones ?? []).some(
            (z) => z.regulatoryUse === "DRIVEWAY" && containsPolygon(z.boundary, { points: [mid] }) && zoneHasBoundaryAccess(building.site, z.id)
          ))
            errors.push(
              infeasible(
                "Ground discharge is not connected geometrically to a designated driveway.",
                [stair.id],
                f.id
              )
            );
        }
      }
      for (const lift of lifts) {
        const clear = measureClearRoom(f, lift);
        if (!clear || Math.min(clear.width, clear.height) < 1500)
          errors.push(
            infeasible(
              "Lift well clear cutout is below 1500x1500mm or unsupported.",
              [lift.id],
              f.id
            )
          );
        if (!f.doors.some(
          (d) => d.type === "sliding" && d.width === 900 && d.connectsRooms.includes(lift.id) && d.connectsRooms.some(
            (id) => f.rooms.some((r) => r.id === id && common(r))
          ) && f.walls.some(
            (w) => w.id === d.wallId && w.roomIds.includes(lift.id)
          )
        ))
          errors.push(
            infeasible(
              "Lift needs a hosted 900mm sliding opening to common circulation.",
              [lift.id],
              f.id
            )
          );
      }
      if (!isValidPolygon(f.boundary) || !isConvex(f.boundary) || [...stairs.map((s) => s.polygon), ...lifts.map((r) => r.boundary)].some(
        (p) => !containsPolygon(f.boundary, p)
      ))
        errors.push(
          infeasible(
            "Core registration requires finite convex floor envelopes containing every registered core footprint.",
            [f.id],
            f.id
          )
        );
    }
    return solverResult(building, building, errors);
  }
};

// packages/planning-engine/src/layout/stilt-layout-solver.ts
var StiltLevelEnclosureGuard = class {
  solve(building) {
    const errors = [];
    for (const f of building.floors.filter(
      (f2) => f2.floorUse === "STILT_PARKING"
    )) {
      if (f.apartmentUnits?.length)
        errors.push(
          infeasible(
            "Stilt floor contains private flats.",
            f.apartmentUnits.map((u) => u.id),
            f.id
          )
        );
      const ledger = measureApartmentAreaLedger(f);
      for (const r of f.rooms) {
        const security = r.type === "custom" && r.tags.includes("SECURITY_CABIN"), meter = r.type === "custom" && r.tags.includes("ELECTRICAL_METER_ROOM");
        if (!["parking", "lift", "staircase", "corridor", "foyer"].includes(
          r.type
        ) && !security && !meter)
          errors.push(
            infeasible(
              "Unpermitted or unclassified stilt enclosure.",
              [r.id],
              f.id
            )
          );
        if (security && (!ledger.supported || (ledger.roomUsable[r.id] ?? 0) > 6e6))
          errors.push(
            infeasible(
              "Security cabin exceeds 6m2 usable area or cannot be measured.",
              [r.id],
              f.id
            )
          );
      }
    }
    if (building.floors.some((f) => f.floorUse === "STILT_PARKING")) {
      const p = measureMarkedParking(building);
      if (!p.cars || p.invalid.length)
        errors.push(
          infeasible(
            "Stilt requires real non-overlapping 2500x5000mm car bays without column obstructions.",
            p.invalid
          )
        );
      if (p.drivewayWidthMm === null || p.drivewayWidthMm < 3e3 || p.driveConflicts)
        errors.push(
          infeasible(
            "A designated unobstructed driveway at least 3000mm wide is required.",
            p.driveIds
          )
        );
    }
    return solverResult(building, building, errors);
  }
};

// packages/planning-engine/src/pipeline/architectural-connections.ts
var stairRoom = (r) => ["STAIR_ENCLOSURE", "PROTECTED_STAIR_ENCLOSURE", "STAIR_MUMTY"].includes(
  r.architecturalRole ?? ""
);
var coreKey = (r) => r.boundary.points.map((p) => `${p.x},${p.y}`).sort().join(";");
var accessHosts = (f, r) => f.walls.filter(
  (w) => w.roomIds.includes(r.id) && Math.hypot(
    w.endPoint.x - w.startPoint.x,
    w.endPoint.y - w.startPoint.y
  ) >= 1200 && w.roomIds.some(
    (id) => f.rooms.some(
      (q) => q.id === id && [
        "OPEN_CIRCULATION",
        "LIFT_LOBBY",
        "OPEN_TERRACE",
        "VEHICLE_AISLE",
        "ROOF_EQUIPMENT_ZONE",
        "PARKING_AREA"
      ].includes(q.architecturalRole ?? "")
    )
  )
);
var hostFits = (w, p) => {
  const hit = projectOnSegment(p, w.startPoint, w.endPoint);
  return !!hit && hit.distance < 1e-3 && hit.along >= 600 - 1e-3 && hit.along <= hit.length - 600 + 1e-3;
};
function coordinateArchitecturalStairs(building) {
  const ordered = [...building.floors].sort((a, b) => a.level - b.level);
  const elevations = /* @__PURE__ */ new Map();
  let z = 0;
  for (const f of ordered) {
    const at = f.elevationMm ?? z;
    elevations.set(f.id, at);
    z = at + f.floorHeight;
  }
  const templates = /* @__PURE__ */ new Map();
  const groups = /* @__PURE__ */ new Map();
  for (const f of ordered)
    for (const r of f.rooms.filter(stairRoom)) {
      const key2 = coreKey(r);
      groups.set(key2, [
        ...groups.get(key2) ?? [],
        { room: r, hosts: accessHosts(f, r) }
      ]);
    }
  for (const [key2, group] of groups) {
    const room = group[0].room, preferredHorizontal = room.width <= room.height;
    const seeds = group.flatMap((g) => g.hosts).sort(
      (a, b) => Number(
        Math.abs(b.startPoint.y - b.endPoint.y) < 1e-3 === preferredHorizontal
      ) - Number(
        Math.abs(a.startPoint.y - a.endPoint.y) < 1e-3 === preferredHorizontal
      )
    );
    const candidates = seeds.flatMap((w) => {
      const hit = projectOnSegment(w.startPoint, w.startPoint, w.endPoint);
      return [
        hit.pointAt(hit.length / 2),
        hit.pointAt(600),
        hit.pointAt(hit.length - 600)
      ];
    });
    const point = candidates.find(
      (p) => group.every((g) => g.hosts.some((w) => hostFits(w, p)))
    );
    if (!point) throw new Error(`STAIR_ACCESS_NOT_ALIGNED: ${room.id}`);
    templates.set(key2, point);
  }
  const floors = ordered.map((f, i) => {
    const lower = ordered[i - 1], upper = ordered[i + 1];
    const rise = upper ? elevations.get(upper.id) - elevations.get(f.id) : lower ? elevations.get(f.id) - elevations.get(lower.id) : f.floorHeight;
    let doors = [...f.doors];
    const canonicalStaircases = [];
    const stairs = f.rooms.filter(stairRoom).map((r, index) => {
      const key2 = coreKey(r), position = templates.get(key2);
      const host = accessHosts(f, r).find((w) => hostFits(w, position));
      if (!host) throw new Error(`STAIR_ACCESS_HOST_MISSING: ${r.id}`);
      const existing = doors.find((d) => d.connectsRooms.includes(r.id));
      let door = {
        ...existing ?? {},
        id: existing?.id ?? `${r.id}:access`,
        floorId: f.id,
        wallId: host.id,
        position,
        openingGeometryVersion: 1,
        positionReference: "CENTER",
        width: existing?.width ?? 1200,
        height: existing?.height ?? 2100,
        type: existing?.type ?? DoorType.OpenPassage,
        swingDirection: existing?.swingDirection ?? SwingDirection.Inward,
        connectsRooms: [
          r.id,
          host.roomIds.find((id2) => id2 !== r.id)
        ]
      };
      if (![DoorType.OpenPassage, DoorType.Sliding, DoorType.Folding].includes(
        door.type
      )) {
        const destination = f.rooms.find(
          (q) => q.id === door.connectsRooms[1]
        );
        const chosen = [SwingDirection.Inward, SwingDirection.Outward].map((swingDirection) => ({ ...door, swingDirection })).find(
          (candidate) => containsPolygon(
            destination.boundary,
            computeDoorSwingPolygon(candidate, host)
          )
        );
        if (!chosen)
          throw new Error(`STAIR_DOOR_CLEARANCE_UNAVAILABLE: ${door.id}`);
        door = chosen;
      }
      doors = existing ? doors.map((d) => d.id === existing.id ? door : d) : [...doors, door];
      const old = f.canonicalStaircases?.[index];
      const id = old?.id ?? `${r.id}:stair`;
      const canonical = proposeArchitecturalStair(
        r,
        host,
        rise,
        id,
        1200,
        175,
        position
      );
      canonicalStaircases.push(canonical);
      const horizontal = Math.abs(host.startPoint.y - host.endPoint.y) < 1e-3;
      return {
        id,
        floorId: f.id,
        type: StairType.UShaped,
        boundary: r.boundary,
        x: r.x,
        y: r.y,
        width: r.width,
        length: r.height,
        direction: horizontal ? Direction.North : Direction.East,
        riserCount: canonical.riserCount,
        riserHeight: rise / canonical.riserCount,
        treadDepth: canonical.treadWidthMm,
        landingWidth: canonical.clearWidthMm,
        connectsFloors: upper ? [f.level, upper.level] : lower ? [lower.level, f.level] : [f.level, f.level + 1],
        verticalCoreId: `architectural-stair:${key2}`
      };
    });
    return {
      ...f,
      elevationMm: elevations.get(f.id),
      // Both generation producers and their bounded repair routines emit centres.
      // This annotation applies only to fresh generation, never saved-project loading.
      doors: doors.map((o) => {
        const wall = f.walls.find((w) => w.id === o.wallId);
        if (!wall) return o;
        return { ...o, openingGeometryVersion: 1, positionReference: "CENTER" };
      }),
      windows: f.windows.map((o) => {
        const wall = f.walls.find((w) => w.id === o.wallId);
        if (!wall) return o;
        return { ...o, openingGeometryVersion: 1, positionReference: "CENTER" };
      }),
      stairs,
      canonicalStaircases
    };
  });
  return {
    ...building,
    floors,
    canonicalStaircases: floors.flatMap((f) => f.canonicalStaircases)
  };
}

// packages/planning-engine/src/repair/apartment-error-repair.ts
var SNAP_INC = 10;
var snap10 = (v) => Math.round(v / SNAP_INC) * SNAP_INC;
function getRoomRect(room) {
  if (room.boundary && room.boundary.points.length >= 4) {
    const xs = room.boundary.points.map((p) => p.x);
    const ys = room.boundary.points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  return { x: room.x, y: room.y, w: room.width, h: room.height };
}
function rectToPolygon2(r) {
  return {
    points: [
      { x: Math.round(r.x), y: Math.round(r.y) },
      { x: Math.round(r.x + r.w), y: Math.round(r.y) },
      { x: Math.round(r.x + r.w), y: Math.round(r.y + r.h) },
      { x: Math.round(r.x), y: Math.round(r.y + r.h) }
    ]
  };
}
function findSharedWallSegment(roomA, roomB) {
  const a = getRoomRect(roomA);
  const b = getRoomRect(roomB);
  const touchesHoriz = Math.abs(a.y + a.h - b.y) <= 2 || Math.abs(b.y + b.h - a.y) <= 2;
  const loX = Math.max(a.x, b.x);
  const hiX = Math.min(a.x + a.w, b.x + b.w);
  if (touchesHoriz && hiX - loX >= 100) {
    const coord = Math.abs(a.y + a.h - b.y) <= 2 ? a.y + a.h : b.y + b.h;
    return { axis: "x", coord, lo: loX, hi: hiX, len: hiX - loX };
  }
  const touchesVert = Math.abs(a.x + a.w - b.x) <= 2 || Math.abs(b.x + b.w - a.x) <= 2;
  const loY = Math.max(a.y, b.y);
  const hiY = Math.min(a.y + a.h, b.y + b.h);
  if (touchesVert && hiY - loY >= 100) {
    const coord = Math.abs(a.x + a.w - b.x) <= 2 ? a.x + a.w : b.x + b.w;
    return { axis: "y", coord, lo: loY, hi: hiY, len: hiY - loY };
  }
  return null;
}
function repairApartmentPlan(building, manifest, options = {}) {
  const maxPasses = options.maxPasses ?? 3;
  const compactPlotAdaptation = options.compactPlotAdaptation ?? true;
  const initialClosure = validateApartmentClosure(building, manifest);
  const appliedRepairs = [];
  const advisories = [];
  let currentBuilding = building;
  let passCount = 0;
  for (let pass = 1; pass <= maxPasses; pass++) {
    passCount = pass;
    const closure = validateApartmentClosure(currentBuilding, manifest);
    if (pass > 1 && closure.hardErrors === 0 && !hasCriticalSoftIssues(closure.issues)) {
      break;
    }
    let modified = false;
    const repairedFloors = [];
    for (const floor of currentBuilding.floors) {
      if (!floor.apartmentUnits || floor.apartmentUnits.length === 0) {
        repairedFloors.push(floor);
        continue;
      }
      let currentRooms = [...floor.rooms];
      let currentDoors = [...floor.doors];
      let currentWindows = [...floor.windows];
      const manifestRes = repairManifestMismatch({
        rooms: currentRooms,
        doors: currentDoors,
        units: floor.apartmentUnits,
        manifest,
        floorId: floor.id
      });
      if (manifestRes.repaired) {
        currentRooms = manifestRes.rooms;
        currentDoors = manifestRes.doors;
        appliedRepairs.push(...manifestRes.repairs);
        modified = true;
      }
      const dimRes = repairMinDimensions({
        rooms: currentRooms,
        units: floor.apartmentUnits,
        compactPlotAdaptation
      });
      if (dimRes.repaired) {
        currentRooms = dimRes.rooms;
        appliedRepairs.push(...dimRes.repairs);
        advisories.push(...dimRes.advisories);
        modified = true;
      }
      let regeneratedWalls = generateApartmentWalls(currentRooms, floor.id, floor.boundary, void 0, floor.walls.find((w) => w.boundaryRole === "PARAPET")?.heightMm);
      const privacyRes = repairPrivacyAndCirculation({
        rooms: currentRooms,
        doors: currentDoors,
        walls: regeneratedWalls,
        units: floor.apartmentUnits,
        floorId: floor.id
      });
      if (privacyRes.repaired) {
        currentDoors = privacyRes.doors;
        appliedRepairs.push(...privacyRes.repairs);
        modified = true;
      }
      const doorRes = repairDoorHostsAndClearance({
        rooms: currentRooms,
        doors: currentDoors,
        walls: regeneratedWalls,
        floorId: floor.id
      });
      if (doorRes.repaired) {
        currentDoors = doorRes.doors;
        appliedRepairs.push(...doorRes.repairs);
        modified = true;
      }
      regeneratedWalls = generateApartmentWalls(currentRooms, floor.id, floor.boundary, void 0, floor.walls.find((w) => w.boundaryRole === "PARAPET")?.heightMm).map((w) => ({
        ...w,
        hasOpening: currentDoors.some((d) => d.wallId === w.id) || currentWindows.some((win) => win.wallId === w.id)
      }));
      const daylightRes = repairDaylightAndVentilation({
        rooms: currentRooms,
        windows: currentWindows,
        doors: currentDoors,
        walls: regeneratedWalls,
        floorId: floor.id
      });
      if (daylightRes.repaired) {
        currentWindows = daylightRes.windows;
        appliedRepairs.push(...daylightRes.repairs);
        modified = true;
      }
      regeneratedWalls = regeneratedWalls.map((w) => ({
        ...w,
        hasOpening: currentDoors.some((d) => d.wallId === w.id) || currentWindows.some((win) => win.wallId === w.id)
      }));
      repairedFloors.push({
        ...floor,
        rooms: currentRooms,
        walls: regeneratedWalls,
        doors: currentDoors,
        windows: currentWindows
      });
    }
    currentBuilding = {
      ...currentBuilding,
      floors: repairedFloors
    };
    if (!modified) {
      break;
    }
  }
  const finalClosure = validateApartmentClosure(currentBuilding, manifest);
  const ledger = currentBuilding.floors[0] ? measureApartmentAreaLedger(currentBuilding.floors[0]) : null;
  const deltaMm2 = ledger ? Math.abs(ledger.delta) : 0;
  return {
    building: currentBuilding,
    repairReport: {
      repaired: appliedRepairs.length > 0,
      passesCompleted: passCount,
      initialIssues: initialClosure.issues,
      finalIssues: finalClosure.issues,
      initialHardErrors: initialClosure.hardErrors,
      finalHardErrors: finalClosure.hardErrors,
      repairsApplied: appliedRepairs,
      deltaMm2,
      advisories: [...new Set(advisories)]
    }
  };
}
function hasCriticalSoftIssues(issues) {
  return issues.some(
    (i) => i.code === "BEDROOM_DOOR_WIDTH_SUBSTANDARD" || i.code === "SERVICE_DOOR_WIDTH_SUBSTANDARD" || i.code === "PRIMARY_ENTRANCE_DOOR_WIDTH_SUBSTANDARD" || i.code === "DAYLIGHT_OPENING_UNVERIFIED"
  );
}
function repairManifestMismatch(params) {
  const { units, manifest, floorId } = params;
  if (!units || units.length === 0) {
    return { rooms: params.rooms, doors: params.doors, repaired: false, repairs: [] };
  }
  let workingRooms = params.rooms.map((room) => {
    if (room.boundary.points.length !== 4) return room;
    const xs = [...new Set(room.boundary.points.map((p) => p.x))];
    const ys = [...new Set(room.boundary.points.map((p) => p.y))];
    if (xs.length !== 2 || ys.length !== 2) return room;
    const x = Math.min(...xs), y = Math.min(...ys), width = Math.max(...xs) - x, height = Math.max(...ys) - y;
    return { ...room, x, y, width, height, area: width * height };
  });
  const workingDoors = [...params.doors];
  const repairs = [];
  let repaired = false;
  const manifestUnits = Array.isArray(manifest?.units) ? manifest.units : Array.isArray(manifest?.units?.units) ? manifest.units.units : [];
  for (const u of units) {
    const unitSpec = manifestUnits.find(
      (item) => item.unitIndex !== void 0 && item.unitIndex === u.unitIndex || item.id && (u.id === item.id || u.id.endsWith(String(item.id)) || String(item.id).endsWith(u.id)) || item.unitIndex !== void 0 && u.id.endsWith(String(item.unitIndex))
    );
    let unitRooms = workingRooms.filter((r) => r.unitId === u.id);
    const bedRoomsList = unitRooms.filter((r) => r.type === RoomType.Bedroom || r.tags.includes("role:bedroom"));
    const inferredBhk = bedRoomsList.length > 0 ? `${bedRoomsList.length}BHK` : "3BHK";
    const bhkType = unitSpec?.bhkType ?? unitSpec?.type ?? u.unitType ?? inferredBhk;
    const match = String(bhkType).match(/^([1234])BHK$/i);
    const defaultBeds = match ? parseInt(match[1], 10) : 3;
    const expectedBeds = typeof unitSpec?.bedrooms === "number" ? unitSpec.bedrooms : defaultBeds;
    const expectedBaths = typeof unitSpec?.bathrooms === "number" ? unitSpec.bathrooms : unitSpec?.attachedBathCount !== void 0 ? unitSpec.attachedBathCount + 1 : expectedBeds;
    const livingRooms = unitRooms.filter((r) => r.type === RoomType.Living || r.tags.includes("role:living"));
    const mislabeledEntry = unitRooms.find(
      (r) => (r.type === RoomType.Bedroom || r.type === RoomType.Bathroom) && workingDoors.some(
        (d) => d.connectsRooms[0] === r.id && params.rooms.some((cr) => cr.id === d.connectsRooms[1] && (cr.spaceUse === "COMMON" || cr.spaceUse === "CORE")) || d.connectsRooms[1] === r.id && params.rooms.some((cr) => cr.id === d.connectsRooms[0] && (cr.spaceUse === "COMMON" || cr.spaceUse === "CORE"))
      )
    );
    if (mislabeledEntry) {
      const hasLiving = livingRooms.length > 0 && livingRooms.some((r) => r.id !== mislabeledEntry.id);
      const reclassifiedType = hasLiving ? RoomType.Dining : RoomType.Living;
      const reclassifiedName = hasLiving ? `${u.id} Dining & Family Hall` : `${u.id} Living & Dining`;
      const reclassifiedTag = hasLiving ? "role:dining" : "role:living";
      const reclassified = {
        ...mislabeledEntry,
        type: reclassifiedType,
        planningZone: "PUBLIC",
        name: reclassifiedName,
        tags: mislabeledEntry.tags.filter((t) => !t.startsWith("role:")).concat([reclassifiedTag, `reclassified:${reclassifiedType}`])
      };
      workingRooms = workingRooms.map((r) => r.id === mislabeledEntry.id ? reclassified : r);
      unitRooms = unitRooms.map((r) => r.id === mislabeledEntry.id ? reclassified : r);
      repaired = true;
      repairs.push({
        category: "PRIVACY_CIRCULATION",
        description: `Re-classified mislabeled entry room ${mislabeledEntry.id} to ${reclassifiedName} for ${u.id}`,
        targetEntities: [mislabeledEntry.id]
      });
    } else if (livingRooms.length === 0) {
      {
        const candidate = findOversizedRoom(unitRooms, RoomType.Living);
        if (candidate) {
          const synth = splitRoomForSynthesis(candidate, RoomType.Living, `${u.id} Living & Dining`, floorId, u.id, void 0, unitRooms);
          workingRooms = workingRooms.map((r) => r.id === candidate.id ? synth.parentRoom : r);
          workingRooms.push(synth.synthesizedRoom);
          workingDoors.push(synth.connectingDoor);
          unitRooms = unitRooms.map((r) => r.id === candidate.id ? synth.parentRoom : r);
          unitRooms.push(synth.synthesizedRoom);
          repaired = true;
          repairs.push({
            category: "MANIFEST_SYNTHESIS",
            description: `Synthesized missing Living room for ${u.id} (${bhkType}) by subdividing oversized zone ${candidate.id}`,
            targetEntities: [candidate.id, synth.synthesizedRoom.id]
          });
        }
      }
    }
    const kitchenRooms = unitRooms.filter((r) => r.type === RoomType.Kitchen || r.tags.includes("role:kitchen"));
    if (kitchenRooms.length === 0) {
      const candidate = findOversizedRoom(unitRooms, RoomType.Kitchen);
      if (candidate) {
        const synth = splitRoomForSynthesis(candidate, RoomType.Kitchen, `${u.id} Kitchen`, floorId, u.id, void 0, unitRooms);
        workingRooms = workingRooms.map((r) => r.id === candidate.id ? synth.parentRoom : r);
        workingRooms.push(synth.synthesizedRoom);
        workingDoors.push(synth.connectingDoor);
        unitRooms = unitRooms.map((r) => r.id === candidate.id ? synth.parentRoom : r);
        unitRooms.push(synth.synthesizedRoom);
        repaired = true;
        repairs.push({
          category: "MANIFEST_SYNTHESIS",
          description: `Synthesized missing Kitchen for ${u.id} (${bhkType}) by subdividing oversized zone ${candidate.id}`,
          targetEntities: [candidate.id, synth.synthesizedRoom.id]
        });
      }
    }
    let bedCount = unitRooms.filter((r) => r.type === RoomType.Bedroom || r.tags.includes("role:bedroom")).length;
    while (bedCount < expectedBeds) {
      const candidate = findOversizedRoom(unitRooms, RoomType.Bedroom);
      if (!candidate) break;
      bedCount++;
      const synth = splitRoomForSynthesis(candidate, RoomType.Bedroom, `${u.id} Bedroom 0${bedCount}`, floorId, u.id, void 0, unitRooms);
      workingRooms = workingRooms.map((r) => r.id === candidate.id ? synth.parentRoom : r);
      workingRooms.push(synth.synthesizedRoom);
      workingDoors.push(synth.connectingDoor);
      unitRooms = unitRooms.map((r) => r.id === candidate.id ? synth.parentRoom : r);
      unitRooms.push(synth.synthesizedRoom);
      repaired = true;
      repairs.push({
        category: "MANIFEST_SYNTHESIS",
        description: `Synthesized Bedroom 0${bedCount} for ${u.id} (${bhkType}) from oversized room ${candidate.id}`,
        targetEntities: [candidate.id, synth.synthesizedRoom.id]
      });
    }
    let bathCount = unitRooms.filter((r) => r.type === RoomType.Bathroom || r.tags.includes("role:bathroom")).length;
    while (bathCount < expectedBaths) {
      const gap = findUnoccupiedUnitRectangle(u.boundary, workingRooms);
      if (gap && Math.min(gap.w, gap.h) >= 1200 && gap.w * gap.h >= 22e5) {
        const created = createRoom({
          floorId,
          type: RoomType.Bathroom,
          name: `${u.id} Common Toilet ${bathCount + 1}`,
          x: gap.x,
          y: gap.y,
          width: gap.w,
          height: gap.h,
          tags: [`flat:${u.id}`, "role:bathroom", "repaired:gap"]
        });
        const restored = { ...created, unitId: u.id, spaceUse: "UNIT", bathroomAccessClass: "COMMON" };
        workingRooms.push(restored);
        unitRooms.push(restored);
        bathCount++;
        repaired = true;
        repairs.push({ category: "MANIFEST_SYNTHESIS", description: `Restored missing bathroom in measured vacant unit polygon`, targetEntities: [restored.id] });
        continue;
      }
      const beds = unitRooms.filter((r) => r.type === RoomType.Bedroom);
      const existingAttachedOwners = new Set(
        unitRooms.filter((r) => r.type === RoomType.Bathroom && r.bathroomAccessClass === "ATTACHED").map((r) => r.bathroomOwnerRoomId)
      );
      const unattachedBeds = beds.filter((b) => !existingAttachedOwners.has(b.id) && b.area >= 125e5);
      unattachedBeds.sort((a, b) => b.y - a.y);
      const unattachedBed = unattachedBeds[0];
      const candidate = unattachedBed ?? findOversizedRoom(unitRooms, RoomType.Bathroom);
      if (!candidate) break;
      bathCount++;
      const isAttached = candidate.type === RoomType.Bedroom;
      const synth = splitRoomForSynthesis(
        candidate,
        RoomType.Bathroom,
        isAttached ? `${u.id} Master Bath 0${bathCount}` : `${u.id} Common Toilet 0${bathCount}`,
        floorId,
        u.id,
        { isAttached },
        unitRooms
      );
      workingRooms = workingRooms.map((r) => r.id === candidate.id ? synth.parentRoom : r);
      workingRooms.push(synth.synthesizedRoom);
      workingDoors.push(synth.connectingDoor);
      unitRooms = unitRooms.map((r) => r.id === candidate.id ? synth.parentRoom : r);
      unitRooms.push(synth.synthesizedRoom);
      repaired = true;
      repairs.push({
        category: "MANIFEST_SYNTHESIS",
        description: `Synthesized Toilet 0${bathCount} (${isAttached ? "Attached" : "Common"}) for ${u.id} from ${candidate.id}`,
        targetEntities: [candidate.id, synth.synthesizedRoom.id]
      });
    }
    if (unitSpec?.hasUtilityBalcony) {
      const hasUtil = unitRooms.some((r) => r.type === RoomType.Utility || r.type === RoomType.Balcony || r.tags.some((t) => t.includes("utility") || t.includes("balcony")));
      if (!hasUtil) {
        const candidate = findOversizedRoom(unitRooms, RoomType.Utility);
        if (candidate) {
          const synth = splitRoomForSynthesis(candidate, RoomType.Utility, `${u.id} Kitchen Utility Yard`, floorId, u.id, void 0, unitRooms);
          workingRooms = workingRooms.map((r) => r.id === candidate.id ? synth.parentRoom : r);
          workingRooms.push(synth.synthesizedRoom);
          workingDoors.push(synth.connectingDoor);
          unitRooms = unitRooms.map((r) => r.id === candidate.id ? synth.parentRoom : r);
          unitRooms.push(synth.synthesizedRoom);
          repaired = true;
          repairs.push({
            category: "MANIFEST_SYNTHESIS",
            description: `Synthesized Utility Balcony for ${u.id} (${bhkType}) from ${candidate.id}`,
            targetEntities: [candidate.id, synth.synthesizedRoom.id]
          });
        }
      }
    }
  }
  return { rooms: workingRooms, doors: workingDoors, repaired, repairs };
}
function findUnoccupiedUnitRectangle(boundary, rooms) {
  const xs = [...new Set([...boundary.points, ...rooms.flatMap((r) => r.boundary.points)].map((p) => p.x))].sort((a, b) => a - b);
  const ys = [...new Set([...boundary.points, ...rooms.flatMap((r) => r.boundary.points)].map((p) => p.y))].sort((a, b) => a - b);
  let best = null;
  for (let y = 0; y < ys.length - 1; y++) for (let x = 0; x < xs.length - 1; x++) {
    let maxX = xs.length - 1;
    for (let bottom = y; bottom < ys.length - 1; bottom++) {
      let right = x;
      for (; right < maxX; right++) {
        const center = { x: (xs[right] + xs[right + 1]) / 2, y: (ys[bottom] + ys[bottom + 1]) / 2 };
        if (!pointInPolygon(center, boundary) || rooms.some((r) => pointInPolygon(center, r.boundary))) break;
      }
      maxX = right;
      if (right === x) break;
      const rect = { x: xs[x], y: ys[y], w: xs[right] - xs[x], h: ys[bottom + 1] - ys[y] };
      if (!best || rect.w * rect.h > best.w * best.h) best = rect;
    }
  }
  return best;
}
function findOversizedRoom(rooms, targetForSynthesis) {
  if (targetForSynthesis === RoomType.Bedroom) {
    const bedCandidates = [...rooms].filter((r) => r.type === RoomType.Bedroom && r.area >= 1e7);
    if (bedCandidates.length > 0) {
      bedCandidates.sort((a, b) => b.area - a.area);
      return bedCandidates[0];
    }
  }
  if (targetForSynthesis === RoomType.Bathroom) {
    const bedCandidates = [...rooms].filter((r) => r.type === RoomType.Bedroom && r.area >= 125e5);
    if (bedCandidates.length > 0) {
      bedCandidates.sort((a, b) => b.area - a.area);
      return bedCandidates[0];
    }
  }
  const minRequiredArea = {
    [RoomType.Living]: 12e6,
    [RoomType.Bedroom]: 95e5,
    [RoomType.Kitchen]: 55e5,
    [RoomType.Bathroom]: 22e5,
    [RoomType.Utility]: 2e6
  };
  const neededArea = minRequiredArea[targetForSynthesis] ?? 25e5;
  const candidates = [...rooms].filter((r) => {
    const rMin = minRequiredArea[r.type] ?? 3e6;
    return r.area >= rMin + neededArea;
  });
  if (candidates.length === 0) {
    const sorted = [...rooms].sort((a, b) => b.area - a.area);
    return sorted[0] && sorted[0].area >= neededArea * 1.3 ? sorted[0] : null;
  }
  candidates.sort((a, b) => b.area - a.area);
  return candidates[0];
}
function splitRoomForSynthesis(parent, synthType, synthName, floorId, unitId, bathOptions, allUnitRooms) {
  const pRect = getRoomRect(parent);
  let parentRect;
  let synthRect;
  const minSynthDims = {
    [RoomType.Bathroom]: { w: 1400, h: 1800 },
    [RoomType.Bedroom]: { w: 2600, h: 3e3 },
    [RoomType.Kitchen]: { w: 2e3, h: 2400 },
    [RoomType.Utility]: { w: 1400, h: 1800 },
    [RoomType.Living]: { w: 3200, h: 3600 }
  };
  const minDim = minSynthDims[synthType] ?? { w: 1500, h: 1800 };
  const isAlongExteriorFacade = pRect.x <= 50;
  const splitAlongY = isAlongExteriorFacade || pRect.h > pRect.w;
  if (!splitAlongY) {
    const synthW = snap10(Math.min(Math.max(1400, minDim.w), pRect.w * 0.4));
    const parentW = pRect.w - synthW;
    parentRect = { x: pRect.x, y: pRect.y, w: parentW, h: pRect.h };
    synthRect = { x: pRect.x + parentW, y: pRect.y, w: synthW, h: pRect.h };
  } else {
    const synthH = snap10(Math.min(Math.max(1600, minDim.h), pRect.h * 0.4));
    const parentH = pRect.h - synthH;
    parentRect = { x: pRect.x, y: pRect.y, w: pRect.w, h: parentH };
    synthRect = { x: pRect.x, y: pRect.y + parentH, w: pRect.w, h: synthH };
  }
  const updatedParent = {
    ...parent,
    x: parentRect.x,
    y: parentRect.y,
    width: parentRect.w,
    height: parentRect.h,
    area: parentRect.w * parentRect.h,
    boundary: rectToPolygon2(parentRect)
  };
  const synthId = `${unitId}__synth_${synthType}_${Math.round(synthRect.x)}_${Math.round(synthRect.y)}`;
  const created = createRoom({
    floorId,
    name: synthName,
    type: synthType,
    x: synthRect.x,
    y: synthRect.y,
    width: synthRect.w,
    height: synthRect.h,
    tags: [`apt-room:${synthId}`, `flat:${unitId}`, `role:${synthType}`, "synthesized:auto"],
    daylightRequirement: "medium",
    privacyRequirement: synthType === RoomType.Bedroom || synthType === RoomType.Bathroom ? "high" : "low",
    isFixed: false
  });
  const synthesizedRoom = {
    ...created,
    id: synthId,
    unitId,
    spaceUse: roomSpaceUse({ ...created, unitId }),
    planningZone: synthType === RoomType.Bathroom || synthType === RoomType.Utility ? "SERVICE" : synthType === RoomType.Bedroom ? "PRIVATE" : "PUBLIC",
    bathroomAccessClass: synthType === RoomType.Bathroom ? bathOptions?.isAttached ? "ATTACHED" : "COMMON" : void 0,
    bathroomOwnerRoomId: bathOptions?.isAttached ? parent.id : void 0
  };
  const doorWidth = synthType === RoomType.Bathroom || synthType === RoomType.Utility ? 750 : 900;
  const livingRoom = allUnitRooms?.find((r) => r.type === RoomType.Living || r.tags.includes("role:living"));
  let connectTargetId = parent.id;
  let sharedSegment = findSharedWallSegment(updatedParent, synthesizedRoom);
  if (synthType === RoomType.Bedroom && livingRoom && findSharedWallSegment(synthesizedRoom, livingRoom)) {
    connectTargetId = livingRoom.id;
    sharedSegment = findSharedWallSegment(synthesizedRoom, livingRoom);
  }
  const doorPos = sharedSegment ? sharedSegment.axis === "x" ? { x: snap10((sharedSegment.lo + sharedSegment.hi) / 2), y: sharedSegment.coord } : { x: sharedSegment.coord, y: snap10((sharedSegment.lo + sharedSegment.hi) / 2) } : { x: snap10(synthRect.x + synthRect.w / 2), y: snap10(synthRect.y) };
  const connectingDoor = {
    id: `${synthId}__door_entry`,
    floorId,
    wallId: "__auto_wall__",
    position: doorPos,
    width: doorWidth,
    height: 2100,
    type: synthType === RoomType.Balcony ? DoorType.Sliding : DoorType.Single,
    swingDirection: synthType === RoomType.Balcony || synthType === RoomType.Utility ? SwingDirection.Outward : SwingDirection.Inward,
    connectsRooms: [connectTargetId, synthId]
  };
  return { parentRoom: updatedParent, synthesizedRoom, connectingDoor };
}
function repairMinDimensions(params) {
  const { compactPlotAdaptation } = params;
  const rooms = [...params.rooms];
  const repairs = [];
  const advisories = [];
  let repaired = false;
  const standardMin = {
    [RoomType.Living]: 3e3,
    [RoomType.Bedroom]: 2700,
    [RoomType.Kitchen]: 2100,
    [RoomType.Bathroom]: 1200,
    [RoomType.Balcony]: 1200,
    [RoomType.Corridor]: 1200
  };
  const compactMin = {
    [RoomType.Living]: 2400,
    [RoomType.Bedroom]: 2400,
    [RoomType.Kitchen]: 1800,
    [RoomType.Bathroom]: 1100,
    [RoomType.Balcony]: 1100,
    [RoomType.Corridor]: 900
  };
  for (let i = 0; i < rooms.length; i++) {
    const roomA = rooms[i];
    const isInternalPassageA = (roomA.type === RoomType.Corridor || roomA.type === RoomType.Custom) && (Boolean(roomA.unitId) || roomA.tags.some((t) => t.startsWith("flat:")) || roomA.name.toLowerCase().includes("passage"));
    const standardLimit = isInternalPassageA ? 900 : standardMin[roomA.type];
    if (!standardLimit) continue;
    const rA = getRoomRect(roomA);
    const minDimA = Math.min(rA.w, rA.h);
    if (minDimA < standardLimit) {
      let slackShifted = false;
      for (let j = 0; j < rooms.length; j++) {
        if (i === j) continue;
        const roomB = rooms[j];
        if (roomA.unitId && roomA.unitId !== roomB.unitId) continue;
        const shared = findSharedWallSegment(roomA, roomB);
        if (!shared) continue;
        const rB = getRoomRect(roomB);
        const isInternalPassageB = (roomB.type === RoomType.Corridor || roomB.type === RoomType.Custom) && (Boolean(roomB.unitId) || roomB.tags.some((t) => t.startsWith("flat:")) || roomB.name.toLowerCase().includes("passage"));
        const minDimB = isInternalPassageB ? 900 : Math.max(standardMin[roomB.type] ?? 1200, MINIMUM_DIMENSIONS[roomB.type] ?? 0);
        const minAreaB = MINIMUM_ROOM_AREAS[roomB.type] ?? 0;
        if (shared.axis === "y") {
          if (rA.y !== rB.y || rA.h !== rB.h) continue;
          const deficit = standardLimit - rA.w;
          if (deficit > 0) {
            const minWidthForArea = minAreaB > 0 && rB.h > 0 ? Math.ceil(minAreaB / rB.h) : 0;
            const effectiveLimitB = Math.max(minDimB, minWidthForArea);
            const surplusB = rB.w - effectiveLimitB;
            if (surplusB > 100) {
              const delta = snap10(Math.min(deficit, surplusB - 100));
              if (delta > 0 && rB.w - delta >= minDimB && (rB.w - delta) * rB.h >= minAreaB) {
                if (rB.x > rA.x) {
                  const newA = { x: rA.x, y: rA.y, w: rA.w + delta, h: rA.h };
                  const newB = { x: rB.x + delta, y: rB.y, w: rB.w - delta, h: rB.h };
                  rooms[i] = { ...roomA, ...newA, width: newA.w, height: newA.h, area: newA.w * newA.h, boundary: rectToPolygon2(newA) };
                  rooms[j] = { ...roomB, ...newB, width: newB.w, height: newB.h, area: newB.w * newB.h, boundary: rectToPolygon2(newB) };
                } else {
                  const newA = { x: rA.x - delta, y: rA.y, w: rA.w + delta, h: rA.h };
                  const newB = { x: rB.x, y: rB.y, w: rB.w - delta, h: rB.h };
                  rooms[i] = { ...roomA, ...newA, width: newA.w, height: newA.h, area: newA.w * newA.h, boundary: rectToPolygon2(newA) };
                  rooms[j] = { ...roomB, ...newB, width: newB.w, height: newB.h, area: newB.w * newB.h, boundary: rectToPolygon2(newB) };
                }
                slackShifted = true;
                repaired = true;
                repairs.push({
                  category: "MIN_DIMENSION_ELASTIC_SHIFT",
                  description: `Elastically shifted partition between ${roomA.id} and ${roomB.id} by ${delta} mm (conserving Delta = 0.000 mm\xB2)`,
                  targetEntities: [roomA.id, roomB.id]
                });
                break;
              }
            }
          }
        } else {
          if (rA.x !== rB.x || rA.w !== rB.w) continue;
          const deficit = standardLimit - rA.h;
          if (deficit > 0) {
            const minHeightForArea = minAreaB > 0 && rB.w > 0 ? Math.ceil(minAreaB / rB.w) : 0;
            const effectiveLimitB = Math.max(minDimB, minHeightForArea);
            const surplusB = rB.h - effectiveLimitB;
            if (surplusB > 100) {
              const delta = snap10(Math.min(deficit, surplusB - 100));
              if (delta > 0 && rB.h - delta >= minDimB && rB.w * (rB.h - delta) >= minAreaB) {
                if (rB.y > rA.y) {
                  const newA = { x: rA.x, y: rA.y, w: rA.w, h: rA.h + delta };
                  const newB = { x: rB.x, y: rB.y + delta, w: rB.w, h: rB.h - delta };
                  rooms[i] = { ...roomA, ...newA, width: newA.w, height: newA.h, area: newA.w * newA.h, boundary: rectToPolygon2(newA) };
                  rooms[j] = { ...roomB, ...newB, width: newB.w, height: newB.h, area: newB.w * newB.h, boundary: rectToPolygon2(newB) };
                } else {
                  const newA = { x: rA.x, y: rA.y - delta, w: rA.w, h: rA.h + delta };
                  const newB = { x: rB.x, y: rB.y, w: rB.w, h: rB.h - delta };
                  rooms[i] = { ...roomA, ...newA, width: newA.w, height: newA.h, area: newA.w * newA.h, boundary: rectToPolygon2(newA) };
                  rooms[j] = { ...roomB, ...newB, width: newB.w, height: newB.h, area: newB.w * newB.h, boundary: rectToPolygon2(newB) };
                }
                slackShifted = true;
                repaired = true;
                repairs.push({
                  category: "MIN_DIMENSION_ELASTIC_SHIFT",
                  description: `Elastically shifted horizontal partition between ${roomA.id} and ${roomB.id} by ${delta} mm (conserving Delta = 0.000 mm\xB2)`,
                  targetEntities: [roomA.id, roomB.id]
                });
                break;
              }
            }
          }
        }
      }
      if (!slackShifted && compactPlotAdaptation) {
        const cLimit = compactMin[roomA.type] ?? 1100;
        if (minDimA >= cLimit) {
          advisories.push(
            `COMPACT_PLOT_ADAPTATION: ${roomA.name} clear dimension ${minDimA} mm meets compact plot standard (>= ${cLimit} mm).`
          );
        }
      }
    }
  }
  return { rooms, repaired, repairs, advisories };
}
function repairPrivacyAndCirculation(params) {
  const { rooms, walls, units, floorId } = params;
  let doors = [...params.doors];
  const repairs = [];
  let repaired = false;
  const privateTypes = /* @__PURE__ */ new Set([RoomType.Bedroom, RoomType.Bathroom, RoomType.Kitchen]);
  const preservedDoors = [];
  for (const door of doors) {
    const [rAId, rBId] = door.connectsRooms;
    const roomA = rooms.find((r) => r.id === rAId);
    const roomB = rooms.find((r) => r.id === rBId);
    const isACommon = roomA && (roomA.spaceUse === "COMMON" || roomA.spaceUse === "CORE");
    const isBCommon = roomB && (roomB.spaceUse === "COMMON" || roomB.spaceUse === "CORE");
    const isAPrivate = roomA && roomA.unitId && privateTypes.has(roomA.type);
    const isBPrivate = roomB && roomB.unitId && privateTypes.has(roomB.type);
    if (isACommon && isBPrivate || isBCommon && isAPrivate) {
      repaired = true;
      repairs.push({
        category: "PRIVACY_CIRCULATION",
        description: `Eliminated privacy violation door ${door.id} connecting Common Corridor directly to private room`,
        targetEntities: [door.id]
      });
      continue;
    }
    if (roomA?.unitId && roomB?.unitId && roomA.unitId !== roomB.unitId) {
      repaired = true;
      repairs.push({
        category: "PRIVACY_CIRCULATION",
        description: `Eliminated cross-tenancy breach door ${door.id} connecting unit ${roomA.unitId} to unit ${roomB.unitId}`,
        targetEntities: [door.id]
      });
      continue;
    }
    preservedDoors.push(door);
  }
  doors = preservedDoors;
  if (units) {
    for (const u of units) {
      const unitRooms = rooms.filter((r) => r.unitId === u.id);
      const livingRoom = unitRooms.find((r) => r.type === RoomType.Living || r.tags.includes("role:living")) ?? unitRooms[0];
      const commonCorridor = rooms.find((r) => r.spaceUse === "COMMON" || r.type === RoomType.Corridor);
      if (!livingRoom || !commonCorridor) continue;
      const unitEntrances = doors.filter((d) => {
        const [a, b] = d.connectsRooms;
        const hasUnit = unitRooms.some((r) => r.id === a || r.id === b);
        const hasCommon = rooms.some((r) => (r.id === a || r.id === b) && (r.spaceUse === "COMMON" || r.spaceUse === "CORE"));
        return hasUnit && hasCommon;
      });
      if (unitEntrances.length === 0) {
        const shared = findSharedWallSegment(commonCorridor, livingRoom);
        if (shared) {
          const width = shared.len >= 1250 ? 1050 : 1e3;
          const hostWall = walls.find((w) => w.roomIds.includes(commonCorridor.id) && w.roomIds.includes(livingRoom.id));
          const pos = shared.axis === "x" ? { x: snap10((shared.lo + shared.hi) / 2), y: shared.coord } : { x: shared.coord, y: snap10((shared.lo + shared.hi) / 2) };
          const newDoor = {
            id: `${u.id}__door_primary_entrance`,
            floorId,
            wallId: hostWall?.id ?? "__auto_wall__",
            position: pos,
            width,
            height: 2100,
            type: DoorType.Single,
            swingDirection: SwingDirection.Inward,
            connectsRooms: [commonCorridor.id, livingRoom.id]
          };
          doors.push(newDoor);
          repaired = true;
          repairs.push({
            category: "PRIVACY_CIRCULATION",
            description: `Synthesized missing Primary Entrance Door (${width} mm) for unit ${u.id}`,
            targetEntities: [newDoor.id, livingRoom.id]
          });
        }
      } else if (unitEntrances.length > 1) {
        const bestEntrance = unitEntrances.find((d) => d.connectsRooms.includes(livingRoom.id)) ?? unitEntrances[0];
        for (const extra of unitEntrances) {
          if (extra.id !== bestEntrance.id) {
            doors = doors.filter((d) => d.id !== extra.id);
            repaired = true;
            repairs.push({
              category: "PRIVACY_CIRCULATION",
              description: `Removed secondary/redundant entrance door ${extra.id} for unit ${u.id}`,
              targetEntities: [extra.id]
            });
          }
        }
      }
    }
  }
  const graph = new Map(rooms.map((r) => [r.id, /* @__PURE__ */ new Set()]));
  for (const d of doors) {
    const [a, b] = d.connectsRooms;
    if (graph.has(a) && graph.has(b)) {
      graph.get(a).add(b);
      graph.get(b).add(a);
    }
  }
  if (units) {
    for (const u of units) {
      const unitRooms = rooms.filter((r) => r.unitId === u.id);
      const livingRoom = unitRooms.find((r) => r.type === RoomType.Living || r.tags.includes("role:living")) ?? unitRooms[0];
      if (!livingRoom) continue;
      const visited = /* @__PURE__ */ new Set([livingRoom.id]);
      const queue = [livingRoom.id];
      while (queue.length > 0) {
        const curr = queue.shift();
        for (const neighbor of graph.get(curr) ?? []) {
          const nRoom = rooms.find((r) => r.id === neighbor);
          if (nRoom?.unitId === u.id && !visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      const unreachable = unitRooms.filter((r) => !visited.has(r.id));
      for (const orphan of unreachable) {
        if (visited.has(orphan.id)) continue;
        let targetReachable = null;
        if (orphan.type === RoomType.Bathroom && orphan.bathroomOwnerRoomId) {
          const owner = unitRooms.find((r) => r.id === orphan.bathroomOwnerRoomId);
          if (owner && visited.has(owner.id) && findSharedWallSegment(orphan, owner)) {
            targetReachable = owner;
          }
        }
        if (!targetReachable && (orphan.type === RoomType.Utility || orphan.name.toLowerCase().includes("utility"))) {
          const kitchen = unitRooms.find((r) => r.type === RoomType.Kitchen && visited.has(r.id));
          if (kitchen && findSharedWallSegment(orphan, kitchen)) {
            targetReachable = kitchen;
          }
        }
        if (!targetReachable && !orphan.bathroomOwnerRoomId) {
          const candidates = unitRooms.filter((r) => visited.has(r.id) && !r.bathroomOwnerRoomId && r.type !== RoomType.Bathroom && findSharedWallSegment(orphan, r));
          if (candidates.length > 0) {
            candidates.sort((a, b) => {
              const lenA = findSharedWallSegment(orphan, a)?.len ?? 0;
              const lenB = findSharedWallSegment(orphan, b)?.len ?? 0;
              return lenB - lenA;
            });
            targetReachable = candidates[0];
          }
        }
        if (targetReachable) {
          const shared = findSharedWallSegment(orphan, targetReachable);
          const isBath = orphan.type === RoomType.Bathroom;
          const isBalc = orphan.type === RoomType.Balcony;
          const isUtil = orphan.type === RoomType.Utility;
          const width = isBalc ? shared.len >= 1700 ? 1500 : 900 : isBath || isUtil ? shared.len >= 950 ? 750 : 700 : shared.len >= 1100 ? 900 : 800;
          const pos = shared.axis === "x" ? { x: snap10((shared.lo + shared.hi) / 2), y: shared.coord } : { x: shared.coord, y: snap10((shared.lo + shared.hi) / 2) };
          const hostWall = walls.find((w) => w.roomIds.includes(orphan.id) && w.roomIds.includes(targetReachable.id));
          const newDoor = {
            id: `${orphan.id}__door_reachability`,
            floorId,
            wallId: hostWall?.id ?? "__auto_wall__",
            position: pos,
            width,
            height: 2100,
            type: isBalc ? DoorType.Sliding : DoorType.Single,
            swingDirection: isBalc || isUtil ? SwingDirection.Outward : SwingDirection.Inward,
            connectsRooms: [targetReachable.id, orphan.id]
          };
          doors.push(newDoor);
          visited.add(orphan.id);
          graph.get(orphan.id).add(targetReachable.id);
          graph.get(targetReachable.id).add(orphan.id);
          const pending = [orphan.id];
          for (let i = 0; i < pending.length; i++) for (const id of graph.get(pending[i]) ?? []) {
            if (!visited.has(id) && unitRooms.some((r) => r.id === id)) {
              visited.add(id);
              pending.push(id);
            }
          }
          repaired = true;
          repairs.push({
            category: "PRIVACY_CIRCULATION",
            description: `Healed orphan space ${orphan.id} (${orphan.name}) by creating connecting door to ${targetReachable.id}`,
            targetEntities: [newDoor.id, orphan.id, targetReachable.id]
          });
        }
      }
    }
  }
  return { doors, repaired, repairs };
}
function repairDoorHostsAndClearance(params) {
  const { rooms, walls, floorId } = params;
  const repairedDoors = [];
  const repairs = [];
  let repaired = false;
  for (const door of params.doors) {
    const [rAId, rBId] = door.connectsRooms;
    const roomA = rooms.find((r) => r.id === rAId);
    const roomB = rooms.find((r) => r.id === rBId);
    if (!roomA || !roomB) {
      continue;
    }
    const matchingWall = walls.find((w) => w.roomIds.includes(roomA.id) && w.roomIds.includes(roomB.id));
    if (!matchingWall) {
      continue;
    }
    const wallLen = Math.hypot(
      matchingWall.endPoint.x - matchingWall.startPoint.x,
      matchingWall.endPoint.y - matchingWall.startPoint.y
    );
    let doorWidth = door.width;
    const isEntrance = (roomA.spaceUse === "COMMON" || roomA.spaceUse === "CORE") && roomB.unitId || (roomB.spaceUse === "COMMON" || roomB.spaceUse === "CORE") && roomA.unitId;
    const isBedroom = roomA.type === RoomType.Bedroom || roomB.type === RoomType.Bedroom;
    const isKitchen = roomA.type === RoomType.Kitchen || roomB.type === RoomType.Kitchen;
    const isService = roomA.type === RoomType.Bathroom || roomB.type === RoomType.Bathroom || roomA.type === RoomType.Utility || roomB.type === RoomType.Utility;
    const maxStatutoryWidth = isEntrance ? 1050 : isBedroom || isKitchen ? 900 : isService ? 750 : 1500;
    if (doorWidth > maxStatutoryWidth) {
      doorWidth = maxStatutoryWidth;
    }
    if (wallLen < doorWidth + 200) {
      if (isEntrance && wallLen >= 1200) doorWidth = 1e3;
      else if (isBedroom && wallLen >= 1e3) doorWidth = 800;
      else if (isService && wallLen >= 900) doorWidth = 700;
      else doorWidth = Math.max(650, Math.floor(wallLen - 200));
    }
    if (wallLen < doorWidth + 200) {
      continue;
    }
    const horizontal = Math.abs(matchingWall.startPoint.y - matchingWall.endPoint.y) <= 1;
    let centerPos;
    if (horizontal) {
      const minX = Math.min(matchingWall.startPoint.x, matchingWall.endPoint.x);
      const maxX = Math.max(matchingWall.startPoint.x, matchingWall.endPoint.x);
      const exactX = (minX + maxX) / 2;
      const minValidX = minX + 100 + doorWidth / 2;
      const maxValidX = maxX - 100 - doorWidth / 2;
      const x = Math.min(maxValidX, Math.max(minValidX, Math.round(exactX)));
      centerPos = { x, y: matchingWall.startPoint.y };
    } else {
      const minY = Math.min(matchingWall.startPoint.y, matchingWall.endPoint.y);
      const maxY = Math.max(matchingWall.startPoint.y, matchingWall.endPoint.y);
      const exactY = (minY + maxY) / 2;
      const minValidY = minY + 100 + doorWidth / 2;
      const maxValidY = maxY - 100 - doorWidth / 2;
      const y = Math.min(maxValidY, Math.max(minValidY, Math.round(exactY)));
      centerPos = { x: matchingWall.startPoint.x, y };
    }
    let swingDirection = door.swingDirection;
    let doorType = door.type;
    if (roomA.type === RoomType.Balcony || roomB.type === RoomType.Balcony) {
      doorType = DoorType.Sliding;
    } else if (isEntrance) {
      swingDirection = SwingDirection.Inward;
    }
    const updatedDoor = {
      ...door,
      floorId,
      wallId: matchingWall.id,
      position: centerPos,
      width: doorWidth,
      type: doorType,
      swingDirection
    };
    if (door.wallId !== matchingWall.id || door.width !== doorWidth || Math.abs(door.position.x - centerPos.x) > 2 || Math.abs(door.position.y - centerPos.y) > 2) {
      repaired = true;
      repairs.push({
        category: "DOOR_HOST_AND_SWING",
        description: `Centered door ${door.id} on host wall ${matchingWall.id} with ${doorWidth} mm width (>= 100mm corner clearance)`,
        targetEntities: [door.id, matchingWall.id]
      });
    }
    repairedDoors.push(updatedDoor);
  }
  const nonOverlappingDoors = [];
  for (let i = 0; i < repairedDoors.length; i++) {
    const d1 = repairedDoors[i];
    let overlap = false;
    for (let j = 0; j < nonOverlappingDoors.length; j++) {
      const d2 = nonOverlappingDoors[j];
      if (d1.wallId === d2.wallId) {
        const dist = Math.hypot(d1.position.x - d2.position.x, d1.position.y - d2.position.y);
        if (dist < (d1.width + d2.width) / 2) {
          overlap = true;
          break;
        }
      }
    }
    if (!overlap) {
      nonOverlappingDoors.push(d1);
    } else {
      repaired = true;
      repairs.push({
        category: "DOOR_HOST_AND_SWING",
        description: `Resolved opening overlap by deduplicating coincident door ${d1.id} on wall ${d1.wallId}`,
        targetEntities: [d1.id]
      });
    }
  }
  return { doors: nonOverlappingDoors, repaired, repairs };
}
function repairDaylightAndVentilation(params) {
  const { rooms, doors, walls, floorId } = params;
  let repaired = false;
  const repairs = [];
  const windows = params.windows.filter((w) => {
    const host = walls.find((wall) => wall.id === w.wallId);
    const room = rooms.find((r) => r.id === w.roomId);
    if (!host || !room) return false;
    return openingFitsApartmentWall(host, w.position, w.width) && host.roomIds.includes(w.roomId);
  });
  if (windows.length !== params.windows.length) {
    repaired = true;
  }
  for (const r of rooms) {
    if (!r.unitId) continue;
    if (["living", "bedroom", "kitchen"].includes(r.type)) {
      const hasWindow = windows.some((w) => w.roomId === r.id);
      const hasBalconyOrUtilityDoor = doors.some((d) => {
        const otherId = d.connectsRooms[0] === r.id ? d.connectsRooms[1] : d.connectsRooms[0];
        const other = rooms.find((o) => o.id === otherId);
        return other && (other.type === RoomType.Balcony || other.type === RoomType.Utility);
      });
      if (!hasWindow && !hasBalconyOrUtilityDoor) {
        const candWalls = walls.filter(
          (w) => w.roomIds.includes(r.id) && (w.wallUse === "EXTERNAL" || w.roomIds.length === 1 && w.type === WallType.External)
        );
        for (const hostWall of candWalls) {
          const len = Math.hypot(hostWall.endPoint.x - hostWall.startPoint.x, hostWall.endPoint.y - hostWall.startPoint.y);
          if (len < 900) continue;
          const winWidth = Math.min(1500, Math.max(700, Math.min(len - 200, Math.round(len * 0.4))));
          const pos = {
            x: snap10((hostWall.startPoint.x + hostWall.endPoint.x) / 2),
            y: snap10((hostWall.startPoint.y + hostWall.endPoint.y) / 2)
          };
          if (openingFitsApartmentWall(hostWall, pos, winWidth)) {
            const newWin = {
              id: `${r.id}__auto_window`,
              floorId,
              wallId: hostWall.id,
              position: pos,
              width: winWidth,
              height: 1200,
              sillHeight: 900,
              type: WindowType.Sliding,
              roomId: r.id
            };
            windows.push(newWin);
            repaired = true;
            repairs.push({
              category: "DAYLIGHT_SHAFT",
              description: `Added ${winWidth} mm exterior daylight window for ${r.name} (${r.type})`,
              targetEntities: [newWin.id, r.id]
            });
            break;
          }
        }
      }
    }
    if (r.type === RoomType.Bathroom) {
      const hasVent = windows.some((w) => w.roomId === r.id);
      const touchesShaft = walls.some((w) => w.roomIds.includes(r.id) && w.wallUse === "SHAFT");
      if (!hasVent && !touchesShaft) {
        const extWall = walls.find((w) => w.roomIds.includes(r.id) && (w.wallUse === "EXTERNAL" || w.roomIds.length === 1));
        if (extWall) {
          const len = Math.hypot(extWall.endPoint.x - extWall.startPoint.x, extWall.endPoint.y - extWall.startPoint.y);
          if (len >= 800) {
            const ventWidth = 600;
            const pos = {
              x: snap10((extWall.startPoint.x + extWall.endPoint.x) / 2),
              y: snap10((extWall.startPoint.y + extWall.endPoint.y) / 2)
            };
            if (openingFitsApartmentWall(extWall, pos, ventWidth)) {
              const newVent = {
                id: `${r.id}__auto_ventilator`,
                floorId,
                wallId: extWall.id,
                position: pos,
                width: ventWidth,
                height: 600,
                sillHeight: 1800,
                type: WindowType.Ventilator,
                roomId: r.id
              };
              windows.push(newVent);
              repaired = true;
              repairs.push({
                category: "DAYLIGHT_SHAFT",
                description: `Added 600 mm ventilator window on exterior wall for bathroom ${r.id}`,
                targetEntities: [newVent.id, r.id]
              });
            }
          }
        }
      }
    }
  }
  return { windows, repaired, repairs };
}

// packages/planning-engine/src/plancraft/auto-furnish-apartment.ts
function getRoomDoorClearanceBoxes(room, floor) {
  const clearanceBoxes = [];
  const roomDoors = floor.doors.filter(
    (d) => d.connectsRooms?.includes(room.id) || d.adjacentRoomId === room.id
  );
  for (const door of roomDoors) {
    const dW = door.width || 900;
    const buffer = 600;
    const sweep = dW + buffer;
    const minX = Math.max(room.x, door.position.x - sweep / 2);
    const maxX = Math.min(room.x + room.width, door.position.x + sweep / 2);
    const minY = Math.max(room.y, door.position.y - sweep / 2);
    const maxY = Math.min(room.y + room.height, door.position.y + sweep / 2);
    clearanceBoxes.push({ minX, minY, maxX, maxY });
  }
  return clearanceBoxes;
}
function collidesWithDoorClearance(box, doorBoxes) {
  for (const d of doorBoxes) {
    const overlapX = box.x < d.maxX && box.x + box.w > d.minX;
    const overlapY = box.y < d.maxY && box.y + box.h > d.minY;
    if (overlapX && overlapY) return true;
  }
  return false;
}
function getRoomFlatId(room) {
  if (room.unitId) return room.unitId;
  const flatTag = room.tags.find((t) => t.startsWith("flat:"));
  return flatTag ? flatTag.replace("flat:", "") : void 0;
}
function furnishRoom(room, floor, _manifest) {
  const items = [];
  const flatId = getRoomFlatId(room);
  const rx = room.x;
  const ry = room.y;
  const rw = room.width;
  const rh = room.height;
  const rName = (room.name || "").toUpperCase();
  const areaM2 = room.area / 1e6;
  const doorBoxes = getRoomDoorClearanceBoxes(room, floor);
  const wallInset = 155;
  const innerMinX = rx + wallInset;
  const innerMinY = ry + wallInset;
  const innerMaxX = rx + rw - wallInset;
  const innerMaxY = ry + rh - wallInset;
  const roomWindows = (floor.windows || []).filter(
    (w) => w.roomId === room.id || w.adjacentRoomId === room.id || w.position.x >= rx - 200 && w.position.x <= rx + rw + 200 && w.position.y >= ry - 200 && w.position.y <= ry + rh + 200
  );
  const hasNorthWindow = roomWindows.some((w) => Math.abs(w.position.y - ry) <= 250);
  const hasSouthWindow = roomWindows.some((w) => Math.abs(w.position.y - (ry + rh)) <= 250);
  const hasWestWindow = roomWindows.some((w) => Math.abs(w.position.x - rx) <= 250);
  const hasEastWindow = roomWindows.some((w) => Math.abs(w.position.x - (rx + rw)) <= 250);
  const addItem = (type, rawX, rawY, w, d, rot = 0, anchorWall, force = false) => {
    if (w > innerMaxX - innerMinX + 20 || d > innerMaxY - innerMinY + 20) {
      return;
    }
    const clampedX = Math.max(innerMinX, Math.min(innerMaxX - w, rawX));
    const clampedY = Math.max(innerMinY, Math.min(innerMaxY - d, rawY));
    if (!force && collidesWithDoorClearance({ x: clampedX, y: clampedY, w, h: d }, doorBoxes)) {
      return;
    }
    const itemIndex = items.filter((i) => i.roomId === room.id && i.type === type).length + 1;
    items.push({
      id: `${room.id}__furn_${type}_${itemIndex}`,
      type,
      roomId: room.id,
      flatId,
      xMm: Math.round(clampedX),
      yMm: Math.round(clampedY),
      widthMm: Math.round(w),
      depthMm: Math.round(d),
      rotationDeg: rot,
      anchorWall,
      layer: "A-FURN"
    });
  };
  if (room.type === RoomType.Living || room.type === RoomType.FamilyLiving || room.type === RoomType.Drawing || rName.includes("LIVING") || rName.includes("FOYER_LIVING_DINING")) {
    const isLarge = rw >= 5e3 && rh >= 4e3;
    const sofaType = isLarge ? "sectional_sofa" : "l_sofa";
    const sofaW = isLarge ? 3e3 : 2400;
    const sofaD = isLarge ? 2200 : 2e3;
    let placedSofa = null;
    const sofaCandidates = [
      { type: sofaType, x: rx + 300, y: ry + 300, w: sofaW, d: sofaD, rot: 0, wall: "NORTH" },
      { type: sofaType, x: rx + 300, y: ry + 2800, w: sofaW, d: sofaD, rot: 0, wall: "WEST" },
      { type: sofaType, x: rx + rw - sofaW - 300, y: ry + 2800, w: sofaW, d: sofaD, rot: 0, wall: "EAST" },
      { type: sofaType, x: rx + 300, y: ry + Math.max(300, Math.min(rh - sofaD - 300, 4500)), w: sofaW, d: sofaD, rot: 0, wall: "WEST" },
      { type: "sofa", x: rx + 200, y: ry + 200, w: 2e3, d: 900, rot: 0, wall: "NORTH" },
      { type: "sofa", x: rx + 200, y: ry + 2800, w: 2e3, d: 900, rot: 0, wall: "WEST" },
      { type: "sofa", x: rx + 200, y: ry + Math.max(200, Math.min(rh - 1200, 4500)), w: 2e3, d: 900, rot: 0, wall: "WEST" }
    ];
    for (const cand of sofaCandidates) {
      if (rw >= cand.w + 400 && rh >= cand.d + 400) {
        const initialCount = items.length;
        addItem(cand.type, cand.x, cand.y, cand.w, cand.d, cand.rot, cand.wall);
        if (items.length > initialCount) {
          placedSofa = cand;
          break;
        }
      }
    }
    if (placedSofa) {
      const cTableCandidates = [
        { x: placedSofa.x + (placedSofa.w - 1200) / 2, y: placedSofa.y + placedSofa.d + 300, w: 1200, d: 600, rot: 0 },
        { x: placedSofa.x + (placedSofa.w - 1e3) / 2, y: placedSofa.y + placedSofa.d + 200, w: 1e3, d: 500, rot: 0 },
        { x: placedSofa.x + (placedSofa.w - 800) / 2, y: placedSofa.y + placedSofa.d + 150, w: 800, d: 450, rot: 0 },
        { x: placedSofa.x + placedSofa.w + 300, y: placedSofa.y + (placedSofa.d - 600) / 2, w: 600, d: 1e3, rot: 90 },
        { x: rx + (rw - 1e3) / 2, y: ry + (rh - 500) / 2, w: 1e3, d: 500, rot: 0 }
      ];
      for (const ctc of cTableCandidates) {
        const init = items.length;
        addItem("coffee_table", ctc.x, ctc.y, ctc.w, ctc.d, ctc.rot, "CENTER");
        if (items.length > init) break;
      }
      if (!items.some((i) => i.roomId === room.id && i.type === "coffee_table")) {
        const cX = Math.max(innerMinX, Math.min(innerMaxX - 800, placedSofa.x + (placedSofa.w - 800) / 2));
        const cY = Math.max(innerMinY, Math.min(innerMaxY - 450, placedSofa.y + placedSofa.d + 200));
        addItem("coffee_table", cX, cY, 800, 450, 0, "CENTER", true);
      }
      const tvW = Math.min(1800, Math.max(1e3, rw - 600));
      const tvD = 450;
      const tvCandidates = [
        { x: rx + rw - tvD - 200, y: placedSofa.y, w: tvD, d: tvW, rot: 90, wall: "EAST" },
        { x: rx + 200, y: placedSofa.y + 1e3, w: tvD, d: tvW, rot: 90, wall: "WEST" },
        { x: rx + (rw - tvW) / 2, y: ry + rh - tvD - 200, w: tvW, d: tvD, rot: 0, wall: "SOUTH" },
        { x: rx + (rw - tvW) / 2, y: ry + 200, w: tvW, d: tvD, rot: 0, wall: "NORTH" }
      ];
      for (const tvc of tvCandidates) {
        if (rw >= tvc.w + 200 && rh >= tvc.d + 200) {
          const init = items.length;
          addItem("tv_console", tvc.x, tvc.y, tvc.w, tvc.d, tvc.rot, tvc.wall);
          if (items.length > init) break;
        }
      }
    } else {
      addItem("coffee_table", rx + (rw - 1e3) / 2, ry + (rh - 500) / 2, 1e3, 500, 0, "CENTER");
      addItem("tv_console", rx + rw - 650, ry + 1e3, 450, 1500, 90, "EAST");
    }
    const tblW = 1400;
    const tblD = 900;
    const diningX = rx + rw - tblW - 600;
    const diningY = ry + rh - tblD - 600;
    if (diningX > rx + 1500 && diningY > ry + 1500 && rw >= 4e3 && rh >= 4e3) {
      addItem("table", diningX, diningY, tblW, tblD, 0, "SOUTH");
      addItem("chair", diningX + 200, diningY - 450, 450, 450, 0, "CENTER");
      addItem("chair", diningX + 750, diningY - 450, 450, 450, 0, "CENTER");
      addItem("chair", diningX + 200, diningY + tblD, 450, 450, 180, "CENTER");
      addItem("chair", diningX + 750, diningY + tblD, 450, 450, 180, "CENTER");
    }
  } else if (room.type === RoomType.Dining || rName.includes("DINING")) {
    const tblW = 1500;
    const tblD = 900;
    const tx = rx + (rw - tblW) / 2;
    const ty = ry + (rh - tblD) / 2;
    addItem("table", tx, ty, tblW, tblD, 0, "CENTER");
    addItem("chair", tx + 200, ty - 450, 450, 450, 0, "CENTER");
    addItem("chair", tx + 850, ty - 450, 450, 450, 0, "CENTER");
    addItem("chair", tx + 200, ty + tblD, 450, 450, 180, "CENTER");
    addItem("chair", tx + 850, ty + tblD, 450, 450, 180, "CENTER");
  } else if (room.type === RoomType.Bedroom || rName.includes("BED")) {
    const isMaster = rName.includes("MASTER") || areaM2 >= 13;
    const bedW = isMaster ? 1800 : 1500;
    const bedD = 2e3;
    const rawBedCandidates = [
      { x: rx + (rw - bedW) / 2, y: ry + 150, w: bedW, d: bedD, rot: 0, wall: "NORTH" },
      { x: rx + (rw - bedW) / 2, y: ry + rh - bedD - 150, w: bedW, d: bedD, rot: 180, wall: "SOUTH" },
      { x: rx + 150, y: ry + (rh - bedW) / 2, w: bedD, d: bedW, rot: 90, wall: "WEST" },
      { x: rx + rw - bedD - 150, y: ry + (rh - bedW) / 2, w: bedD, d: bedW, rot: 270, wall: "EAST" }
    ];
    const bedCandidates = rawBedCandidates.filter((bc) => {
      if (bc.wall === "NORTH" && hasNorthWindow) return false;
      if (bc.wall === "SOUTH" && hasSouthWindow) return false;
      if (bc.wall === "WEST" && hasWestWindow) return false;
      if (bc.wall === "EAST" && hasEastWindow) return false;
      return true;
    });
    const finalBedCandidates = bedCandidates.length > 0 ? bedCandidates : rawBedCandidates;
    for (const bc of finalBedCandidates) {
      if (rw >= bc.w + 100 && rh >= bc.d + 100) {
        const init = items.length;
        addItem("bed", bc.x, bc.y, bc.w, bc.d, bc.rot, bc.wall);
        if (items.length > init) break;
      }
    }
    if (!items.some((i) => i.roomId === room.id && i.type === "bed")) {
      const compactBedCandidates = [
        { x: rx + 200, y: ry + 200, w: 1200, d: 1900, rot: 0, wall: "NORTH" },
        { x: rx + rw - 1400, y: ry + 200, w: 1200, d: 1900, rot: 0, wall: "NORTH" },
        { x: rx + 200, y: ry + rh - 2100, w: 1200, d: 1900, rot: 180, wall: "SOUTH" },
        { x: rx + rw - 1400, y: ry + rh - 2100, w: 1200, d: 1900, rot: 180, wall: "SOUTH" },
        { x: rx + 200, y: ry + 200, w: 1900, d: 1200, rot: 90, wall: "WEST" },
        { x: rx + rw - 2100, y: ry + 200, w: 1900, d: 1200, rot: 270, wall: "EAST" }
      ];
      for (const bc of compactBedCandidates) {
        if (rw >= bc.w + 100 && rh >= bc.d + 100) {
          const init = items.length;
          addItem("bed", bc.x, bc.y, bc.w, bc.d, bc.rot, bc.wall);
          if (items.length > init) break;
        }
      }
      if (!items.some((i) => i.roomId === room.id && i.type === "bed")) {
        const bW = Math.min(1200, rw - 350);
        const bD = Math.min(1900, rh - 350);
        const bX = Math.max(innerMinX, rx + (rw - bW) / 2);
        const bY = Math.max(innerMinY, ry + 200);
        addItem("bed", bX, bY, bW, bD, 0, "NORTH", true);
      }
    }
    const wardDim1 = Math.min(1800, Math.max(900, Math.min(rw, rh) - 1e3));
    const wardDim2 = 600;
    const rawWardCandidates = [
      { x: rx + 150, y: ry + rh - wardDim1 - 200, w: wardDim2, d: wardDim1, rot: 90, wall: "WEST" },
      { x: rx + rw - wardDim2 - 150, y: ry + rh - wardDim1 - 200, w: wardDim2, d: wardDim1, rot: 270, wall: "EAST" },
      { x: rx + (rw - wardDim1) / 2, y: ry + rh - wardDim2 - 150, w: wardDim1, d: wardDim2, rot: 0, wall: "SOUTH" },
      { x: rx + (rw - wardDim1) / 2, y: ry + 150, w: wardDim1, d: wardDim2, rot: 0, wall: "NORTH" }
    ];
    const wardCandidates = rawWardCandidates.filter((wc) => {
      if (wc.wall === "NORTH" && hasNorthWindow) return false;
      if (wc.wall === "SOUTH" && hasSouthWindow) return false;
      if (wc.wall === "WEST" && hasWestWindow) return false;
      if (wc.wall === "EAST" && hasEastWindow) return false;
      return true;
    });
    const finalWardCandidates = wardCandidates.length > 0 ? wardCandidates : rawWardCandidates;
    for (const wc of finalWardCandidates) {
      if (rw >= wc.w + 100 && rh >= wc.d + 100) {
        const init = items.length;
        addItem("wardrobe", wc.x, wc.y, wc.w, wc.d, wc.rot, wc.wall);
        if (items.length > init) break;
      }
    }
    if (rw >= 3e3 && rh >= 2800) {
      const deskW = 1200;
      const deskD = 600;
      const deskX = rx + rw - deskW - 300;
      const deskY = ry + rh - deskD - 300;
      addItem("desk", deskX, deskY, deskW, deskD, 0, "SOUTH");
      addItem("office_chair", deskX + (deskW - 550) / 2, deskY - 500, 550, 550, 0, "CENTER");
      addItem("floor_lamp", rx + rw - 400, ry + 200, 300, 300, 0, "EAST");
    }
  } else if ((room.type === RoomType.Kitchen || rName.includes("KITCHEN")) && !rName.includes("UTILITY") && !rName.includes("BALCONY") && room.type !== RoomType.Balcony && room.type !== RoomType.Utility) {
    const counterD = 600;
    const counterW = Math.min(3e3, rw - 400);
    const rawCounterCandidates = [
      { x: rx + 200, y: ry + rh - counterD - 150, w: counterW, d: counterD, wall: "SOUTH", isHoriz: true },
      { x: rx + 200, y: ry + 150, w: counterW, d: counterD, wall: "NORTH", isHoriz: true },
      { x: rx + rw - counterD - 150, y: ry + 200, w: counterD, d: Math.min(3e3, rh - 400), wall: "EAST", isHoriz: false },
      { x: rx + 150, y: ry + 200, w: counterD, d: Math.min(3e3, rh - 400), wall: "WEST", isHoriz: false }
    ];
    for (const run of [1800, 1500, 1400]) {
      for (let offset = 150; offset + run <= rh - 100; offset += 100) {
        rawCounterCandidates.push(
          { x: rx + 100, y: ry + offset, w: counterD, d: run, wall: "WEST", isHoriz: false },
          { x: rx + rw - counterD - 100, y: ry + offset, w: counterD, d: run, wall: "EAST", isHoriz: false }
        );
      }
    }
    const counterCandidates = rawCounterCandidates.filter(
      (cc) => !collidesWithDoorClearance({ x: cc.x, y: cc.y, w: cc.w, h: cc.d }, doorBoxes)
    );
    const finalCandidates = counterCandidates.length > 0 ? counterCandidates : rawCounterCandidates;
    let placedCounter = null;
    for (const cc of finalCandidates) {
      if (rw >= cc.w + 100 && rh >= cc.d + 100) {
        const init = items.length;
        addItem("counter", cc.x, cc.y, cc.w, cc.d, 0, cc.wall);
        if (items.length > init) {
          placedCounter = cc;
          break;
        }
      }
    }
    if (placedCounter) {
      if (placedCounter.isHoriz) {
        const stoveX = placedCounter.x + 200;
        const sinkX = placedCounter.x + Math.min(placedCounter.w - 700, 1e3);
        const ovenX = placedCounter.x + Math.min(placedCounter.w - 600, 1800);
        addItem("stove", stoveX, placedCounter.y, 600, 600, 0, "NORTH");
        addItem("sink", sinkX, placedCounter.y, 600, 500, 0, "NORTH");
        addItem("oven", ovenX, placedCounter.y, 600, 600, 0, "NORTH");
      } else {
        const stoveY = placedCounter.y + 200;
        const sinkY = placedCounter.y + Math.min(placedCounter.d - 700, 1e3);
        const ovenY = placedCounter.y + Math.min(placedCounter.d - 600, 1800);
        addItem("stove", placedCounter.x, stoveY, 600, 600, 0, "WEST");
        addItem("sink", placedCounter.x, sinkY, 500, 600, 0, "WEST");
        addItem("oven", placedCounter.x, ovenY, 600, 600, 0, "WEST");
      }
    }
    addItem("fridge", rx + rw - 850, ry + 150, 700, 700, 0, "EAST");
  } else if (room.type === RoomType.Balcony || rName.includes("UTILITY") || rName.includes("BALCONY")) {
  } else if (room.type === RoomType.Bathroom || rName.includes("BATH") || rName.includes("TOILET") || rName.includes("WC")) {
    const wcCandidates = [
      { x: rx + 200, y: ry + 200, w: 400, d: 700, wall: "NORTH" },
      { x: rx + rw - 600, y: ry + 200, w: 400, d: 700, wall: "NORTH" },
      { x: rx + 200, y: ry + rh - 900, w: 400, d: 700, wall: "SOUTH" },
      { x: rx + rw - 600, y: ry + rh - 900, w: 400, d: 700, wall: "SOUTH" },
      { x: rx + 200, y: ry + (rh - 700) / 2, w: 400, d: 700, wall: "WEST" },
      { x: rx + rw - 600, y: ry + (rh - 700) / 2, w: 400, d: 700, wall: "EAST" }
    ];
    for (const wc of wcCandidates) {
      if (rw >= wc.w + 100 && rh >= wc.d + 100) {
        const init = items.length;
        addItem("toilet", wc.x, wc.y, wc.w, wc.d, 0, wc.wall);
        if (items.length > init) break;
      }
    }
    const sinkCandidates = [
      { x: rx + 750, y: ry + 200, w: 450, d: 350, wall: "NORTH" },
      { x: rx + 200, y: ry + 800, w: 350, d: 450, wall: "WEST" },
      { x: rx + rw - 700, y: ry + 200, w: 500, d: 400, wall: "NORTH" },
      { x: rx + rw - 700, y: ry + rh - 600, w: 500, d: 400, wall: "SOUTH" },
      { x: rx + rw - 600, y: ry + (rh - 400) / 2, w: 500, d: 400, wall: "EAST" }
    ];
    for (const sc of sinkCandidates) {
      if (rw >= sc.w + 100 && rh >= sc.d + 100) {
        const init = items.length;
        addItem("sink", sc.x, sc.y, sc.w, sc.d, 0, sc.wall);
        if (items.length > init) break;
      }
    }
    const is4BhkMasterBath = (rName.includes("MASTER") || rName.includes("ATTACHED")) && areaM2 >= 4.5;
    if (is4BhkMasterBath) {
      if (rw >= 2e3) {
        addItem("bathtub", rx + 200, ry + rh - 850, 1700, 700, 0, "SOUTH");
      } else if (rh >= 2e3) {
        addItem("bathtub", rx + 200, ry + 200, 700, 1700, 90, "WEST");
      }
      if (rw >= 2400) {
        addItem("shower", rx + rw - 1e3, ry + rh - 1e3, 900, 900, 0, "SOUTH");
      }
    }
    if (!items.some((i) => i.roomId === room.id && (i.type === "shower" || i.type === "bathtub"))) {
      const showerCandidates = [
        { x: rx + rw - 1e3, y: ry + rh - 1e3, w: 900, d: 900, wall: "SOUTH" },
        { x: rx + 200, y: ry + rh - 1e3, w: 900, d: 900, wall: "SOUTH" },
        { x: rx + rw - 1e3, y: ry + 200, w: 900, d: 900, wall: "NORTH" },
        { x: rx + 200, y: ry + 200, w: 900, d: 900, wall: "NORTH" },
        { x: rx + rw - 850, y: ry + rh - 850, w: 800, d: 800, wall: "SOUTH" },
        { x: rx + 150, y: ry + rh - 850, w: 800, d: 800, wall: "SOUTH" },
        { x: rx + rw - 850, y: ry + 150, w: 800, d: 800, wall: "NORTH" },
        { x: rx + 150, y: ry + 150, w: 800, d: 800, wall: "NORTH" }
      ];
      for (const sh of showerCandidates) {
        if (rw >= sh.w + 100 && rh >= sh.d + 100) {
          const init = items.length;
          addItem("shower", sh.x, sh.y, sh.w, sh.d, 0, sh.wall);
          if (items.length > init) break;
        }
      }
      if (!items.some((i) => i.roomId === room.id && (i.type === "shower" || i.type === "bathtub"))) {
        const shX = Math.max(innerMinX, innerMaxX - 800);
        const shY = Math.max(innerMinY, innerMaxY - 800);
        addItem("shower", shX, shY, 800, 800, 0, "SOUTH", true);
      }
    }
  } else if (!room.architecturalRole && (room.type === RoomType.Staircase || rName.includes("STAIR"))) {
    const stairW = Math.min(1200, rw - 400);
    const stairL = Math.min(3e3, rh - 400);
    if (stairW >= 800 && stairL >= 1800) {
      addItem(
        "staircase",
        rx + (rw - stairW) / 2,
        ry + (rh - stairL) / 2,
        stairW,
        stairL,
        0,
        "CENTER",
        true
        // allow in stair core
      );
    }
  } else if (room.type === RoomType.Parking || rName.includes("PARK")) {
    const carW = 1800;
    const carL = 4200;
    if (rw >= 2200 && rh >= 4500) {
      addItem(
        "car",
        rx + (rw - carW) / 2,
        ry + (rh - carL) / 2,
        carW,
        carL,
        0,
        "CENTER",
        true
      );
    }
  }
  return items;
}
function furnishSiteParkingZones(siteOrZones) {
  const siteZones = Array.isArray(siteOrZones) ? siteOrZones : siteOrZones && "siteZones" in siteOrZones && siteOrZones.siteZones ? siteOrZones.siteZones : [];
  const items = [];
  for (const zone of siteZones) {
    if (zone.kind !== "parking") continue;
    const pts = zone.boundary.points;
    if (pts.length < 4) continue;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = maxX - minX;
    const height = maxY - minY;
    const carW = 1800;
    const carL = 4400;
    if (width >= height) {
      const stallCount = Math.max(1, Math.floor(width / 2500));
      const stallW = width / stallCount;
      for (let i = 0; i < stallCount; i++) {
        const sx = minX + i * stallW;
        items.push({
          id: `${zone.id}__furn_car_${i + 1}`,
          type: "car",
          roomId: zone.id,
          siteZoneId: zone.id,
          xMm: Math.round(sx + (stallW - carW) / 2),
          yMm: Math.round(minY + (height - carL) / 2),
          widthMm: carW,
          depthMm: carL,
          rotationDeg: 0,
          anchorWall: "CENTER",
          layer: "A-FURN"
        });
      }
    } else {
      const stallCount = Math.max(1, Math.floor(height / 5e3));
      const stallH = height / stallCount;
      for (let i = 0; i < stallCount; i++) {
        const sy = minY + i * stallH;
        items.push({
          id: `${zone.id}__furn_car_${i + 1}`,
          type: "car",
          roomId: zone.id,
          siteZoneId: zone.id,
          xMm: Math.round(minX + (width - carW) / 2),
          yMm: Math.round(sy + (stallH - carL) / 2),
          widthMm: carW,
          depthMm: carL,
          rotationDeg: 0,
          anchorWall: "CENTER",
          layer: "A-FURN"
        });
      }
    }
  }
  return items;
}
function populateCanonicalFurniture(building, manifest) {
  const updatedFloors = building.floors.map((floor) => {
    const existing = Array.isArray(floor.furniture) ? floor.furniture : [];
    const newItems = [];
    for (const room of floor.rooms) {
      const roomItems = furnishRoom(room, floor, manifest);
      newItems.push(...roomItems);
    }
    const combined = [...existing];
    for (const item of newItems) {
      const isDupe = combined.some(
        (e) => e.type === item.type && Math.hypot(e.xMm - item.xMm, e.yMm - item.yMm) < 200
      );
      if (!isDupe) combined.push(item);
    }
    return {
      ...floor,
      furniture: combined
    };
  });
  const siteParkingCars = building.site?.siteZones ? furnishSiteParkingZones(building.site.siteZones) : [];
  const buildingFurniture = [
    ...updatedFloors.flatMap((f) => f.furniture ?? []),
    ...siteParkingCars
  ];
  return {
    ...building,
    floors: updatedFloors,
    furniture: buildingFurniture
  };
}

// packages/planning-engine/src/interpretation/space-filling-snapper.ts
var SNAP_INC2 = 10;
var snap102 = (v) => Math.round(v / SNAP_INC2) * SNAP_INC2;
function createConnectingDoor(id, roomA, roomB, width = 900, options) {
  const aRect = "width" in roomA.rect ? roomA.rect : { x: roomA.rect.x, y: roomA.rect.y, width: roomA.rect.w, height: roomA.rect.h };
  const bRect = "width" in roomB.rect ? roomB.rect : { x: roomB.rect.x, y: roomB.rect.y, width: roomB.rect.w, height: roomB.rect.h };
  const loX = Math.max(aRect.x, bRect.x);
  const hiX = Math.min(aRect.x + aRect.width, bRect.x + bRect.width);
  const loY = Math.max(aRect.y, bRect.y);
  const hiY = Math.min(aRect.y + aRect.height, bRect.y + bRect.height);
  const touchesHoriz = Math.abs(aRect.y + aRect.height - bRect.y) <= 1 || Math.abs(bRect.y + bRect.height - aRect.y) <= 1;
  const sharedXLen = hiX - loX;
  const effectiveHorizWidth = sharedXLen >= width + 200 ? width : width >= 1050 && sharedXLen >= 1200 ? 1e3 : width >= 1050 && sharedXLen >= 1e3 ? 900 : width >= 900 && sharedXLen >= 1e3 ? 800 : width < 900 && width >= 750 && sharedXLen >= 900 ? 700 : width;
  const isRoomBBath = /bath|toilet|wc|dress/i.test(roomB.id);
  const isRoomABath = /bath|toilet|wc|dress/i.test(roomA.id);
  const targetBathId = isRoomBBath ? roomB.id : isRoomABath ? roomA.id : void 0;
  const cornerNib = options?.isFlatEntrance ? 100 : 150;
  const reqMargin = options?.isFlatEntrance ? 100 : 200;
  if (touchesHoriz && sharedXLen >= effectiveHorizWidth + reqMargin) {
    const sharedY = Math.abs(aRect.y + aRect.height - bRect.y) <= 1 ? aRect.y + aRect.height : bRect.y + bRect.height;
    const doorX = options?.doorType === "open_passage" && effectiveHorizWidth >= 1200 ? snap102((loX + hiX - effectiveHorizWidth) / 2) : options?.anchorSide === "end" ? Math.max(loX + 50, Math.min(hiX - 50 - effectiveHorizWidth, snap102(hiX - cornerNib - effectiveHorizWidth))) : Math.max(loX + 50, Math.min(hiX - 50 - effectiveHorizWidth, snap102(loX + cornerNib)));
    return {
      id,
      kind: "door",
      doorType: options?.doorType ?? "single",
      swingDirection: targetBathId ? "inward" : options?.swingDirection ?? "inward",
      isFlatEntrance: options?.isFlatEntrance,
      adjacentRoomId: targetBathId ?? roomB.id,
      connects: [roomA.id, roomB.id],
      rect: {
        x: doorX,
        y: snap102(sharedY - 50),
        width: effectiveHorizWidth,
        height: 100
      }
    };
  }
  const touchesVert = Math.abs(aRect.x + aRect.width - bRect.x) <= 1 || Math.abs(bRect.x + bRect.width - aRect.x) <= 1;
  const sharedYLen = hiY - loY;
  const effectiveVertWidth = sharedYLen >= width + 200 ? width : width >= 1050 && sharedYLen >= 1200 ? 1e3 : width >= 1050 && sharedYLen >= 1e3 ? 900 : width >= 900 && sharedYLen >= 1e3 ? 800 : width < 900 && width >= 750 && sharedYLen >= 900 ? 700 : width;
  if (touchesVert && sharedYLen >= effectiveVertWidth + reqMargin) {
    const sharedX = Math.abs(aRect.x + aRect.width - bRect.x) <= 1 ? aRect.x + aRect.width : bRect.x + bRect.width;
    const doorY = options?.doorType === "open_passage" && effectiveVertWidth >= 1200 ? snap102((loY + hiY - effectiveVertWidth) / 2) : options?.anchorSide === "end" ? Math.max(loY + 50, Math.min(hiY - 50 - effectiveVertWidth, snap102(hiY - cornerNib - effectiveVertWidth))) : Math.max(loY + 50, Math.min(hiY - 50 - effectiveVertWidth, snap102(loY + cornerNib)));
    return {
      id,
      kind: "door",
      doorType: options?.doorType ?? "single",
      swingDirection: targetBathId ? "inward" : options?.swingDirection ?? "inward",
      isFlatEntrance: options?.isFlatEntrance,
      adjacentRoomId: targetBathId ?? roomB.id,
      connects: [roomA.id, roomB.id],
      rect: {
        x: snap102(sharedX - 50),
        y: doorY,
        width: 100,
        height: effectiveVertWidth
      }
    };
  }
  return null;
}
function solveOrthogonalSpaceFillingApartment(params) {
  const { plan, site, frame, manifest } = params;
  const toMm = (v) => v < 150 ? Math.round(v * 1e3) : Math.round(v);
  const plotWidthMm = toMm(site.plotWidth);
  const plotDepthMm = toMm(site.plotDepth);
  const lotMode = params.lotAllotmentMode ?? manifest?.lotAllotmentMode ?? site.lotAllotmentMode ?? "FULL_LOT_100_PERCENT";
  let envelope;
  if (lotMode === "FULL_LOT_100_PERCENT") {
    envelope = {
      x: 0,
      y: 0,
      w: plotWidthMm,
      h: plotDepthMm
    };
  } else {
    const sb = site.setbacks ?? { front: 3e3, rear: 2e3, left: 2e3, right: 2e3 };
    const left = toMm(sb.left);
    const rear = toMm(sb.rear);
    const front = toMm(sb.front);
    const right = toMm(sb.right);
    envelope = {
      x: left,
      y: rear,
      w: Math.max(12e3, plotWidthMm - left - right),
      h: Math.max(12e3, plotDepthMm - rear - front)
    };
  }
  const rawFlats = plan.flats && plan.flats.length > 0 ? plan.flats : synthesizeFlats(manifest, frame);
  const flatCount = Math.max(2, Math.min(4, rawFlats.length));
  const flatConfigs = matchFlatTopology(rawFlats, flatCount, manifest);
  const { flatBoxes, corridorBox, lobbyBox, liftBoxes, stairBoxes, shaftBoxes, corridorIsEastForFlat } = partitionMacroFootprint(envelope, flatCount);
  const flats = [];
  const openings = [];
  for (let i = 0; i < flatConfigs.length; i++) {
    const cfg = flatConfigs[i];
    const box = flatBoxes[i];
    const rawRooms = plan.rooms.filter((r) => r.flatId === cfg.id);
    const { rooms, flatOpenings } = sliceFlatRooms({
      flatId: cfg.id,
      flatLabel: cfg.label,
      unitType: cfg.unitType,
      box,
      corridorIsEast: corridorIsEastForFlat[i] ?? true,
      rawRooms,
      corridorBox,
      envelope
    });
    flats.push({
      id: cfg.id,
      label: cfg.label,
      unitType: cfg.unitType,
      rect: { x: box.x, y: box.y, width: box.w, height: box.h },
      rooms
    });
    openings.push(...flatOpenings);
  }
  if (stairBoxes[0]) {
    const dStair1 = createConnectingDoor("door_stair_1", { id: "core_lobby", rect: lobbyBox }, { id: "core_stair_1", rect: stairBoxes[0] }, 1200, { doorType: "open_passage" });
    if (dStair1) openings.push(dStair1);
  }
  for (let l = 0; l < liftBoxes.length; l++) {
    const lift = liftBoxes[l];
    const dLift = createConnectingDoor(`door_lift_${l + 1}`, { id: "core_lobby", rect: lobbyBox }, { id: `core_lift_${l + 1}`, rect: lift }, 900, { doorType: "sliding" });
    if (dLift) openings.push(dLift);
  }
  const dLobbyCorr = createConnectingDoor("door_lobby_corridor", { id: "core_lobby", rect: lobbyBox }, { id: "corridor_1", rect: corridorBox }, 1500, { doorType: "open_passage" });
  if (dLobbyCorr) openings.push(dLobbyCorr);
  if (stairBoxes[1]) {
    const dStair2 = createConnectingDoor("door_stair_2", { id: "corridor_1", rect: corridorBox }, { id: "core_stair_2", rect: stairBoxes[1] }, 1200, { doorType: "open_passage" });
    if (dStair2) openings.push(dStair2);
  }
  const lifts = liftBoxes.map((b, i) => ({
    id: `core_lift_${i + 1}`,
    name: `Passenger Lift 0${i + 1}`,
    rect: { x: b.x, y: b.y, width: b.w, height: b.h },
    assignedFlatId: null
  }));
  const stairs = stairBoxes.map((b, i) => ({
    id: `core_stair_${i + 1}`,
    name: i === 0 ? "Main Fire Staircase" : "Secondary Fire Staircase",
    rect: { x: b.x, y: b.y, width: b.w, height: b.h },
    assignedFlatId: null
  }));
  const lobbies = [
    {
      id: "core_lobby",
      name: "Common Lift Lobby",
      rect: { x: lobbyBox.x, y: lobbyBox.y, width: lobbyBox.w, height: lobbyBox.h },
      assignedFlatId: null
    }
  ];
  const corridors = [
    {
      id: "corridor_1",
      name: "Common Circulation Spine",
      rect: { x: corridorBox.x, y: corridorBox.y, width: corridorBox.w, height: corridorBox.h },
      assignedFlatId: null
    }
  ];
  const shafts = shaftBoxes.map((b, i) => ({
    id: `core_shaft_${i + 1}`,
    architecturalRole: b.w >= 3500 && b.h >= 3500 ? "OPEN_TO_SKY_VOID" : "SERVICE_SHAFT",
    name: b.w >= 3500 && b.h >= 3500 ? "Internal Open-to-Sky (OTS) Central Courtyard / Atrium" : `MEP / Plumbing Duct 0${i + 1}`,
    rect: { x: b.x, y: b.y, width: b.w, height: b.h },
    assignedFlatId: null
  }));
  const boundary = [
    { x: envelope.x, y: envelope.y },
    { x: envelope.x + envelope.w, y: envelope.y },
    { x: envelope.x + envelope.w, y: envelope.y + envelope.h },
    { x: envelope.x, y: envelope.y + envelope.h }
  ];
  return {
    source: "IMAGE_INTERPRETATION",
    boundary,
    flats,
    commonRooms: [],
    ungroupedRooms: [],
    lifts,
    stairs,
    lobbies,
    corridors,
    shafts,
    openings
  };
}
function synthesizeFlats(manifest, frame) {
  const count = manifest?.flatsPerFloor ?? 2;
  const list = [];
  for (let i = 0; i < count; i++) {
    const spec = manifest?.units[i];
    const type = spec?.bhkType ?? "3BHK";
    list.push({
      id: `flat_0${i + 1}`,
      label: `Flat 0${i + 1}`,
      unitType: type,
      imageX: frame.width / count * i,
      imageY: 0,
      imageWidth: frame.width / count,
      imageHeight: frame.height
    });
  }
  return list;
}
function matchFlatTopology(rawFlats, count, manifest) {
  const configs = [];
  for (let i = 0; i < count; i++) {
    const raw = rawFlats[i];
    const manifestUnit = manifest?.units[i];
    const rawType = raw?.unitType?.toUpperCase().replace(/\s+/g, "") ?? "";
    const normType = manifestUnit?.bhkType ?? (rawType.includes("4BHK") ? "4BHK" : rawType.includes("3BHK") ? "3BHK" : rawType.includes("2BHK") ? "2BHK" : rawType.includes("1BHK") ? "1BHK" : "3BHK");
    configs.push({
      id: raw?.id ?? `flat_0${i + 1}`,
      label: raw?.label ?? `Flat 0${i + 1}`,
      unitType: normType,
      imageX: raw?.imageX ?? 1e3 / count * i,
      imageY: raw?.imageY ?? 0,
      imageWidth: raw?.imageWidth ?? 1e3 / count,
      imageHeight: raw?.imageHeight ?? 1e3
    });
  }
  return configs;
}
function partitionMacroFootprint(env, count) {
  const flatBoxes = [];
  const corridorIsEastForFlat = [];
  let coreW;
  let leftW;
  let rightW;
  if (env.w >= 36e3) {
    leftW = snap102(Math.min(15e3, env.w * 0.3));
    rightW = leftW;
    coreW = env.w - leftW - rightW;
  } else if (env.w < 2e4) {
    coreW = snap102(Math.max(3600, Math.min(4500, env.w * 0.24)));
    const coreXTemp = snap102(env.x + (env.w - coreW) / 2);
    leftW = coreXTemp - env.x;
    rightW = env.x + env.w - (coreXTemp + coreW);
  } else {
    coreW = snap102(Math.max(4500, Math.min(6500, env.w * 0.2)));
    const coreXTemp = snap102(env.x + (env.w - coreW) / 2);
    leftW = coreXTemp - env.x;
    rightW = env.x + env.w - (coreXTemp + coreW);
  }
  const coreX = env.x + leftW;
  const splitY = snap102(env.y + env.h * 0.5);
  const coreBox = { x: coreX, y: env.y, w: coreW, h: env.h };
  const defaultCorrH = 2400;
  const defaultCorrY = snap102(splitY - defaultCorrH / 2);
  if (count === 2) {
    flatBoxes.push({ x: env.x, y: env.y, w: leftW, h: env.h });
    corridorIsEastForFlat.push(true);
    flatBoxes.push({ x: coreX + coreW, y: env.y, w: rightW, h: env.h });
    corridorIsEastForFlat.push(false);
    const { corridorBox: corridorBox2, lobbyBox: lobbyBox2, liftBoxes: liftBoxes2, stairBoxes: stairBoxes2, shaftBoxes: shaftBoxes2 } = partitionCore(coreBox, { corrY: defaultCorrY, corrH: defaultCorrH });
    return { coreBox, flatBoxes, corridorBox: corridorBox2, lobbyBox: lobbyBox2, liftBoxes: liftBoxes2, stairBoxes: stairBoxes2, shaftBoxes: shaftBoxes2, shaftRoles: shaftBoxes2.map((b) => b.w >= 3500 && b.h >= 3500 ? "OPEN_TO_SKY_VOID" : "SERVICE_SHAFT"), corridorIsEastForFlat };
  }
  if (count === 3) {
    flatBoxes.push({ x: env.x, y: env.y, w: leftW, h: env.h });
    corridorIsEastForFlat.push(true);
    flatBoxes.push({ x: coreX + coreW, y: env.y, w: rightW, h: splitY - env.y });
    corridorIsEastForFlat.push(false);
    flatBoxes.push({ x: coreX + coreW, y: splitY, w: rightW, h: env.y + env.h - splitY });
    corridorIsEastForFlat.push(false);
    const { corridorBox: corridorBox2, lobbyBox: lobbyBox2, liftBoxes: liftBoxes2, stairBoxes: stairBoxes2, shaftBoxes: shaftBoxes2 } = partitionCore(coreBox, { corrY: defaultCorrY, corrH: defaultCorrH });
    return { coreBox, flatBoxes, corridorBox: corridorBox2, lobbyBox: lobbyBox2, liftBoxes: liftBoxes2, stairBoxes: stairBoxes2, shaftBoxes: shaftBoxes2, shaftRoles: shaftBoxes2.map((b) => b.w >= 3500 && b.h >= 3500 ? "OPEN_TO_SKY_VOID" : "SERVICE_SHAFT"), corridorIsEastForFlat };
  }
  flatBoxes.push({ x: env.x, y: env.y, w: leftW, h: splitY - env.y });
  corridorIsEastForFlat.push(true);
  flatBoxes.push({ x: coreX + coreW, y: env.y, w: rightW, h: splitY - env.y });
  corridorIsEastForFlat.push(false);
  flatBoxes.push({ x: env.x, y: splitY, w: leftW, h: env.y + env.h - splitY });
  corridorIsEastForFlat.push(true);
  flatBoxes.push({ x: coreX + coreW, y: splitY, w: rightW, h: env.y + env.h - splitY });
  corridorIsEastForFlat.push(false);
  const { corridorBox, lobbyBox, liftBoxes, stairBoxes, shaftBoxes } = partitionCore(coreBox, { corrY: defaultCorrY, corrH: defaultCorrH });
  return { coreBox, flatBoxes, corridorBox, lobbyBox, liftBoxes, stairBoxes, shaftBoxes, shaftRoles: shaftBoxes.map((b) => b.w >= 3500 && b.h >= 3500 ? "OPEN_TO_SKY_VOID" : "SERVICE_SHAFT"), corridorIsEastForFlat };
}
function partitionCore(core, options) {
  const stair1H = core.h < 18e3 ? 3200 : 4500;
  const corrH = Math.min(2400, Math.max(1800, snap102(options?.corrH ?? 2400)));
  const minLiftBandH = 4e3;
  let corrY = snap102(options?.corrY ?? core.y + (core.h - corrH) / 2);
  if (corrY < core.y + stair1H + minLiftBandH) {
    corrY = core.y + stair1H + minLiftBandH;
  }
  const stair1Box = { x: core.x, y: core.y, w: core.w, h: stair1H };
  const topRemH = corrY - (core.y + stair1H);
  const liftW = Math.min(3e3, snap102(core.w * 0.4));
  const lobbyW = core.w - liftW;
  const liftH = snap102(topRemH / 2);
  const lift1Box = { x: core.x, y: core.y + stair1H, w: liftW, h: liftH };
  const lift2Box = { x: core.x, y: core.y + stair1H + liftH, w: liftW, h: topRemH - liftH };
  const lobbyBox = { x: core.x + liftW, y: core.y + stair1H, w: lobbyW, h: topRemH };
  const corridorBox = { x: core.x, y: corrY, w: core.w, h: corrH };
  const remBelow = core.y + core.h - (corrY + corrH);
  const stair2H = core.h < 18e3 ? Math.min(3200, Math.max(2800, remBelow - 500)) : 4500;
  const stair2Box = { x: core.x, y: corrY + corrH, w: core.w, h: Math.min(stair2H, Math.max(0, remBelow)) };
  const shaftY = corrY + corrH + stair2Box.h;
  const remShaftH = core.y + core.h - shaftY;
  const shaftBoxes = [];
  if (remShaftH > 0) {
    if (core.w >= 1e4 && remShaftH >= 8e3) {
      const mepW = 3e3;
      shaftBoxes.push(
        { x: core.x, y: shaftY, w: mepW, h: remShaftH },
        { x: core.x + mepW, y: shaftY, w: core.w - mepW, h: remShaftH }
      );
    } else {
      shaftBoxes.push({ x: core.x, y: shaftY, w: core.w, h: remShaftH });
    }
  }
  const liftBoxes = [lift1Box, lift2Box];
  const stairBoxes = [stair1Box, stair2Box];
  return { corridorBox, lobbyBox, liftBoxes, stairBoxes, shaftBoxes, shaftRoles: shaftBoxes.map((b) => b.w >= 3500 && b.h >= 3500 ? "OPEN_TO_SKY_VOID" : "SERVICE_SHAFT") };
}
function sliceFlatRooms(params) {
  const { flatId, flatLabel, unitType, box, corridorIsEast, corridorBox, envelope, rawRooms = [] } = params;
  const rooms = [];
  const flatOpenings = [];
  let livingZoneW;
  let bedZoneW;
  if (box.w < 6500) {
    livingZoneW = snap102(Math.max(3100, Math.min(box.w - 2600, box.w * 0.53)));
    bedZoneW = box.w - livingZoneW;
  } else {
    livingZoneW = snap102(Math.min(6500, Math.max(3600, box.w * 0.5)));
    bedZoneW = box.w - livingZoneW;
    if (bedZoneW < 3600 && box.w >= 7200) {
      bedZoneW = 3600;
      livingZoneW = box.w - bedZoneW;
    }
  }
  const livingZoneX = corridorIsEast ? box.x + bedZoneW : box.x;
  const bedZoneX = corridorIsEast ? box.x : box.x + livingZoneW;
  const isSouth = box.y > envelope.y + 100;
  const livW = Math.max(1500, snap102(livingZoneW - Math.min(2600, Math.max(1600, livingZoneW * 0.48))));
  const kitchW = livingZoneW - livW;
  const livX = corridorIsEast ? livingZoneX + kitchW : livingZoneX;
  const kitchX = corridorIsEast ? livingZoneX : livingZoneX + livW;
  const utilDepth = 1430;
  const serviceDepth = box.h > 15e3 ? Math.max(5500, snap102(55e5 / livW)) : snap102(Math.min(box.h * 0.35, Math.max(3e3, 45e5 / livW)));
  const serviceY = isSouth ? box.y + box.h - serviceDepth : box.y;
  const utilityRoom = {
    id: `${flatId}__utility`,
    name: `${flatLabel} Kitchen Utility Balcony`,
    type: "utility",
    planningZone: "OUTDOOR",
    rect: { x: kitchX, y: isSouth ? box.y + box.h - utilDepth : box.y, width: kitchW, height: utilDepth }
  };
  const kitchenRoom = {
    id: `${flatId}__kitchen`,
    name: `${flatLabel} Kitchen`,
    type: "kitchen",
    planningZone: "SERVICE",
    rect: { x: kitchX, y: isSouth ? serviceY : box.y + utilDepth, width: kitchW, height: serviceDepth - utilDepth }
  };
  const balconyRoom = {
    id: `${flatId}__balcony`,
    name: `${flatLabel} Sit-out Balcony`,
    type: "balcony",
    planningZone: "OUTDOOR",
    rect: { x: livX, y: serviceY, width: livW, height: serviceDepth }
  };
  const remLivH = box.h - serviceDepth;
  let livingRoom;
  let diningRoom;
  if (remLivH > 7500) {
    const livH = snap102(Math.min(6500, Math.max(5e3, remLivH * 0.44)));
    const dinH = remLivH - livH;
    if (!isSouth) {
      livingRoom = {
        id: `${flatId}__living`,
        name: `${flatLabel} Living Room`,
        type: "living",
        planningZone: "PUBLIC",
        rect: { x: livingZoneX, y: box.y + serviceDepth, width: livingZoneW, height: livH }
      };
      diningRoom = {
        id: `${flatId}__dining`,
        name: `${flatLabel} Dining & Family Hall`,
        type: "dining",
        planningZone: "PUBLIC",
        rect: { x: livingZoneX, y: box.y + serviceDepth + livH, width: livingZoneW, height: dinH }
      };
    } else {
      diningRoom = {
        id: `${flatId}__dining`,
        name: `${flatLabel} Dining & Family Hall`,
        type: "dining",
        planningZone: "PUBLIC",
        rect: { x: livingZoneX, y: box.y, width: livingZoneW, height: dinH }
      };
      livingRoom = {
        id: `${flatId}__living`,
        name: `${flatLabel} Living Room`,
        type: "living",
        planningZone: "PUBLIC",
        rect: { x: livingZoneX, y: box.y + dinH, width: livingZoneW, height: livH }
      };
    }
    rooms.push(utilityRoom, kitchenRoom, balconyRoom, livingRoom, diningRoom);
    const dLivDin = createConnectingDoor(`${flatId}__door_living_dining`, livingRoom, diningRoom, 1200, { doorType: "open_passage" });
    if (dLivDin) flatOpenings.push(dLivDin);
  } else {
    livingRoom = {
      id: `${flatId}__living`,
      name: `${flatLabel} Living & Dining Room`,
      type: "living",
      planningZone: "PUBLIC",
      rect: { x: livingZoneX, y: isSouth ? box.y : box.y + serviceDepth, width: livingZoneW, height: remLivH }
    };
    rooms.push(utilityRoom, kitchenRoom, balconyRoom, livingRoom);
  }
  for (const [id, from, to, width, doorType] of [
    ["balcony", livingRoom, balconyRoom, 900, "sliding"],
    ["kitchen", livingRoom, kitchenRoom, 900, "single"],
    ["utility", kitchenRoom, utilityRoom, 750, "single"]
  ]) {
    const door = createConnectingDoor(`${flatId}__door_${id}`, from, to, width, { doorType });
    if (door) flatOpenings.push(door);
  }
  const livOverlap = Math.max(0, Math.min(corridorBox.y + corridorBox.h, livingRoom.rect.y + livingRoom.rect.height) - Math.max(corridorBox.y, livingRoom.rect.y));
  const dinOverlap = diningRoom ? Math.max(0, Math.min(corridorBox.y + corridorBox.h, diningRoom.rect.y + diningRoom.rect.height) - Math.max(corridorBox.y, diningRoom.rect.y)) : 0;
  const entranceTarget = dinOverlap > livOverlap && dinOverlap >= 1e3 ? diningRoom : livOverlap >= 1e3 ? livingRoom : dinOverlap > livOverlap ? diningRoom ?? livingRoom : livingRoom;
  let dEntrance = createConnectingDoor(
    `${flatId}__door_entrance`,
    { id: "corridor_1", rect: corridorBox },
    entranceTarget,
    1050,
    { isFlatEntrance: true }
  );
  if (!dEntrance && diningRoom) {
    const fallbackTarget = entranceTarget === livingRoom ? diningRoom : livingRoom;
    dEntrance = createConnectingDoor(
      `${flatId}__door_entrance`,
      { id: "corridor_1", rect: corridorBox },
      fallbackTarget,
      1050,
      { isFlatEntrance: true }
    );
  }
  if (dEntrance) flatOpenings.push(dEntrance);
  const maxBedH = snap102(bedZoneW * 1.3);
  const minBedH = 3e3;
  if (unitType === "1BHK") {
    const bathH = 1800;
    const availH = box.h - bathH;
    const masterBedH = Math.min(maxBedH, Math.max(minBedH, snap102(availH * 0.7)));
    const passH = box.h - (masterBedH + bathH);
    let bY = box.y;
    let masterBed;
    let commonBath;
    if (!isSouth) {
      masterBed = {
        id: `${flatId}__master_bed`,
        name: `${flatLabel} Master Bedroom`,
        type: "bedroom",
        planningZone: "PRIVATE",
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: masterBedH }
      };
      rooms.push(masterBed);
      bY += masterBedH;
      if (passH > 0) {
        const passage = {
          id: `${flatId}__internal_passage`,
          name: `${flatLabel} Internal Passage`,
          type: "corridor",
          planningZone: "SERVICE",
          rect: { x: bedZoneX, y: bY, width: bedZoneW, height: passH }
        };
        rooms.push(passage);
        bY += passH;
        const dPass = createConnectingDoor(`${flatId}__door_passage`, livingRoom, passage, 900, { doorType: "open_passage" });
        if (dPass) flatOpenings.push(dPass);
      }
      commonBath = {
        id: `${flatId}__common_bath`,
        name: `${flatLabel} Master Bathroom`,
        type: "bathroom",
        planningZone: "SERVICE",
        bathroomOwnerRoomId: masterBed.id,
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: bathH }
      };
      rooms.push(commonBath);
    } else {
      if (passH > 0) {
        const passage = {
          id: `${flatId}__internal_passage`,
          name: `${flatLabel} Internal Passage`,
          type: "corridor",
          planningZone: "SERVICE",
          rect: { x: bedZoneX, y: bY, width: bedZoneW, height: passH }
        };
        rooms.push(passage);
        bY += passH;
        const dPass = createConnectingDoor(`${flatId}__door_passage`, livingRoom, passage, 900, { doorType: "open_passage" });
        if (dPass) flatOpenings.push(dPass);
      }
      commonBath = {
        id: `${flatId}__common_bath`,
        name: `${flatLabel} Master Bathroom`,
        type: "bathroom",
        planningZone: "SERVICE",
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: bathH }
      };
      rooms.push(commonBath);
      bY += bathH;
      masterBed = {
        id: `${flatId}__master_bed`,
        name: `${flatLabel} Master Bedroom`,
        type: "bedroom",
        planningZone: "PRIVATE",
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: masterBedH }
      };
      rooms.push(masterBed);
    }
    const dMaster = createConnectingDoor(`${flatId}__door_master_bed`, livingRoom, masterBed, 900);
    if (dMaster) flatOpenings.push(dMaster);
    const dBath = createConnectingDoor(`${flatId}__door_common_bath`, masterBed, commonBath, 750);
    if (dBath) flatOpenings.push(dBath);
  } else if (unitType === "2BHK") {
    const bathH = snap102(Math.min(2200, Math.max(1800, box.h * 0.09)));
    const passH = snap102(Math.min(1500, Math.max(1200, box.h * 0.06)));
    const availBedH = box.h - bathH - passH;
    let masterBedH;
    let bed2H;
    let studyH = 0;
    let poojaH = 0;
    const hasStudyRequested = rawRooms.some((r) => r.type === "study" || r.type === "office" || r.name.toLowerCase().includes("study"));
    const hasPoojaRequested = rawRooms.some((r) => r.type === "pooja" || r.name.toLowerCase().includes("pooja") || r.name.toLowerCase().includes("mandir"));
    if (hasStudyRequested && hasPoojaRequested && availBedH >= 7600) {
      masterBedH = snap102(Math.min(4800, Math.max(3600, availBedH * 0.28)));
      bed2H = snap102(Math.min(4200, Math.max(3400, availBedH * 0.25)));
      const rawExcessH = availBedH - (masterBedH + bed2H);
      studyH = snap102(Math.min(3200, Math.max(2400, rawExcessH * 0.45)));
      poojaH = rawExcessH - studyH;
    } else if (hasStudyRequested && availBedH >= 7600) {
      masterBedH = snap102(Math.min(4800, Math.max(3600, availBedH * 0.35)));
      bed2H = snap102(Math.min(4200, Math.max(3400, availBedH * 0.3)));
      studyH = availBedH - (masterBedH + bed2H);
    } else if (hasPoojaRequested && availBedH >= 7600) {
      masterBedH = snap102(Math.min(4800, Math.max(3600, availBedH * 0.38)));
      bed2H = snap102(Math.min(4200, Math.max(3400, availBedH * 0.34)));
      poojaH = availBedH - (masterBedH + bed2H);
    } else {
      masterBedH = snap102(availBedH * 0.54);
      bed2H = availBedH - masterBedH;
    }
    const bath1W = snap102(bedZoneW * 0.5);
    const bath2W = bedZoneW - bath1W;
    const commonBathX = corridorIsEast ? bedZoneX + bath1W : bedZoneX;
    const masterBathX = corridorIsEast ? bedZoneX : bedZoneX + bath2W;
    let bY = box.y;
    const masterBed = {
      id: `${flatId}__master_bed`,
      name: `${flatLabel} Master Bedroom`,
      type: "bedroom",
      planningZone: "PRIVATE",
      rect: { x: bedZoneX, y: bY, width: bedZoneW, height: masterBedH }
    };
    rooms.push(masterBed);
    bY += masterBedH;
    const masterBath = {
      id: `${flatId}__master_bath`,
      name: `${flatLabel} Master Toilet`,
      type: "bathroom",
      planningZone: "SERVICE",
      bathroomOwnerRoomId: masterBed.id,
      rect: { x: masterBathX, y: bY, width: bath1W, height: bathH }
    };
    rooms.push(masterBath);
    const commonBath = {
      id: `${flatId}__common_bath`,
      name: `${flatLabel} Common Bathroom`,
      type: "common_toilet",
      planningZone: "SERVICE",
      rect: { x: commonBathX, y: bY, width: bath2W, height: bathH }
    };
    rooms.push(commonBath);
    bY += bathH;
    const passage = {
      id: `${flatId}__internal_passage`,
      name: `${flatLabel} Internal Passage`,
      type: "corridor",
      planningZone: "SERVICE",
      rect: { x: bedZoneX, y: bY, width: bedZoneW, height: passH }
    };
    rooms.push(passage);
    bY += passH;
    const bed2 = {
      id: `${flatId}__bed_2`,
      name: `${flatLabel} Bedroom 02`,
      type: "bedroom",
      planningZone: "PRIVATE",
      rect: { x: bedZoneX, y: bY, width: bedZoneW, height: bed2H }
    };
    rooms.push(bed2);
    bY += bed2H;
    let study;
    let pooja;
    if (studyH > 0) {
      study = {
        id: `${flatId}__study`,
        name: `${flatLabel} Study & Home Office`,
        type: "study",
        planningZone: "PRIVATE",
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: studyH }
      };
      rooms.push(study);
      bY += studyH;
    }
    if (poojaH > 0) {
      pooja = {
        id: `${flatId}__pooja`,
        name: `${flatLabel} Pooja & Meditation Room`,
        type: "pooja",
        planningZone: "PRIVATE",
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: poojaH }
      };
      rooms.push(pooja);
      bY += poojaH;
    }
    const publicRoom = diningRoom ?? livingRoom;
    const dPass = createConnectingDoor(`${flatId}__door_passage`, publicRoom, passage, 900, { doorType: "open_passage" }) ?? createConnectingDoor(`${flatId}__door_passage`, livingRoom, passage, 900, { doorType: "open_passage" });
    if (dPass) flatOpenings.push(dPass);
    const dMasterBath = createConnectingDoor(`${flatId}__door_master_bath`, masterBed, masterBath, 750);
    if (dMasterBath) flatOpenings.push(dMasterBath);
    const dCommonBath = createConnectingDoor(`${flatId}__door_common_bath`, passage, commonBath, 750);
    if (dCommonBath) flatOpenings.push(dCommonBath);
    const dBed2 = createConnectingDoor(`${flatId}__door_bed_2`, passage, bed2, 900) ?? createConnectingDoor(`${flatId}__door_bed_2`, publicRoom, bed2, 900);
    if (dBed2) flatOpenings.push(dBed2);
    if (study) {
      const dStudy = createConnectingDoor(`${flatId}__door_study`, publicRoom, study, 900) ?? createConnectingDoor(`${flatId}__door_study`, passage, study, 900) ?? createConnectingDoor(`${flatId}__door_study`, livingRoom, study, 900);
      if (dStudy) flatOpenings.push(dStudy);
    }
    if (pooja) {
      const dPooja = createConnectingDoor(`${flatId}__door_pooja`, publicRoom, pooja, 800) ?? createConnectingDoor(`${flatId}__door_pooja`, passage, pooja, 800) ?? createConnectingDoor(`${flatId}__door_pooja`, livingRoom, pooja, 800);
      if (dPooja) flatOpenings.push(dPooja);
    }
    const dMaster = createConnectingDoor(`${flatId}__door_master_bed`, publicRoom, masterBed, 900) ?? createConnectingDoor(`${flatId}__door_master_bed`, livingRoom, masterBed, 900) ?? createConnectingDoor(`${flatId}__door_master_bed`, passage, masterBed, 900);
    if (dMaster) flatOpenings.push(dMaster);
  } else if (unitType === "3BHK") {
    const bathH = snap102(Math.min(2200, Math.max(1800, box.h * 0.09)));
    const passH = snap102(Math.min(1500, Math.max(1200, box.h * 0.06)));
    const availBedH = box.h - bathH - passH;
    let masterBedH;
    let bed2H;
    let bed3H;
    let studyH = 0;
    let poojaH = 0;
    const hasStudyRequested = rawRooms.some((r) => r.type === "study" || r.type === "office" || r.name.toLowerCase().includes("study"));
    const hasPoojaRequested = rawRooms.some((r) => r.type === "pooja" || r.name.toLowerCase().includes("pooja") || r.name.toLowerCase().includes("mandir"));
    if (hasStudyRequested && hasPoojaRequested && availBedH >= 11e3) {
      masterBedH = snap102(Math.min(4800, Math.max(3600, availBedH * 0.28)));
      bed2H = snap102(Math.min(4200, Math.max(3400, availBedH * 0.24)));
      bed3H = snap102(Math.min(4e3, Math.max(3200, availBedH * 0.22)));
      const rawExcessH = availBedH - (masterBedH + bed2H + bed3H);
      studyH = snap102(Math.min(3200, Math.max(2400, rawExcessH * 0.45)));
      poojaH = rawExcessH - studyH;
    } else if (hasStudyRequested && availBedH >= 11e3) {
      masterBedH = snap102(Math.min(4800, Math.max(3600, availBedH * 0.32)));
      bed2H = snap102(Math.min(4200, Math.max(3400, availBedH * 0.28)));
      bed3H = snap102(Math.min(4e3, Math.max(3200, availBedH * 0.25)));
      studyH = availBedH - (masterBedH + bed2H + bed3H);
    } else if (hasPoojaRequested && availBedH >= 11e3) {
      masterBedH = snap102(Math.min(4800, Math.max(3600, availBedH * 0.34)));
      bed2H = snap102(Math.min(4200, Math.max(3400, availBedH * 0.3)));
      bed3H = snap102(Math.min(4e3, Math.max(3200, availBedH * 0.26)));
      poojaH = availBedH - (masterBedH + bed2H + bed3H);
    } else {
      masterBedH = snap102(availBedH * 0.38);
      bed2H = snap102(availBedH * 0.32);
      bed3H = availBedH - masterBedH - bed2H;
    }
    const useTwoBaths = bedZoneW < 3600;
    let slot1W;
    let slot2W;
    let slot3W;
    if (useTwoBaths) {
      slot1W = snap102(bedZoneW * 0.5);
      slot2W = bedZoneW - slot1W;
      slot3W = 0;
    } else {
      slot1W = snap102(bedZoneW / 3);
      slot2W = snap102(bedZoneW / 3);
      slot3W = bedZoneW - slot1W - slot2W;
    }
    const bX1 = bedZoneX;
    const bX2 = bedZoneX + slot1W;
    const bX3 = bedZoneX + slot1W + slot2W;
    const masterBathX = corridorIsEast ? bX1 : useTwoBaths ? bX2 : bX3;
    const masterBathW = corridorIsEast ? slot1W : useTwoBaths ? slot2W : slot3W;
    const bath2X = bX2;
    const bath2W = slot2W;
    const commonBathX = corridorIsEast ? useTwoBaths ? bX2 : bX3 : bX1;
    const commonBathW = corridorIsEast ? useTwoBaths ? slot2W : slot3W : slot1W;
    let bY = box.y;
    const masterBed = {
      id: `${flatId}__master_bed`,
      name: `${flatLabel} Master Bedroom`,
      type: "bedroom",
      planningZone: "PRIVATE",
      rect: { x: bedZoneX, y: bY, width: bedZoneW, height: masterBedH }
    };
    rooms.push(masterBed);
    bY += masterBedH;
    const masterBath = {
      id: `${flatId}__master_bath`,
      name: `${flatLabel} Master Toilet`,
      type: "bathroom",
      planningZone: "SERVICE",
      bathroomOwnerRoomId: masterBed.id,
      rect: { x: masterBathX, y: bY, width: masterBathW, height: bathH }
    };
    rooms.push(masterBath);
    let bath2;
    if (!useTwoBaths) {
      bath2 = {
        id: `${flatId}__bath_2`,
        name: `${flatLabel} Common Toilet 02`,
        type: "common_toilet",
        planningZone: "SERVICE",
        rect: { x: bath2X, y: bY, width: bath2W, height: bathH }
      };
      rooms.push(bath2);
    }
    const commonBath = {
      id: `${flatId}__common_bath`,
      name: `${flatLabel} Common Bathroom`,
      type: "common_toilet",
      planningZone: "SERVICE",
      rect: { x: commonBathX, y: bY, width: commonBathW, height: bathH }
    };
    rooms.push(commonBath);
    bY += bathH;
    const passage = {
      id: `${flatId}__internal_passage`,
      name: `${flatLabel} Internal Passage`,
      type: "corridor",
      planningZone: "SERVICE",
      rect: { x: bedZoneX, y: bY, width: bedZoneW, height: passH }
    };
    rooms.push(passage);
    bY += passH;
    const bed2 = {
      id: `${flatId}__bed_2`,
      name: `${flatLabel} Bedroom 02`,
      type: "bedroom",
      planningZone: "PRIVATE",
      rect: { x: bedZoneX, y: bY, width: bedZoneW, height: bed2H }
    };
    rooms.push(bed2);
    bY += bed2H;
    const bed3 = {
      id: `${flatId}__bed_3`,
      name: `${flatLabel} Bedroom 03`,
      type: "bedroom",
      planningZone: "PRIVATE",
      rect: { x: bedZoneX, y: bY, width: bedZoneW, height: bed3H }
    };
    rooms.push(bed3);
    bY += bed3H;
    let study;
    let pooja;
    if (studyH > 0) {
      study = {
        id: `${flatId}__study`,
        name: `${flatLabel} Study & Home Office`,
        type: "study",
        planningZone: "PRIVATE",
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: studyH }
      };
      rooms.push(study);
      bY += studyH;
    }
    if (poojaH > 0) {
      pooja = {
        id: `${flatId}__pooja`,
        name: `${flatLabel} Pooja & Meditation Room`,
        type: "pooja",
        planningZone: "PRIVATE",
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: poojaH }
      };
      rooms.push(pooja);
      bY += poojaH;
    }
    const publicRoom = diningRoom ?? livingRoom;
    const dPass = createConnectingDoor(`${flatId}__door_passage`, publicRoom, passage, 900, { doorType: "open_passage" }) ?? createConnectingDoor(`${flatId}__door_passage`, livingRoom, passage, 900, { doorType: "open_passage" });
    if (dPass) flatOpenings.push(dPass);
    const dMasterBath = createConnectingDoor(`${flatId}__door_master_bath`, masterBed, masterBath, 750);
    if (dMasterBath) flatOpenings.push(dMasterBath);
    if (bath2) {
      const dBath2 = createConnectingDoor(`${flatId}__door_bath_2`, passage, bath2, 750);
      if (dBath2) flatOpenings.push(dBath2);
    }
    const dCommonBath = createConnectingDoor(`${flatId}__door_common_bath`, passage, commonBath, 750);
    if (dCommonBath) flatOpenings.push(dCommonBath);
    const dBed2 = createConnectingDoor(`${flatId}__door_bed_2`, passage, bed2, 900) ?? createConnectingDoor(`${flatId}__door_bed_2`, publicRoom, bed2, 900);
    if (dBed2) flatOpenings.push(dBed2);
    const dBed3 = createConnectingDoor(`${flatId}__door_bed_3`, passage, bed3, 900) ?? createConnectingDoor(`${flatId}__door_bed_3`, publicRoom, bed3, 900) ?? createConnectingDoor(`${flatId}__door_bed_3`, livingRoom, bed3, 900);
    if (dBed3) flatOpenings.push(dBed3);
    if (study) {
      const dStudy = createConnectingDoor(`${flatId}__door_study`, publicRoom, study, 900) ?? createConnectingDoor(`${flatId}__door_study`, passage, study, 900) ?? createConnectingDoor(`${flatId}__door_study`, livingRoom, study, 900);
      if (dStudy) flatOpenings.push(dStudy);
    }
    if (pooja) {
      const dPooja = createConnectingDoor(`${flatId}__door_pooja`, publicRoom, pooja, 800) ?? createConnectingDoor(`${flatId}__door_pooja`, passage, pooja, 800) ?? createConnectingDoor(`${flatId}__door_pooja`, livingRoom, pooja, 800);
      if (dPooja) flatOpenings.push(dPooja);
    }
    const dMaster = createConnectingDoor(`${flatId}__door_master_bed`, publicRoom, masterBed, 900) ?? createConnectingDoor(`${flatId}__door_master_bed`, livingRoom, masterBed, 900) ?? createConnectingDoor(`${flatId}__door_master_bed`, passage, masterBed, 900);
    if (dMaster) flatOpenings.push(dMaster);
  } else {
    const bathH = 1800;
    const passH = 1200;
    const availBedH = box.h - bathH * 2 - passH;
    const masterBedH = snap102(availBedH * 0.28);
    const bed2H = snap102(availBedH * 0.25);
    const bed3H = snap102(availBedH * 0.24);
    const bed4H = availBedH - masterBedH - bed2H - bed3H;
    let bY = box.y;
    const masterBed = {
      id: `${flatId}__master_bed`,
      name: `${flatLabel} Master Bedroom`,
      type: "bedroom",
      planningZone: "PRIVATE",
      rect: { x: bedZoneX, y: bY, width: bedZoneW, height: masterBedH }
    };
    rooms.push(masterBed);
    bY += masterBedH;
    const b1W = snap102(bedZoneW * 0.5);
    const b2W = bedZoneW - b1W;
    const commonBathX = corridorIsEast ? bedZoneX + b1W : bedZoneX;
    const masterBathX = corridorIsEast ? bedZoneX : bedZoneX + b2W;
    const masterBath = {
      id: `${flatId}__master_bath`,
      name: `${flatLabel} Master Toilet`,
      type: "bathroom",
      planningZone: "SERVICE",
      bathroomOwnerRoomId: masterBed.id,
      rect: { x: masterBathX, y: bY, width: b1W, height: bathH }
    };
    rooms.push(masterBath);
    const commonBath = {
      id: `${flatId}__common_bath`,
      name: `${flatLabel} Common Bathroom`,
      type: "common_toilet",
      planningZone: "SERVICE",
      rect: { x: commonBathX, y: bY, width: b2W, height: bathH }
    };
    rooms.push(commonBath);
    bY += bathH;
    const passage = {
      id: `${flatId}__internal_passage`,
      name: `${flatLabel} Internal Passage`,
      type: "corridor",
      planningZone: "SERVICE",
      rect: { x: bedZoneX, y: bY, width: bedZoneW, height: passH }
    };
    rooms.push(passage);
    bY += passH;
    const bed2 = {
      id: `${flatId}__bed_2`,
      name: `${flatLabel} Bedroom 02`,
      type: "bedroom",
      planningZone: "PRIVATE",
      rect: { x: bedZoneX, y: bY, width: bedZoneW, height: bed2H }
    };
    rooms.push(bed2);
    bY += bed2H;
    const b3W = snap102(bedZoneW * 0.5);
    const b4W = bedZoneW - b3W;
    const bath2 = {
      id: `${flatId}__bath_2`,
      name: `${flatLabel} Toilet 02`,
      type: "bathroom",
      planningZone: "SERVICE",
      bathroomOwnerRoomId: bed2.id,
      rect: { x: bedZoneX, y: bY, width: b3W, height: bathH }
    };
    rooms.push(bath2);
    const bath3 = {
      id: `${flatId}__bath_3`,
      name: `${flatLabel} Toilet 03`,
      bathroomOwnerRoomId: `${flatId}__bed_3`,
      type: "bathroom",
      planningZone: "SERVICE",
      rect: { x: bedZoneX + b3W, y: bY, width: b4W, height: bathH }
    };
    rooms.push(bath3);
    bY += bathH;
    const bed3 = {
      id: `${flatId}__bed_3`,
      name: `${flatLabel} Bedroom 03`,
      type: "bedroom",
      planningZone: "PRIVATE",
      rect: { x: bedZoneX, y: bY, width: bedZoneW, height: bed3H }
    };
    rooms.push(bed3);
    bY += bed3H;
    const bed4 = {
      id: `${flatId}__bed_4`,
      name: `${flatLabel} Bedroom 04`,
      type: "bedroom",
      planningZone: "PRIVATE",
      rect: { x: bedZoneX, y: bY, width: bedZoneW, height: bed4H }
    };
    rooms.push(bed4);
    const dPass = createConnectingDoor(`${flatId}__door_passage`, livingRoom, passage, 900, { doorType: "open_passage" });
    if (dPass) flatOpenings.push(dPass);
    const dMasterBath = createConnectingDoor(`${flatId}__door_master_bath`, masterBed, masterBath, 750);
    if (dMasterBath) flatOpenings.push(dMasterBath);
    const dCommonBath = createConnectingDoor(`${flatId}__door_common_bath`, passage, commonBath, 750);
    if (dCommonBath) flatOpenings.push(dCommonBath);
    const dMaster = createConnectingDoor(`${flatId}__door_master_bed`, livingRoom, masterBed, 900);
    if (dMaster) flatOpenings.push(dMaster);
    const dBed2 = createConnectingDoor(`${flatId}__door_bed_2`, passage, bed2, 900);
    if (dBed2) flatOpenings.push(dBed2);
    const dBath2 = createConnectingDoor(`${flatId}__door_bath_2`, bed2, bath2, 750);
    if (dBath2) flatOpenings.push(dBath2);
    const dBed3 = createConnectingDoor(`${flatId}__door_bed_3`, passage, bed3, 900);
    if (dBed3) flatOpenings.push(dBed3);
    const dBath3 = createConnectingDoor(`${flatId}__door_bath_3`, bed3, bath3, 750);
    if (dBath3) flatOpenings.push(dBath3);
    const dBed4 = createConnectingDoor(`${flatId}__door_bed_4`, passage, bed4, 900);
    if (dBed4) flatOpenings.push(dBed4);
  }
  for (const room of rooms.filter((r) => r.type === "bedroom")) {
    if (flatOpenings.some((d) => d.connects?.includes(room.id) && !d.connects.some((id) => rooms.find((r) => r.id === id)?.bathroomOwnerRoomId))) continue;
    const publicTarget = diningRoom ?? livingRoom;
    const passageRoom = rooms.find((r) => r.type === "corridor");
    const door = createConnectingDoor(`${room.id}__door_day_access`, publicTarget, room, 900) ?? createConnectingDoor(`${room.id}__door_day_access`, livingRoom, room, 900) ?? (passageRoom ? createConnectingDoor(`${room.id}__door_day_access`, passageRoom, room, 900) : null);
    if (door) flatOpenings.push(door);
  }
  return { rooms, flatOpenings };
}

// packages/planning-engine/src/apartment/multi-sheet-apartment-solver.ts
function computeBuildingStackParameters(config) {
  const floorToFloorHeightMm = config.floorToFloorHeightMm ?? 3e3;
  const isStack = config.parkingMode === "MECHANICAL_STACK";
  const stiltHeightMm = config.stiltHeightMm ?? (isStack ? 4500 : 3e3);
  const basementHeightMm = config.basementHeightMm ?? 3300;
  const hasStilt = config.verticalStackType === "STILT_PLUS_N" || config.verticalStackType === "BASEMENT_STILT_PLUS_N";
  const hasBasement = config.verticalStackType === "BASEMENT_STILT_PLUS_N";
  const baseHeight = hasStilt ? stiltHeightMm : 0;
  const totalBuildingHeightMm = baseHeight + config.numTypicalFloors * floorToFloorHeightMm;
  const isHighRiseFireRegulated = totalBuildingHeightMm > 15e3;
  const minStaircases = isHighRiseFireRegulated ? 2 : 1;
  const minLifts = isHighRiseFireRegulated ? 2 : 1;
  const requiresRefugeFloor = totalBuildingHeightMm > 24e3;
  const refugeFloorLevels = [];
  if (requiresRefugeFloor) {
    for (let fl = 1; fl <= config.numTypicalFloors; fl++) {
      const slabHeight = baseHeight + fl * floorToFloorHeightMm;
      if (slabHeight > 24e3) {
        if (refugeFloorLevels.length === 0) {
          refugeFloorLevels.push(fl);
        } else {
          const last = refugeFloorLevels[refugeFloorLevels.length - 1];
          if (fl - last === 7) {
            refugeFloorLevels.push(fl);
          }
        }
      }
    }
  }
  return {
    floorToFloorHeightMm,
    stiltHeightMm,
    basementHeightMm,
    totalBuildingHeightMm,
    hasStilt,
    hasBasement,
    minStaircases,
    minLifts,
    isHighRiseFireRegulated,
    requiresRefugeFloor,
    refugeFloorLevels
  };
}
function createBoxRoom(params) {
  const boundary = {
    points: [
      { x: params.box.x, y: params.box.y },
      { x: params.box.x + params.box.w, y: params.box.y },
      { x: params.box.x + params.box.w, y: params.box.y + params.box.h },
      { x: params.box.x, y: params.box.y + params.box.h }
    ]
  };
  const result = {
    id: params.id,
    name: params.name,
    type: params.type,
    floorId: params.floorId,
    boundary,
    x: params.box.x,
    y: params.box.y,
    width: params.box.w,
    height: params.box.h,
    rotation: 0,
    area: params.box.w * params.box.h,
    priority: 1,
    tags: params.tags ?? [],
    adjacencyRequirements: [],
    daylightRequirement: "medium",
    privacyRequirement: "medium",
    ventilationRequired: true,
    isFixed: true,
    spaceUse: params.spaceUse,
    planningZone: params.planningZone,
    unitId: params.unitId
  };
  const role = params.architecturalRole ?? architecturalSpaceRole(result);
  return { ...result, architecturalRole: role, ...role === "OPEN_TO_SKY_VOID" ? { openToSky: true, spaceUse: "VOID" } : {} };
}
var roomToBox = (r) => ({ id: r.id, rect: { x: r.x, y: r.y, width: r.width, height: r.height } });
function rectPolygon(x, y, w, h) {
  return {
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h }
    ]
  };
}
function solveSitePlanSheet(config, envelope) {
  const plotW = config.plotWidthMm;
  const plotD = config.plotDepthMm;
  const plotArea = plotW * plotD;
  const siteZones = [];
  if (config.lotAllotmentMode === "FULL_LOT_100_PERCENT") {
    siteZones.push({
      id: "site_zone_bldg_plinth",
      kind: "future_expansion",
      name: "Building Plinth Footprint (100% Lot)",
      boundary: rectPolygon(0, 0, plotW, plotD),
      area: plotArea,
      accessLinks: ["road_main"],
      source: "GENERATED",
      reviewStatus: "REVIEWED"
    });
  } else {
    const bldgX = envelope.x;
    const bldgY = envelope.y;
    const bldgW = envelope.w;
    const bldgH = envelope.h;
    const rearH = bldgY;
    const frontH = plotD - (bldgY + bldgH);
    const leftW = bldgX;
    const rightW = plotW - (bldgX + bldgW);
    siteZones.push({
      id: "site_zone_bldg_plinth",
      kind: "future_expansion",
      name: "Residential Apartment Tower Footprint",
      boundary: rectPolygon(bldgX, bldgY, bldgW, bldgH),
      area: bldgW * bldgH,
      accessLinks: ["driveway_fire_tender"],
      source: "GENERATED",
      reviewStatus: "REVIEWED"
    });
    const frontY = bldgY + bldgH;
    let curX = 0;
    const secW = 2400;
    const secH = Math.min(2400, frontH);
    siteZones.push({
      id: "site_zone_sec_cabin",
      kind: "service",
      name: "SECURITY CABIN (2400 x 2400 mm)",
      boundary: rectPolygon(curX, frontY, secW, secH),
      area: secW * secH,
      accessLinks: ["road_main"],
      source: "GENERATED",
      reviewStatus: "REVIEWED"
    });
    if (frontH > secH) {
      siteZones.push({
        id: "site_zone_sec_apron",
        kind: "pedestrian_circulation",
        name: "Security Gate Paved Apron",
        boundary: rectPolygon(curX, frontY + secH, secW, frontH - secH),
        area: secW * (frontH - secH),
        accessLinks: ["road_main"],
        source: "GENERATED",
        reviewStatus: "REVIEWED"
      });
    }
    curX += secW;
    const entryGateW = 4500;
    siteZones.push({
      id: "site_zone_main_entry_gate",
      kind: "vehicle_circulation",
      name: "MAIN ENTRY GATE (IN - 4500 mm)",
      boundary: rectPolygon(curX, frontY, entryGateW, frontH),
      area: entryGateW * frontH,
      accessLinks: ["road_main"],
      source: "GENERATED",
      reviewStatus: "REVIEWED"
    });
    curX += entryGateW;
    const ingressApronW = 1500;
    siteZones.push({
      id: "site_zone_ingress_driveway",
      kind: "vehicle_circulation",
      name: "6000mm Two-Way Paved Ingress Driveway to Stilt Parking",
      boundary: rectPolygon(curX, frontY, ingressApronW, frontH),
      area: ingressApronW * frontH,
      accessLinks: ["driveway_fire_tender"],
      source: "GENERATED",
      reviewStatus: "REVIEWED"
    });
    curX += ingressApronW;
    const exitGateW = 4500;
    const egressApronW = 1500;
    const egressTotalW = exitGateW + egressApronW;
    const remainingMiddleW = Math.max(0, plotW - curX - egressTotalW);
    if (remainingMiddleW > 0) {
      const carBayW = 2500;
      const carBayCount = Math.min(3, Math.floor(remainingMiddleW / carBayW));
      const totalCarW = carBayCount * carBayW;
      for (let c = 0; c < carBayCount; c++) {
        siteZones.push({
          id: `site_zone_vis_car_${c + 1}`,
          kind: "parking",
          name: `Surface Visitor Car Bay V-0${c + 1} (2.5x5.0m)`,
          boundary: rectPolygon(curX + c * carBayW, frontY, carBayW, frontH),
          area: carBayW * frontH,
          accessLinks: ["driveway_fire_tender"],
          source: "GENERATED",
          reviewStatus: "REVIEWED"
        });
      }
      const remAfterCars = remainingMiddleW - totalCarW;
      if (remAfterCars > 0) {
        siteZones.push({
          id: "site_zone_ev_charging",
          kind: "parking",
          name: "Dedicated EV Charging Bay & Paved Forecourt",
          boundary: rectPolygon(curX + totalCarW, frontY, remAfterCars, frontH),
          area: remAfterCars * frontH,
          accessLinks: ["driveway_fire_tender"],
          source: "GENERATED",
          reviewStatus: "REVIEWED"
        });
      }
      curX += remainingMiddleW;
    }
    siteZones.push({
      id: "site_zone_egress_driveway",
      kind: "vehicle_circulation",
      name: "6000mm Two-Way Paved Egress Driveway from Stilt Parking",
      boundary: rectPolygon(curX, frontY, egressApronW, frontH),
      area: egressApronW * frontH,
      accessLinks: ["driveway_fire_tender"],
      source: "GENERATED",
      reviewStatus: "REVIEWED"
    });
    curX += egressApronW;
    const finalExitW = plotW - curX;
    siteZones.push({
      id: "site_zone_main_exit_gate",
      kind: "vehicle_circulation",
      name: "MAIN EXIT GATE (OUT - 4500 mm)",
      boundary: rectPolygon(curX, frontY, finalExitW, frontH),
      area: finalExitW * frontH,
      accessLinks: ["road_main"],
      source: "GENERATED",
      reviewStatus: "REVIEWED"
    });
    let rearX = 0;
    const dgW = 5e3;
    siteZones.push({
      id: "site_zone_dg_yard",
      kind: "service",
      name: "Acoustic Transformer & DG Yard (5x3m)",
      boundary: rectPolygon(rearX, 0, dgW, rearH),
      area: dgW * rearH,
      accessLinks: ["driveway_service"],
      source: "GENERATED",
      reviewStatus: "REVIEWED"
    });
    rearX += dgW;
    const ugwtW = 4e3;
    siteZones.push({
      id: "site_zone_ugwt_pump",
      kind: "service",
      name: "Underground Water Tank & Pump Room (UGWT)",
      boundary: rectPolygon(rearX, 0, ugwtW, rearH),
      area: ugwtW * rearH,
      accessLinks: ["driveway_service"],
      source: "GENERATED",
      reviewStatus: "REVIEWED"
    });
    rearX += ugwtW;
    const stpW = 4e3;
    siteZones.push({
      id: "site_zone_stp_plant",
      kind: "service",
      name: "Sewage Treatment Plant (STP)",
      boundary: rectPolygon(rearX, 0, stpW, rearH),
      area: stpW * rearH,
      accessLinks: ["driveway_service"],
      source: "GENERATED",
      reviewStatus: "REVIEWED"
    });
    rearX += stpW;
    const owcW = 3e3;
    siteZones.push({
      id: "site_zone_owc_waste",
      kind: "service",
      name: "Organic Waste Composter Yard (OWC)",
      boundary: rectPolygon(rearX, 0, owcW, rearH),
      area: owcW * rearH,
      accessLinks: ["driveway_service"],
      source: "GENERATED",
      reviewStatus: "REVIEWED"
    });
    rearX += owcW;
    const rwhW = 3e3;
    siteZones.push({
      id: "site_zone_rwh_pits",
      kind: "service",
      name: "Rainwater Harvesting Recharge Pits",
      boundary: rectPolygon(rearX, 0, rwhW, rearH),
      area: rwhW * rearH,
      accessLinks: ["driveway_service"],
      source: "GENERATED",
      reviewStatus: "REVIEWED"
    });
    rearX += rwhW;
    const remRearW = plotW - rearX;
    siteZones.push({
      id: "site_zone_rear_service_road",
      kind: "vehicle_circulation",
      name: "Rear Service Driveway & Manifold Access Loop",
      boundary: rectPolygon(rearX, 0, remRearW, rearH),
      area: remRearW * rearH,
      accessLinks: ["driveway_service"],
      source: "GENERATED",
      reviewStatus: "REVIEWED"
    });
    const rightX = bldgX + bldgW;
    siteZones.push({
      id: "site_zone_statutory_ros_garden",
      kind: "garden",
      name: "10% Statutory ROS Landscaped Garden & Central Park (A-SITE-LAND)",
      boundary: rectPolygon(rightX, bldgY, rightW, bldgH),
      area: rightW * bldgH,
      accessLinks: ["walkway_pedestrian"],
      source: "GENERATED",
      reviewStatus: "REVIEWED"
    });
    siteZones.push({
      id: "site_zone_west_fire_driveway",
      kind: "vehicle_circulation",
      name: "Continuous 6000mm Two-Way Paved Vehicular Driveway Loop into Ground Stilt Parking",
      boundary: rectPolygon(0, bldgY, leftW, bldgH),
      area: leftW * bldgH,
      accessLinks: ["road_main"],
      source: "GENERATED",
      reviewStatus: "REVIEWED"
    });
  }
  const accountedArea = siteZones.reduce((sum, z) => sum + z.area, 0);
  const delta = plotArea - accountedArea;
  const audit = {
    sheetId: "sheet_01_site_plan",
    sheetName: "Sheet 01: Site Layout & Landscape Plan",
    grossAreaMm2: plotArea,
    accountedAreaMm2: accountedArea,
    deltaMm2: delta,
    unassignedMm2: 0,
    isPlanarConserved: Math.abs(delta) < 1e-3
  };
  const roadFacingSide = config.roadAccessSides?.[0] ?? Direction.South;
  const site = {
    id: "project_site",
    plotBoundary: rectPolygon(0, 0, plotW, plotD),
    plotWidth: plotW,
    plotDepth: plotD,
    plotArea,
    plotShape: PlotShape.Rectangular,
    orientation: 0,
    setbacks: {
      front: config.lotAllotmentMode === "FULL_LOT_100_PERCENT" ? 0 : plotD - (envelope.y + envelope.h),
      rear: config.lotAllotmentMode === "FULL_LOT_100_PERCENT" ? 0 : envelope.y,
      left: config.lotAllotmentMode === "FULL_LOT_100_PERCENT" ? 0 : envelope.x,
      right: config.lotAllotmentMode === "FULL_LOT_100_PERCENT" ? 0 : plotW - (envelope.x + envelope.w)
    },
    accessPoints: [
      {
        id: "acc_main_entry_gate",
        position: { x: 2400 + 2250, y: plotD },
        width: 4500,
        direction: roadFacingSide
      },
      {
        id: "acc_main_exit_gate",
        position: { x: plotW - 2250, y: plotD },
        width: 4500,
        direction: roadFacingSide
      },
      {
        id: "acc_sec_cabin",
        position: { x: 1200, y: plotD - 1200 },
        width: 2400,
        direction: roadFacingSide
      }
    ],
    roadFacing: roadFacingSide,
    roadWidth: config.roadWidthMm,
    siteZones
  };
  return { site, siteZones, audit };
}
function deriveCleanStructuralColumns(floor, envelope) {
  const indoorRooms = floor.rooms.filter(
    (r) => r.type !== RoomType.Balcony && !/BALCONY|SIT-OUT|UTILITY/i.test(r.name)
  );
  const balconyRooms = floor.rooms.filter(
    (r) => r.type === RoomType.Balcony || /BALCONY|SIT-OUT|UTILITY/i.test(r.name)
  );
  const isPointNearIndoorRoom = (pt) => {
    return indoorRooms.some((r) => {
      const minX = r.x - 50;
      const maxX = r.x + r.width + 50;
      const minY = r.y - 50;
      const maxY = r.y + r.height + 50;
      return pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY;
    });
  };
  const isOuterBalconyCorner = (pt) => {
    for (const b of balconyRooms) {
      const corners = [
        { x: b.x, y: b.y },
        { x: b.x + b.width, y: b.y },
        { x: b.x, y: b.y + b.height },
        { x: b.x + b.width, y: b.y + b.height }
      ];
      for (const c of corners) {
        if (Math.hypot(pt.x - c.x, pt.y - c.y) < 300) {
          if (!isPointNearIndoorRoom(c)) {
            return true;
          }
        }
      }
    }
    return false;
  };
  const snap = (v) => Math.round(v / 50) * 50;
  const rawPoints = [];
  const colSpacingX = 5e3;
  const colSpacingY = 5e3;
  for (let cx = envelope.x; cx <= envelope.x + envelope.w; cx += colSpacingX) {
    for (let cy = envelope.y; cy <= envelope.y + envelope.h; cy += colSpacingY) {
      rawPoints.push({ x: snap(cx), y: snap(cy) });
    }
  }
  for (const w of floor.walls) {
    if (w.wallUse === "EXTERNAL" || w.wallUse === "UNIT_SEPARATION" || w.wallUse === "CORE" || w.type === "external") {
      rawPoints.push({ x: snap(w.startPoint.x), y: snap(w.startPoint.y) });
      rawPoints.push({ x: snap(w.endPoint.x), y: snap(w.endPoint.y) });
    }
  }
  const nonBalconyPoints = rawPoints.filter((p) => !isOuterBalconyCorner(p));
  const deduplicated = [];
  for (const p of nonBalconyPoints) {
    if (!deduplicated.some((d) => Math.hypot(d.x - p.x, d.y - p.y) < 500)) {
      deduplicated.push(p);
    }
  }
  deduplicated.sort((a, b) => {
    if (Math.abs(a.y - b.y) > 300) {
      return a.y - b.y;
    }
    return a.x - b.x;
  });
  return deduplicated.map((p, idx) => ({
    id: `col_${idx + 1}`,
    floorId: floor.id,
    position: p,
    width: 450,
    depth: 450,
    shape: ColumnShape.Rectangular,
    isStructural: true,
    gridReference: `C${idx + 1}`
  }));
}
function solveStiltParkingSheet(config, envelope, macro, stackParams) {
  const floorId = "floor_stilt_00";
  const rooms = [];
  const doors = [];
  const columns = [];
  const stair1 = createBoxRoom({
    id: "stilt__stair_1",
    name: "Staircase 01 (Main)",
    type: RoomType.Staircase,
    spaceUse: "CORE",
    box: macro.stairBoxes[0],
    floorId,
    tags: ["core:stair"]
  });
  rooms.push(stair1);
  if (macro.stairBoxes[1]) {
    const stair2 = createBoxRoom({
      id: "stilt__stair_2",
      name: "Staircase 02 (Fire Escape)",
      type: RoomType.Staircase,
      spaceUse: "CORE",
      box: macro.stairBoxes[1],
      floorId,
      tags: ["core:stair"]
    });
    rooms.push(stair2);
  }
  const lift1 = createBoxRoom({
    id: "stilt__lift_1",
    name: "Passenger Lift 01",
    type: RoomType.Lift,
    spaceUse: "CORE",
    box: macro.liftBoxes[0],
    floorId,
    tags: ["core:lift"]
  });
  rooms.push(lift1);
  if (macro.liftBoxes[1]) {
    const lift2 = createBoxRoom({
      id: "stilt__lift_2",
      name: "Stretcher / Fire Lift 02",
      type: RoomType.Lift,
      spaceUse: "CORE",
      box: macro.liftBoxes[1],
      floorId,
      tags: ["core:lift"]
    });
    rooms.push(lift2);
  }
  const stiltLobby = createBoxRoom({
    id: "stilt__core_lobby",
    architecturalRole: "LIFT_LOBBY",
    name: "Stilt Central Lift Lobby",
    type: RoomType.Corridor,
    spaceUse: "CORE",
    box: macro.lobbyBox,
    floorId,
    tags: ["core:lobby"]
  });
  rooms.push(stiltLobby);
  const stiltCorridor = createBoxRoom({
    id: "stilt__corridor_spine",
    name: "Stilt Central Circulation Spine",
    type: RoomType.Corridor,
    spaceUse: "CORE",
    box: macro.corridorBox,
    floorId,
    tags: ["core:corridor"]
  });
  rooms.push(stiltCorridor);
  for (let s = 0; s < macro.shaftBoxes.length; s++) {
    const shaft = createBoxRoom({
      id: `stilt__shaft_${s + 1}`,
      architecturalRole: macro.shaftRoles?.[s],
      name: macro.shaftRoles?.[s] === "OPEN_TO_SKY_VOID" ? "Open-to-sky courtyard at stilt" : `MEP Service Shaft 0${s + 1}`,
      type: RoomType.ServiceShaft,
      spaceUse: "SERVICE",
      box: macro.shaftBoxes[s],
      floorId,
      tags: ["core:shaft"]
    });
    rooms.push(shaft);
  }
  const westBox = macro.flatBoxes[0];
  const amenityH = snap102(westBox.h * 0.42);
  const westParkH = westBox.h - amenityH;
  const amenityBox = { x: westBox.x, y: westBox.y, w: westBox.w, h: amenityH };
  const amLobbyW = snap102(amenityBox.w * 0.4);
  const amOfficeW = snap102(amenityBox.w * 0.25);
  const amGymW = amenityBox.w - (amLobbyW + amOfficeW);
  const grandLobby = createBoxRoom({
    id: "stilt__grand_lobby",
    name: "Grand Entrance Double-Height Lobby",
    type: RoomType.Foyer,
    spaceUse: "COMMON",
    box: { x: amenityBox.x, y: amenityBox.y, w: amLobbyW, h: amenityBox.h },
    floorId
  });
  rooms.push(grandLobby);
  const officeH = snap102(amenityBox.h * 0.65);
  const toiletH = amenityBox.h - officeH;
  const office = createBoxRoom({
    id: "stilt__society_office",
    architecturalRole: config.stiltAmenities.societyOffice ? "ENCLOSED_SERVICE" : "OPEN_CIRCULATION",
    name: config.stiltAmenities.societyOffice ? "Society Administrative Office" : "Open stilt circulation",
    type: RoomType.Custom,
    spaceUse: "COMMON",
    box: { x: amenityBox.x + amLobbyW, y: amenityBox.y, w: amOfficeW, h: officeH },
    floorId
  });
  rooms.push(office);
  const staffToilet = createBoxRoom({
    id: "stilt__staff_toilet",
    architecturalRole: config.stiltAmenities.driverStaffToilet ? "ENCLOSED_SERVICE" : "OPEN_CIRCULATION",
    name: config.stiltAmenities.driverStaffToilet ? "Driver & Maintenance Staff Toilet" : "Open stilt circulation",
    type: RoomType.Bathroom,
    spaceUse: "SERVICE",
    box: { x: amenityBox.x + amLobbyW, y: amenityBox.y + officeH, w: amOfficeW, h: toiletH },
    floorId
  });
  rooms.push(staffToilet);
  const gymH = snap102(amenityBox.h * 0.7);
  const meterH = amenityBox.h - gymH;
  const gym = createBoxRoom({
    id: "stilt__gymnasium",
    architecturalRole: config.stiltAmenities.fitnessGymnasium ? "ENCLOSED_SERVICE" : "OPEN_CIRCULATION",
    name: config.stiltAmenities.fitnessGymnasium ? "Fitness Center & Health Gymnasium" : "Open stilt circulation",
    type: RoomType.Custom,
    spaceUse: "COMMON",
    box: { x: amenityBox.x + amLobbyW + amOfficeW, y: amenityBox.y, w: amGymW, h: gymH },
    floorId
  });
  rooms.push(gym);
  const meterRoom = createBoxRoom({
    id: "stilt__meter_bms_room",
    architecturalRole: config.stiltAmenities.meterBmsRoom ? "ENCLOSED_SERVICE" : "OPEN_CIRCULATION",
    name: config.stiltAmenities.meterBmsRoom ? "Electric Meter & BMS Control Room" : "Open stilt circulation",
    type: RoomType.Custom,
    spaceUse: "SERVICE",
    box: { x: amenityBox.x + amLobbyW + amOfficeW, y: amenityBox.y + gymH, w: amGymW, h: meterH },
    floorId
  });
  rooms.push(meterRoom);
  let carBaysCount = 0;
  let bikeBaysCount = 0;
  const packParkingBox = (box, zoneKey) => {
    const stallDepth = 5e3;
    const stallWidth = 2500;
    const numStalls = Math.floor(box.w / stallWidth);
    const stallsW = numStalls * stallWidth;
    const remW = box.w - stallsW;
    const isDoubleLoaded = box.h >= 13e3;
    for (let s = 0; s < numStalls; s++) {
      carBaysCount++;
      const bayId = `stilt__car_bay_c${String(carBaysCount).padStart(2, "0")}`;
      rooms.push(
        createBoxRoom({
          id: bayId,
          name: `Covered Car Parking Stall C-${String(carBaysCount).padStart(2, "0")} (2.5x5.0m)`,
          type: RoomType.Parking,
          spaceUse: "COMMON",
          box: { x: box.x + s * stallWidth, y: box.y, w: stallWidth, h: stallDepth },
          floorId
        })
      );
    }
    if (remW > 0) {
      bikeBaysCount += remW >= 1e3 ? 2 : 0;
      rooms.push(
        createBoxRoom({
          id: remW >= 1e3 ? `stilt__bike_bay_b${String(bikeBaysCount).padStart(2, "0")}` : `stilt__open_remainder_${zoneKey}_${rooms.length}`,
          name: remW >= 1e3 ? `Two-Wheeler Parking Bay B-${String(bikeBaysCount).padStart(2, "0")}` : "Open parking remainder (not a vehicle bay)",
          type: remW >= 1e3 ? RoomType.Parking : RoomType.Foyer,
          spaceUse: "COMMON",
          box: { x: box.x + stallsW, y: box.y, w: remW, h: stallDepth },
          floorId
        })
      );
    }
    if (isDoubleLoaded) {
      const southY = box.y + box.h - stallDepth;
      for (let s = 0; s < numStalls; s++) {
        carBaysCount++;
        const bayId = `stilt__car_bay_c${String(carBaysCount).padStart(2, "0")}`;
        rooms.push(
          createBoxRoom({
            id: bayId,
            name: `Covered Car Parking Stall C-${String(carBaysCount).padStart(2, "0")} (2.5x5.0m)`,
            type: RoomType.Parking,
            spaceUse: "COMMON",
            box: { x: box.x + s * stallWidth, y: southY, w: stallWidth, h: stallDepth },
            floorId
          })
        );
      }
      if (remW > 0) {
        bikeBaysCount += remW >= 1e3 ? 2 : 0;
        rooms.push(
          createBoxRoom({
            id: remW >= 1e3 ? `stilt__bike_bay_b${String(bikeBaysCount).padStart(2, "0")}` : `stilt__open_remainder_${zoneKey}_${rooms.length}`,
            name: remW >= 1e3 ? `Two-Wheeler Parking Bay B-${String(bikeBaysCount).padStart(2, "0")}` : "Open parking remainder (not a vehicle bay)",
            type: remW >= 1e3 ? RoomType.Parking : RoomType.Foyer,
            spaceUse: "COMMON",
            box: { x: box.x + stallsW, y: southY, w: remW, h: stallDepth },
            floorId
          })
        );
      }
      const driveH = box.h - 2 * stallDepth;
      rooms.push(
        createBoxRoom({
          id: `stilt__driveway_${zoneKey}`,
          architecturalRole: "VEHICLE_AISLE",
          name: `Stilt Vehicular Driveway & Maneuvering Aisle (${zoneKey})`,
          type: RoomType.Corridor,
          spaceUse: "COMMON",
          box: { x: box.x, y: box.y + stallDepth, w: box.w, h: driveH },
          floorId
        })
      );
    } else {
      const driveH = box.h - stallDepth;
      rooms.push(
        createBoxRoom({
          id: `stilt__driveway_${zoneKey}`,
          architecturalRole: "VEHICLE_AISLE",
          name: `Stilt Vehicular Driveway & Maneuvering Aisle (${zoneKey})`,
          type: RoomType.Corridor,
          spaceUse: "COMMON",
          box: { x: box.x, y: box.y + stallDepth, w: box.w, h: driveH },
          floorId
        })
      );
    }
  };
  const parkBoxA = { x: westBox.x, y: westBox.y + amenityH, w: westBox.w, h: westParkH };
  packParkingBox(parkBoxA, "west");
  for (let fb = 1; fb < macro.flatBoxes.length; fb++) {
    const eastBox = macro.flatBoxes[fb];
    packParkingBox(eastBox, `east_0${fb}`);
  }
  const stiltBoundary = rectPolygon(envelope.x, envelope.y, envelope.w, envelope.h);
  const walls = generateApartmentWalls(rooms, floorId, stiltBoundary, true, config.architectureOptions?.guardHeightMm);
  const dStair1 = createConnectingDoor("door_stilt_stair1", roomToBox(stiltLobby), roomToBox(stair1), 1200, { doorType: "open_passage" });
  if (dStair1) {
    const hostWall = walls.find((w) => w.roomIds.includes(stiltLobby.id) && w.roomIds.includes(stair1.id)) ?? walls.find((w) => openingFitsApartmentWall(w, { x: snap102(dStair1.rect.x + dStair1.rect.width / 2), y: snap102(dStair1.rect.y + dStair1.rect.height / 2) }, 1200));
    if (hostWall) {
      doors.push({
        id: dStair1.id,
        floorId,
        wallId: hostWall.id,
        position: { x: snap102(dStair1.rect.x + dStair1.rect.width / 2), y: snap102(dStair1.rect.y + dStair1.rect.height / 2) },
        width: 1200,
        height: 2100,
        type: DoorType.OpenPassage,
        swingDirection: SwingDirection.Inward,
        connectsRooms: [stiltLobby.id, stair1.id]
      });
      hostWall.hasOpening = true;
    }
  }
  const dLobbyCorr = createConnectingDoor("door_stilt_lobby_corr", roomToBox(stiltLobby), roomToBox(stiltCorridor), 1500, { doorType: "open_passage" });
  if (dLobbyCorr) {
    const hostWall = walls.find((w) => w.roomIds.includes(stiltLobby.id) && w.roomIds.includes(stiltCorridor.id)) ?? walls.find((w) => openingFitsApartmentWall(w, { x: snap102(dLobbyCorr.rect.x + dLobbyCorr.rect.width / 2), y: snap102(dLobbyCorr.rect.y + dLobbyCorr.rect.height / 2) }, 1500));
    if (hostWall) {
      doors.push({
        id: dLobbyCorr.id,
        floorId,
        wallId: hostWall.id,
        position: { x: snap102(dLobbyCorr.rect.x + dLobbyCorr.rect.width / 2), y: snap102(dLobbyCorr.rect.y + dLobbyCorr.rect.height / 2) },
        width: 1500,
        height: 2100,
        type: DoorType.OpenPassage,
        swingDirection: SwingDirection.Inward,
        connectsRooms: [stiltLobby.id, stiltCorridor.id]
      });
      hostWall.hasOpening = true;
    }
  }
  const tempFloor = {
    id: floorId,
    buildingId: "apartment_building",
    level: 0,
    name: "STILT_PARKING_PLAN",
    floorHeight: stackParams.stiltHeightMm,
    boundary: stiltBoundary,
    rooms,
    walls,
    doors,
    windows: [],
    stairs: [],
    columns: []
  };
  if (config.structuralLayoutMode === "PROVISIONAL_EXISTING_PROFILE") columns.push(...deriveCleanStructuralColumns(tempFloor, envelope));
  const floor = {
    id: floorId,
    buildingId: "apartment_building",
    level: 0,
    name: "STILT_PARKING_PLAN",
    floorHeight: stackParams.stiltHeightMm,
    boundary: stiltBoundary,
    rooms,
    walls,
    doors,
    windows: [],
    stairs: [],
    columns
  };
  const ledger = measureApartmentAreaLedger(floor);
  const audit = {
    sheetId: "sheet_02_stilt_plan",
    sheetName: "Sheet 02: Stilt Floor Parking & Amenities Plan",
    grossAreaMm2: ledger.gross,
    accountedAreaMm2: ledger.accounted,
    deltaMm2: ledger.delta,
    unassignedMm2: ledger.unassigned,
    isPlanarConserved: Math.abs(ledger.delta) < 1e-3 && ledger.unassigned === 0
  };
  return { floor, carBaysCount, bikeBaysCount, audit };
}
function solveTypicalFloorSheet(config, envelope, floorLevel = 1) {
  const floorId = floorLevel === 1 ? "floor_typical_01" : `floor_level_${String(floorLevel).padStart(2, "0")}`;
  const floorName = floorLevel === 0 ? "GROUND_FLOOR_PLAN" : floorLevel === 1 ? "1ST_FLOOR_PLAN" : floorLevel === 2 ? "2ND_FLOOR_PLAN" : floorLevel === 3 ? "3RD_FLOOR_PLAN" : `${floorLevel}TH_FLOOR_PLAN`;
  const manifest = createDynamicApartmentManifest({
    plotWidthMm: config.plotWidthMm,
    plotDepthMm: config.plotDepthMm,
    flatsPerFloor: config.flatsPerFloor,
    units: config.units,
    jurisdiction: config.jurisdiction,
    lotAllotmentMode: config.lotAllotmentMode
  });
  const structure = solveOrthogonalSpaceFillingApartment({
    plan: { flats: [], rooms: [] },
    site: {
      plotWidth: config.plotWidthMm,
      plotDepth: config.plotDepthMm,
      lotAllotmentMode: config.lotAllotmentMode,
      setbacks: {
        front: config.plotDepthMm - (envelope.y + envelope.h),
        rear: envelope.y,
        left: envelope.x,
        right: config.plotWidthMm - (envelope.x + envelope.w)
      }
    },
    frame: { width: 1e3, height: 1e3 },
    manifest,
    lotAllotmentMode: config.lotAllotmentMode
  });
  const rooms = [];
  const addRoom2 = (r, defaultType, unitId) => {
    const rType = r.type === "common_toilet" ? RoomType.Bathroom : r.type ?? defaultType;
    rooms.push(
      createBoxRoom({
        id: `apt-room:${r.id}`,
        architecturalRole: r.architecturalRole,
        name: r.name,
        type: rType,
        spaceUse: rType === RoomType.Balcony ? "OUTDOOR" : unitId ? "UNIT" : rType === RoomType.ServiceShaft ? "SERVICE" : rType === RoomType.Lift || rType === RoomType.Staircase ? "CORE" : "COMMON",
        planningZone: r.planningZone,
        box: { x: r.rect.x, y: r.rect.y, w: r.rect.width, h: r.rect.height },
        floorId,
        unitId,
        tags: [`apt-room:${r.id}`]
      })
    );
  };
  for (let fIdx = 0; fIdx < structure.flats.length; fIdx++) {
    const flat = structure.flats[fIdx];
    const flatNum = floorLevel * 100 + (fIdx + 1);
    for (const r of flat.rooms) {
      const renamed = {
        ...r,
        name: r.name.replace(/Flat\s*0?(\d+)/i, `Flat ${flatNum}`)
      };
      addRoom2(renamed, RoomType.Custom, flat.id);
    }
  }
  for (const el of structure.lifts) addRoom2(el, RoomType.Lift);
  for (const el of structure.stairs) addRoom2(el, RoomType.Staircase);
  for (const el of structure.lobbies) addRoom2(el, RoomType.Corridor);
  for (const el of structure.corridors) addRoom2(el, RoomType.Corridor);
  for (const el of structure.shafts) addRoom2(el, RoomType.ServiceShaft);
  const boundary = rectPolygon(envelope.x, envelope.y, envelope.w, envelope.h);
  const walls = generateApartmentWalls(rooms, floorId, boundary, true, config.architectureOptions?.guardHeightMm);
  const doors = [];
  const windows = [];
  for (const op of structure.openings) {
    const hostWall = walls.find(
      (w) => (!op.connects || op.connects.every((id) => w.roomIds.includes(`apt-room:${id}`))) && openingFitsApartmentWall(
        w,
        { x: op.rect.x + op.rect.width / 2, y: op.rect.y + op.rect.height / 2 },
        Math.max(op.rect.width, op.rect.height)
      )
    );
    if (hostWall) {
      doors.push({
        id: op.id,
        floorId,
        wallId: hostWall.id,
        position: { x: op.rect.x + op.rect.width / 2, y: op.rect.y + op.rect.height / 2 },
        width: Math.max(op.rect.width, op.rect.height),
        height: 2100,
        type: op.doorType === "sliding" ? DoorType.Sliding : op.doorType === "open_passage" ? DoorType.OpenPassage : DoorType.Single,
        swingDirection: SwingDirection.Inward,
        connectsRooms: [op.connects?.[0] ? `apt-room:${op.connects[0]}` : "", op.connects?.[1] ? `apt-room:${op.connects[1]}` : ""]
      });
      hostWall.hasOpening = true;
    }
  }
  for (const r of rooms) {
    if (r.spaceUse === "OUTDOOR" || r.type === RoomType.ServiceShaft) continue;
    const extWalls = walls.filter((w) => w.wallUse === "EXTERNAL" && w.boundaryRole !== "OPEN_BOUNDARY" && w.boundaryRole !== "PARAPET" && w.roomIds.includes(r.id));
    for (const hw of extWalls) {
      const hasDoor = doors.some((d) => d.wallId === hw.id);
      if (hasDoor) {
        continue;
      }
      const winW = 1200;
      const winPos = {
        x: snap102((hw.startPoint.x + hw.endPoint.x) / 2),
        y: snap102((hw.startPoint.y + hw.endPoint.y) / 2)
      };
      if (openingFitsApartmentWall(hw, winPos, winW)) {
        windows.push({
          id: `win_${r.id}_${hw.id}`,
          floorId,
          wallId: hw.id,
          position: winPos,
          width: winW,
          height: 1200,
          sillHeight: 900,
          type: WindowType.Sliding,
          roomId: r.id
        });
      }
    }
  }
  const floor = {
    id: floorId,
    buildingId: "apartment_building",
    level: floorLevel,
    name: floorName,
    floorHeight: config.floorToFloorHeightMm ?? 3e3,
    boundary,
    rooms,
    walls,
    doors,
    windows,
    stairs: [],
    columns: deriveCleanStructuralColumns(
      {
        id: floorId,
        buildingId: "apartment_building",
        level: floorLevel,
        name: floorName,
        floorHeight: config.floorToFloorHeightMm ?? 3e3,
        boundary,
        rooms,
        walls,
        doors,
        windows,
        stairs: [],
        columns: []
      },
      envelope
    ),
    apartmentUnits: structure.flats.map((f, idx) => ({
      id: f.id,
      boundary: rectPolygon(f.rect.x, f.rect.y, f.rect.width, f.rect.height),
      unitType: f.unitType,
      unitIndex: idx + 1
    }))
  };
  const flOrdinal = floorLevel === 1 ? "1st" : floorLevel === 2 ? "2nd" : floorLevel === 3 ? "3rd" : `${floorLevel}th`;
  const repairedFloor = repairApartmentPlan({ id: "typical", projectId: "typical", name: floorName, site: { plotWidth: config.plotWidthMm, plotDepth: config.plotDepthMm }, floors: [floor], metadata: { projectId: "typical" }, version: 1, createdAt: "", updatedAt: "" }, manifest).building.floors[0];
  const ledger = measureApartmentAreaLedger(repairedFloor);
  const audit = {
    sheetId: floorLevel === 1 ? "sheet_03_typical_plan" : `sheet_03_level_${floorLevel}_plan`,
    sheetName: `Sheet 03: ${flOrdinal} Residential Floor Plan`,
    grossAreaMm2: ledger.gross,
    accountedAreaMm2: ledger.accounted,
    deltaMm2: ledger.delta,
    unassignedMm2: ledger.unassigned,
    isPlanarConserved: Math.abs(ledger.delta) < 1e-3 && ledger.unassigned === 0
  };
  return { floor: repairedFloor, structure, audit };
}
function solveStructuralColumnScheduleSheet(typicalResult, _envelope) {
  const columns = typicalResult.floor.columns;
  const scheduleRows = columns.map((c) => ({
    columnNo: c.gridReference || c.id,
    gridRef: `Grid (${(c.position.x / 1e3).toFixed(1)}m, ${(c.position.y / 1e3).toFixed(1)}m)`,
    sizeMm: `${c.width} x ${c.depth} mm`,
    orientation: "Vertical RCC Column",
    loadLevel: "Ground / Stilt to Terrace Slab (All Levels)"
  }));
  const floor = {
    ...typicalResult.floor,
    id: "floor_col_schedule_04",
    name: "STRUCTURAL_COLUMN_SCHEDULE_PLAN",
    level: 1,
    rooms: [],
    // Pure structural sheet: no room fills cluttering the structural grid
    doors: [],
    windows: [],
    columns: [...columns]
  };
  const audit = {
    sheetId: "sheet_04_column_schedule",
    sheetName: "Sheet 04: Structural Column Layout & Schedule Plan",
    grossAreaMm2: typicalResult.audit.grossAreaMm2,
    accountedAreaMm2: typicalResult.audit.accountedAreaMm2,
    deltaMm2: typicalResult.audit.deltaMm2,
    unassignedMm2: 0,
    isPlanarConserved: typicalResult.audit.isPlanarConserved
  };
  return { floor, columns, scheduleRows, audit };
}
function solveRefugeFloorSheet(typicalResult, refugeLevel) {
  const floorId = `floor_refuge_${String(refugeLevel).padStart(2, "0")}`;
  const baseFloor = typicalResult.floor;
  const origBalcony = baseFloor.rooms.find((r) => r.id.includes("flat_01__balcony") || r.spaceUse === "OUTDOOR" && r.unitId === "flat_01");
  const origLiving = baseFloor.rooms.find((r) => r.unitId === "flat_01" && r.type === RoomType.Living);
  let deltaD = 0;
  if (origBalcony && origLiving && origBalcony.area < 15e6) {
    deltaD = snap102(Math.ceil((155e5 - origBalcony.area) / origBalcony.width));
  }
  const rooms = baseFloor.rooms.map((r) => {
    if (origBalcony && (r.id === origBalcony.id || r.id.includes("flat_01__balcony"))) {
      const isNorth = origLiving ? origBalcony.y <= origLiving.y : true;
      const refY = isNorth ? origBalcony.y : origBalcony.y - deltaD;
      const refH = origBalcony.height + deltaD;
      return createBoxRoom({
        id: `refuge_terrace_${refugeLevel}`,
        name: "Statutory Fire Refuge Terrace (>= 15 m\xB2)",
        type: RoomType.Balcony,
        spaceUse: "OUTDOOR",
        planningZone: "OUTDOOR",
        box: { x: origBalcony.x, y: refY, w: origBalcony.width, h: refH },
        floorId,
        unitId: "flat_01",
        tags: ["refuge:terrace", "fire_safety"]
      });
    }
    if (origLiving && r.id === origLiving.id && deltaD > 0) {
      const isNorth = origBalcony ? origBalcony.y <= origLiving.y : true;
      const livY = isNorth ? origLiving.y + deltaD : origLiving.y;
      const livH = origLiving.height - deltaD;
      return createBoxRoom({
        id: origLiving.id,
        name: origLiving.name,
        type: origLiving.type,
        spaceUse: origLiving.spaceUse,
        planningZone: origLiving.planningZone,
        box: { x: origLiving.x, y: livY, w: origLiving.width, h: livH },
        floorId,
        unitId: "flat_01",
        tags: [...origLiving.tags]
      });
    }
    return { ...r, floorId };
  });
  if (origBalcony && origLiving && deltaD > 0 && origLiving.width > origBalcony.width) {
    const isNorth = origBalcony.y <= origLiving.y;
    const remainingX = origBalcony.x === origLiving.x ? origBalcony.x + origBalcony.width : origLiving.x;
    rooms.push(createBoxRoom({
      id: `refuge_access_${refugeLevel}`,
      name: "Refuge access passage",
      type: RoomType.Corridor,
      spaceUse: "UNIT",
      floorId,
      unitId: "flat_01",
      tags: ["refuge:access"],
      box: {
        x: remainingX,
        y: isNorth ? origLiving.y : origLiving.y + origLiving.height - deltaD,
        w: origLiving.width - origBalcony.width,
        h: deltaD
      }
    }));
  }
  const walls = generateApartmentWalls(rooms, floorId, baseFloor.boundary);
  const doors = baseFloor.doors.map((d) => ({ ...d, floorId }));
  const refugeRoom = rooms.find((r) => r.tags.includes("refuge:terrace"));
  if (refugeRoom) {
    const living = rooms.find((r) => r.unitId === "flat_01" && r.type === RoomType.Living);
    if (living) {
      const dRefuge = createConnectingDoor(`door_refuge_${refugeLevel}`, roomToBox(living), roomToBox(refugeRoom), 1050, { isFlatEntrance: true });
      if (dRefuge) {
        const hostWall = walls.find((w) => w.roomIds.includes(living.id) && w.roomIds.includes(refugeRoom.id)) ?? walls.find((w) => openingFitsApartmentWall(w, { x: snap102(dRefuge.rect.x + dRefuge.rect.width / 2), y: snap102(dRefuge.rect.y + dRefuge.rect.height / 2) }, 1050));
        if (hostWall) {
          doors.push({
            id: dRefuge.id,
            floorId,
            wallId: hostWall.id,
            position: { x: snap102(dRefuge.rect.x + dRefuge.rect.width / 2), y: snap102(dRefuge.rect.y + dRefuge.rect.height / 2) },
            width: 1050,
            height: 2100,
            type: DoorType.Single,
            swingDirection: SwingDirection.Outward,
            connectsRooms: [living.id, refugeRoom.id]
          });
          hostWall.hasOpening = true;
        }
      }
    }
  }
  const floor = {
    ...baseFloor,
    id: floorId,
    level: refugeLevel,
    name: "REFUGE_FLOOR_PLAN",
    rooms,
    walls,
    doors,
    windows: baseFloor.windows.map((w) => ({ ...w, floorId }))
  };
  const ledger = measureApartmentAreaLedger(floor);
  const refugeAreaM2 = (refugeRoom?.area ?? 0) / 1e6;
  const audit = {
    sheetId: "sheet_04_refuge_plan",
    sheetName: `Sheet 04: Fire Refuge Floor Plan (Level ${refugeLevel})`,
    grossAreaMm2: ledger.gross,
    accountedAreaMm2: ledger.accounted,
    deltaMm2: ledger.delta,
    unassignedMm2: ledger.unassigned,
    isPlanarConserved: Math.abs(ledger.delta) < 1e-3 && ledger.unassigned === 0
  };
  return { floor, refugeAreaM2, audit };
}
function solveTerraceSheet(config, envelope, macro, terraceLevel) {
  const floorId = `floor_terrace_${String(terraceLevel).padStart(2, "0")}`;
  const rooms = [];
  const doors = [];
  const mumty1 = createBoxRoom({
    id: "terrace__stair_mumty_1",
    name: "Staircase 01 Mumty & Headroom",
    architecturalRole: "STAIR_MUMTY",
    type: RoomType.Staircase,
    spaceUse: "CORE",
    box: macro.stairBoxes[0],
    floorId,
    tags: ["terrace:core"]
  });
  rooms.push(mumty1);
  if (macro.stairBoxes[1]) {
    const mumty2 = createBoxRoom({
      id: "terrace__stair_mumty_2",
      name: "Staircase 02 Mumty & Fire Escape Headroom",
      architecturalRole: "STAIR_MUMTY",
      type: RoomType.Staircase,
      spaceUse: "CORE",
      box: macro.stairBoxes[1],
      floorId,
      tags: ["terrace:core"]
    });
    rooms.push(mumty2);
  }
  const lmr1 = createBoxRoom({
    id: "terrace__lift_machine_room_1",
    name: config.architectureOptions?.liftSystem === "MACHINE_ROOM_REQUIRED" ? "Lift equipment room 01" : "Lift headroom reservation 01",
    architecturalRole: config.architectureOptions?.liftSystem === "MACHINE_ROOM_REQUIRED" ? "LIFT_EQUIPMENT" : "ROOF_EQUIPMENT_ZONE",
    type: RoomType.Custom,
    spaceUse: "CORE",
    box: macro.liftBoxes[0],
    floorId,
    tags: ["terrace:core"]
  });
  rooms.push(lmr1);
  if (macro.liftBoxes[1]) {
    const lmr2 = createBoxRoom({
      id: "terrace__lift_machine_room_2",
      name: config.architectureOptions?.liftSystem === "MACHINE_ROOM_REQUIRED" ? "Lift equipment room 02" : "Lift headroom reservation 02",
      architecturalRole: config.architectureOptions?.liftSystem === "MACHINE_ROOM_REQUIRED" ? "LIFT_EQUIPMENT" : "ROOF_EQUIPMENT_ZONE",
      type: RoomType.Custom,
      spaceUse: "CORE",
      box: macro.liftBoxes[1],
      floorId,
      tags: ["terrace:core"]
    });
    rooms.push(lmr2);
  }
  const ohwt = createBoxRoom({
    id: "terrace__ohwt_tank",
    architecturalRole: "ROOF_EQUIPMENT_ZONE",
    name: "Overhead Water Tank (OHWT \u2014 Domestic & Fire Reserve)",
    type: RoomType.Custom,
    spaceUse: "SERVICE",
    box: macro.lobbyBox,
    floorId,
    tags: ["terrace:core"]
  });
  rooms.push(ohwt);
  const roofCorr = createBoxRoom({
    id: "terrace__corridor_vestibule",
    name: "Terrace Access Vestibule",
    type: RoomType.Corridor,
    spaceUse: "COMMON",
    box: macro.corridorBox,
    floorId,
    tags: ["terrace:core"]
  });
  rooms.push(roofCorr);
  for (let s = 0; s < macro.shaftBoxes.length; s++) {
    rooms.push(
      createBoxRoom({
        id: `terrace__shaft_head_${s + 1}`,
        architecturalRole: macro.shaftRoles?.[s] === "OPEN_TO_SKY_VOID" ? "OPEN_TO_SKY_VOID" : "SERVICE_SHAFT",
        name: macro.shaftRoles?.[s] === "OPEN_TO_SKY_VOID" ? "Open-to-sky courtyard (no roof)" : `Service duct vent head 0${s + 1}`,
        type: RoomType.ServiceShaft,
        spaceUse: "SERVICE",
        box: macro.shaftBoxes[s],
        floorId,
        tags: ["terrace:core"]
      })
    );
  }
  const westBox = macro.flatBoxes[0];
  rooms.push(
    createBoxRoom({
      id: "terrace__solar_pv_array",
      name: "Rooftop Solar PV Array & Inverter Deck",
      type: RoomType.Terrace,
      spaceUse: "OUTDOOR",
      box: westBox,
      floorId,
      tags: ["terrace:solar"]
    })
  );
  for (let fb = 1; fb < macro.flatBoxes.length; fb++) {
    const eastBox = macro.flatBoxes[fb];
    const yogaH = snap102(eastBox.h * 0.45);
    const openH = eastBox.h - yogaH;
    rooms.push(
      createBoxRoom({
        id: `terrace__yoga_deck_${fb}`,
        name: "Terrace Gazebo, Yoga & Landscaped Sitout Deck",
        type: RoomType.Terrace,
        spaceUse: "OUTDOOR",
        box: { x: eastBox.x, y: eastBox.y, w: eastBox.w, h: yogaH },
        floorId,
        tags: ["terrace:amenity"]
      })
    );
    rooms.push(
      createBoxRoom({
        id: `terrace__open_waterproof_${fb}`,
        name: "Open Waterproofed Rooftop Terrace",
        type: RoomType.Terrace,
        spaceUse: "OUTDOOR",
        box: { x: eastBox.x, y: eastBox.y + yogaH, w: eastBox.w, h: openH },
        floorId,
        tags: ["terrace:open"]
      })
    );
  }
  const terraceBoundary = rectPolygon(envelope.x, envelope.y, envelope.w, envelope.h);
  const walls = generateApartmentWalls(rooms, floorId, terraceBoundary, true, config.architectureOptions?.guardHeightMm);
  for (const mumty of rooms.filter((r) => r.architecturalRole === "STAIR_MUMTY")) {
    const hosts = walls.filter((w) => w.roomIds.includes(mumty.id) && w.roomIds.some((id) => rooms.some((r) => r.id === id && ["OPEN_CIRCULATION", "OPEN_TERRACE", "ROOF_EQUIPMENT_ZONE"].includes(r.architecturalRole ?? ""))));
    const host = hosts.find((w) => openingFitsApartmentWall(w, { x: (w.startPoint.x + w.endPoint.x) / 2, y: (w.startPoint.y + w.endPoint.y) / 2 }, 1050));
    if (!host) throw new Error(`ROOF_STAIR_ACCESS_UNAVAILABLE: ${mumty.id}`);
    const other = host.roomIds.find((id) => id !== mumty.id);
    doors.push({
      id: `${mumty.id}:roof-access`,
      floorId,
      wallId: host.id,
      position: { x: (host.startPoint.x + host.endPoint.x) / 2, y: (host.startPoint.y + host.endPoint.y) / 2 },
      width: 1050,
      height: 2100,
      type: DoorType.Single,
      swingDirection: SwingDirection.Outward,
      connectsRooms: [mumty.id, other]
    });
  }
  const floor = {
    id: floorId,
    buildingId: "apartment_building",
    level: terraceLevel,
    name: "TERRACE_PLAN",
    floorHeight: 3e3,
    boundary: terraceBoundary,
    rooms,
    walls,
    doors,
    windows: [],
    stairs: [],
    columns: []
  };
  const ledger = measureApartmentAreaLedger(floor);
  const audit = {
    sheetId: "sheet_05_terrace_plan",
    sheetName: "Sheet 05: Rooftop Services & Terrace Plan",
    grossAreaMm2: ledger.gross,
    accountedAreaMm2: ledger.accounted,
    deltaMm2: ledger.delta,
    unassignedMm2: ledger.unassigned,
    isPlanarConserved: Math.abs(ledger.delta) < 1e-3 && ledger.unassigned === 0
  };
  return { floor, audit };
}
function generateApartmentProjectSchedule(params) {
  const { config, siteSheet, stiltSheet, typicalSheet, refugeSheet, terraceSheet } = params;
  const plotAreaM2 = config.plotWidthMm * config.plotDepthMm / 1e6;
  const plotAreaSqFt = plotAreaM2 * 10.7639;
  const typicalFloor = typicalSheet.floor;
  const groundCoverageM2 = polygonArea2(typicalFloor.boundary) / 1e6;
  const groundCoveragePercent = groundCoverageM2 / plotAreaM2 * 100;
  const setbackAreaM2 = Math.max(0, plotAreaM2 - groundCoverageM2);
  const rosZones = siteSheet.siteZones.filter((z) => z.kind === "garden");
  const rosLandscapeAreaM2 = rosZones.reduce((sum, z) => sum + z.area, 0) / 1e6;
  const rosLandscapePercent = rosLandscapeAreaM2 / plotAreaM2 * 100;
  const roadW = config.roadWidthMm;
  const permissibleFsi = roadW >= 24e3 ? 3 : roadW >= 18e3 ? 2.5 : roadW >= 12e3 ? 2 : roadW >= 9e3 ? 1.5 : 1.2;
  const floorBuiltUpM2 = groundCoverageM2;
  const totalBuiltUpAreaM2 = floorBuiltUpM2 * config.numTypicalFloors;
  const consumedFsi = totalBuiltUpAreaM2 / plotAreaM2;
  const typicalLedger = measureApartmentAreaLedger(typicalFloor);
  const flatSchedule = [];
  let totalTypicalCarpetM2 = 0;
  for (const flat of typicalSheet.structure.flats) {
    const flatRooms = typicalFloor.rooms.filter((r) => r.unitId === flat.id);
    const carpetMm2 = flatRooms.filter((r) => r.spaceUse === "UNIT" && r.type !== RoomType.Balcony).reduce((sum, r) => sum + (typicalLedger.roomUsable[r.id] ?? r.area), 0);
    const balconyMm2 = flatRooms.filter((r) => r.spaceUse === "OUTDOOR" || r.type === RoomType.Balcony).reduce((sum, r) => sum + (typicalLedger.roomUsable[r.id] ?? r.area), 0);
    const carpetM2 = carpetMm2 / 1e6;
    const balconyM2 = balconyMm2 / 1e6;
    const totalUnitBuiltUpM2 = carpetM2 + balconyM2 + (carpetM2 + balconyM2) * 0.15;
    totalTypicalCarpetM2 += carpetM2;
    flatSchedule.push({
      flatId: flat.id,
      flatNumber: flat.label,
      bhkType: flat.unitType,
      reraCarpetAreaM2: Math.round(carpetM2 * 100) / 100,
      reraCarpetAreaSqFt: Math.round(carpetM2 * 10.7639),
      balconyAreaM2: Math.round(balconyM2 * 100) / 100,
      balconyAreaSqFt: Math.round(balconyM2 * 10.7639),
      totalBuiltUpAreaM2: Math.round(totalUnitBuiltUpM2 * 100) / 100,
      totalBuiltUpAreaSqFt: Math.round(totalUnitBuiltUpM2 * 10.7639)
    });
  }
  const totalReraCarpetAreaM2 = totalTypicalCarpetM2 * config.numTypicalFloors;
  const floorPlateEfficiencyPercent = totalTypicalCarpetM2 / floorBuiltUpM2 * 100;
  let reqCarStalls = 0;
  let req2WStalls = 0;
  for (const flat of typicalSheet.structure.flats) {
    if (flat.unitType === "2BHK") {
      reqCarStalls += 1;
      req2WStalls += 2;
    } else if (flat.unitType === "3BHK") {
      reqCarStalls += 1.5;
      req2WStalls += 2;
    } else if (flat.unitType === "4BHK") {
      reqCarStalls += 2;
      req2WStalls += 4;
    } else {
      reqCarStalls += 1;
      req2WStalls += 1;
    }
  }
  const visitorFactor = 1 + (config.visitorParkingPercent ?? 10) / 100;
  const totalReqCar = Math.ceil(reqCarStalls * config.numTypicalFloors * visitorFactor);
  const totalReq2W = Math.ceil(req2WStalls * config.numTypicalFloors * visitorFactor);
  const stackMult = config.parkingMode === "MECHANICAL_STACK" ? 2 : 1;
  const stiltCar = stiltSheet.carBaysCount * stackMult;
  const surfaceCar = siteSheet.siteZones.filter((z) => z.kind === "parking" && z.name.includes("Car")).length;
  const providedCar = stiltCar + surfaceCar;
  const stilt2W = stiltSheet.bikeBaysCount;
  const surface2W = siteSheet.siteZones.filter((z) => z.kind === "parking" && z.name.includes("2-Wheeler")).length * 4;
  const provided2W = stilt2W + surface2W;
  const parking = {
    requiredCarStalls: totalReqCar,
    providedCarStalls: providedCar,
    stiltCarStalls: stiltCar,
    surfaceCarStalls: surfaceCar,
    stackParkingMultiplier: stackMult,
    visitorCarStalls: Math.ceil(totalReqCar * 0.1),
    requiredTwoWheelerStalls: totalReq2W,
    providedTwoWheelerStalls: provided2W,
    visitorTwoWheelerStalls: Math.ceil(totalReq2W * 0.1)
  };
  const sheetAudits = [
    siteSheet.audit,
    stiltSheet.audit,
    typicalSheet.audit,
    ...refugeSheet ? [refugeSheet.audit] : [],
    terraceSheet.audit
  ];
  const overallDeltaMm2 = sheetAudits.reduce((sum, a) => sum + Math.abs(a.deltaMm2), 0);
  return {
    plotAreaM2: Math.round(plotAreaM2 * 100) / 100,
    plotAreaSqFt: Math.round(plotAreaSqFt),
    setbackAreaM2: Math.round(setbackAreaM2 * 100) / 100,
    groundCoverageM2: Math.round(groundCoverageM2 * 100) / 100,
    groundCoveragePercent: Math.round(groundCoveragePercent * 10) / 10,
    rosLandscapeAreaM2: Math.round(rosLandscapeAreaM2 * 100) / 100,
    rosLandscapePercent: Math.round(rosLandscapePercent * 10) / 10,
    permissibleFsi,
    consumedFsi: Math.round(consumedFsi * 100) / 100,
    totalBuiltUpAreaM2: Math.round(totalBuiltUpAreaM2 * 100) / 100,
    totalReraCarpetAreaM2: Math.round(totalReraCarpetAreaM2 * 100) / 100,
    floorPlateEfficiencyPercent: Math.round(floorPlateEfficiencyPercent * 10) / 10,
    flatSchedule,
    parking,
    sheetAudits,
    overallDeltaMm2
  };
}
function namespaceFloorEntities(floor) {
  const id = (value) => value.startsWith(`${floor.id}::`) ? value : `${floor.id}::${value}`;
  const reference = (value) => value ? id(value) : void 0;
  return {
    ...floor,
    rooms: floor.rooms.map((room) => ({ ...room, id: id(room.id), floorId: floor.id, bathroomOwnerRoomId: reference(room.bathroomOwnerRoomId) })),
    walls: floor.walls.map((wall) => ({ ...wall, id: id(wall.id), floorId: floor.id, roomIds: wall.roomIds.map(id), leftRoomId: reference(wall.leftRoomId), rightRoomId: reference(wall.rightRoomId) })),
    doors: floor.doors.map((door) => ({ ...door, id: id(door.id), floorId: floor.id, wallId: id(door.wallId), connectsRooms: [id(door.connectsRooms[0]), door.connectsRooms[1].startsWith("__") ? door.connectsRooms[1] : id(door.connectsRooms[1])] })),
    windows: floor.windows.map((window) => ({ ...window, id: id(window.id), floorId: floor.id, wallId: id(window.wallId), roomId: id(window.roomId) })),
    stairs: floor.stairs.map((stair) => ({ ...stair, id: id(stair.id), floorId: floor.id })),
    columns: floor.columns.map((column) => ({ ...column, id: id(column.id), floorId: floor.id })),
    beams: floor.beams?.map((beam) => ({ ...beam, id: id(beam.id), floorId: floor.id, startColumnId: reference(beam.startColumnId), endColumnId: reference(beam.endColumnId) })),
    canonicalStaircases: floor.canonicalStaircases?.map((stair) => ({ ...stair, id: id(stair.id), floorId: floor.id })),
    furniture: floor.furniture?.map((item) => ({ ...item, id: id(item.id), roomId: id(item.roomId) }))
  };
}
function solveMultiSheetApartmentProject(rawConfig, onStage) {
  const plotWidthMm = rawConfig.plotWidthMm ?? rawConfig.siteWidthMm ?? 5e4;
  const plotDepthMm = rawConfig.plotDepthMm ?? rawConfig.siteDepthMm ?? 5e4;
  const numTypicalFloors = rawConfig.numTypicalFloors ?? rawConfig.floorCount ?? 4;
  const roadWidthMm = rawConfig.roadWidthMm ?? 12e3;
  const roadAccessSides = rawConfig.roadAccessSides ?? [rawConfig.roadFacing ?? Direction.South];
  const lotAllotmentMode = rawConfig.lotAllotmentMode ?? "STATUTORY_SETBACK_100_PERCENT";
  const jurisdiction = rawConfig.jurisdiction ?? "pune_pmc";
  const verticalStackType = rawConfig.verticalStackType ?? "STILT_PLUS_N";
  const flatsPerFloor = rawConfig.flatsPerFloor ?? 4;
  const siteAmenities = rawConfig.siteAmenities ?? DEFAULT_SITE_AMENITIES2;
  const stiltAmenities = rawConfig.stiltAmenities ?? DEFAULT_STILT_AMENITIES2;
  const terraceAmenities = rawConfig.terraceAmenities ?? DEFAULT_TERRACE_AMENITIES2;
  const parkingMode = rawConfig.parkingMode ?? "STILT_AND_SURFACE";
  const config = {
    ...rawConfig,
    plotWidthMm,
    plotDepthMm,
    numTypicalFloors,
    roadWidthMm,
    roadAccessSides,
    lotAllotmentMode,
    jurisdiction,
    verticalStackType,
    flatsPerFloor,
    siteAmenities,
    stiltAmenities,
    terraceAmenities,
    parkingMode
  };
  const stackParams = computeBuildingStackParameters(config);
  let envelope;
  if (config.lotAllotmentMode === "FULL_LOT_100_PERCENT") {
    envelope = {
      x: 0,
      y: 0,
      w: config.plotWidthMm,
      h: config.plotDepthMm
    };
  } else {
    const { left, rear, right, front } = config.setbacksMm ?? { left: 3e3, rear: 3e3, right: 3e3, front: 4500 };
    envelope = {
      x: left,
      y: rear,
      w: config.plotWidthMm - left - right,
      h: config.plotDepthMm - rear - front
    };
  }
  if (envelope.w < 11e3 || envelope.h < 11e3) throw new Error("The requested setbacks leave too little buildable space for this apartment topology. Increase the plot or reduce the program.");
  onStage?.("UNIT_SPATIAL_SLICING");
  const macro = partitionMacroFootprint(envelope, config.flatsPerFloor);
  onStage?.("WALL_AND_OPENING_TOPOLOGY");
  const siteSheet = solveSitePlanSheet(config, envelope);
  const stiltSheet = solveStiltParkingSheet(config, envelope, macro, stackParams);
  const numFloors = Math.max(1, config.numTypicalFloors ?? 4);
  const residentialSheets = [];
  for (let fl = 1; fl <= numFloors; fl++) {
    residentialSheets.push(solveTypicalFloorSheet(config, envelope, config.verticalStackType === "G_PLUS_N" ? fl - 1 : fl));
  }
  const typicalSheet = residentialSheets[0];
  onStage?.("COLUMN_AND_BEAM_GRID");
  const columnScheduleSheet = solveStructuralColumnScheduleSheet(typicalSheet, envelope);
  let refugeSheet;
  if (stackParams.requiresRefugeFloor && stackParams.refugeFloorLevels.length > 0) {
    const primaryRefugeLevel = stackParams.refugeFloorLevels[0];
    refugeSheet = solveRefugeFloorSheet(typicalSheet, primaryRefugeLevel);
  }
  const terraceLevel = config.numTypicalFloors + (config.verticalStackType === "G_PLUS_N" ? 0 : 1);
  const terraceSheet = solveTerraceSheet(config, envelope, macro, terraceLevel);
  const schedule = generateApartmentProjectSchedule({
    config,
    siteSheet,
    stiltSheet,
    typicalSheet,
    refugeSheet,
    terraceSheet,
    stackParams
  });
  const sheetOffset = 103;
  const resSheetItems = residentialSheets.map((rs, idx) => {
    const fl = idx + 1;
    const flOrdinal = fl === 1 ? "1st" : fl === 2 ? "2nd" : fl === 3 ? "3rd" : `${fl}th`;
    const startFlat = fl * 100 + 1;
    const endFlat = fl * 100 + config.flatsPerFloor;
    return {
      sheetType: "TYPICAL_FLOOR_PLAN",
      sheetNumber: `A-${sheetOffset + idx}`,
      title: `Drawing 0${fl} \u2014 ${flOrdinal} Floor Plan (Flats ${startFlat} to ${endFlat})`,
      floor: rs.floor,
      audit: rs.audit
    };
  });
  const nextSheetNum = sheetOffset + residentialSheets.length;
  const sheets = [
    {
      sheetType: "SITE_PLAN",
      sheetNumber: "A-101",
      title: "Overall Site Layout & Landscape Master Plan",
      site: siteSheet.site,
      audit: siteSheet.audit
    },
    {
      sheetType: "STILT_PARKING_PLAN",
      sheetNumber: "A-102",
      title: "Stilt Floor Parking & Indoor Amenities Plan",
      floor: stiltSheet.floor,
      audit: stiltSheet.audit
    },
    ...resSheetItems,
    {
      sheetType: "COLUMN_SCHEDULE_PLAN",
      sheetNumber: `A-${nextSheetNum}`,
      title: "Structural Column Grid Layout & Schedule Sheet",
      floor: columnScheduleSheet.floor,
      audit: columnScheduleSheet.audit
    },
    ...refugeSheet ? [
      {
        sheetType: "REFUGE_FLOOR_PLAN",
        sheetNumber: `A-${nextSheetNum + 1}`,
        title: `Fire Refuge Floor Plan (Level ${stackParams.refugeFloorLevels[0]})`,
        floor: refugeSheet.floor,
        audit: refugeSheet.audit
      }
    ] : [],
    {
      sheetType: "TERRACE_PLAN",
      sheetNumber: `A-${nextSheetNum + (refugeSheet ? 2 : 1)}`,
      title: "Rooftop Services, Solar PV & Terrace Plan",
      floor: terraceSheet.floor,
      audit: terraceSheet.audit
    },
    {
      sheetType: "AREA_SCHEDULE_SHEET",
      sheetNumber: `A-${nextSheetNum + (refugeSheet ? 3 : 2)}`,
      title: "UDCPR / NBC FSI, RERA Carpet & Parking Statement",
      schedule,
      audit: {
        sheetId: "sheet_06_schedule",
        sheetName: "Sheet 06: Statutory Area Schedule",
        grossAreaMm2: schedule.sheetAudits.reduce((sum, a) => sum + a.grossAreaMm2, 0),
        accountedAreaMm2: schedule.sheetAudits.reduce((sum, a) => sum + a.accountedAreaMm2, 0),
        deltaMm2: schedule.overallDeltaMm2,
        unassignedMm2: 0,
        isPlanarConserved: schedule.overallDeltaMm2 < 1e-3
      }
    }
  ];
  const buildingFloors = [
    ...config.verticalStackType === "G_PLUS_N" ? [] : [stiltSheet.floor],
    ...residentialSheets.map((s) => refugeSheet && s.floor.level === refugeSheet.floor.level ? refugeSheet.floor : s.floor),
    terraceSheet.floor
  ];
  const rawBuilding = {
    regulatoryContext: config.regulatoryContext,
    id: config.projectId ? `building:${config.projectId}` : "multi_sheet_apartment_building",
    projectId: config.projectId ?? "apartment_project",
    name: config.projectName ?? "Coordinated Multi-Sheet Indian Residential Apartment",
    site: { ...siteSheet.site, roadFacing: config.roadAccessSides[0] ?? Direction.North, roadWidth: config.roadWidthMm },
    floors: buildingFloors.map((floor) => ({
      ...floor,
      floorUse: floor.id === terraceSheet.floor.id ? "ROOF" : floor.id === stiltSheet.floor.id ? "STILT_PARKING" : "RESIDENTIAL",
      elevationMm: floor.id === stiltSheet.floor.id ? 0 : buildingFloors.filter((other) => other.level < floor.level && other.id !== terraceSheet.floor.id).reduce((sum, other) => sum + other.floorHeight, 0),
      buildingId: config.projectId ? `building:${config.projectId}` : "multi_sheet_apartment_building"
    })),
    metadata: {
      projectId: config.projectId ?? "apartment_project",
      generationBrief: { source: "DETERMINISTIC", aiPrompt: config.aiPrompt, referenceImage: config.referenceImage ? { name: config.referenceImage.name, mimeType: config.referenceImage.mimeType } : void 0, units: config.units ?? [] },
      description: `Coordinated 6-Sheet Apartment Project (${config.flatsPerFloor} Flats/Floor, ${config.numTypicalFloors} Floors)`,
      tags: ["apartment", "multi_sheet", "udcpr", "rera", "canonical_model"]
    },
    version: 1,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  const buildingWithFurniture = populateCanonicalFurniture(rawBuilding);
  const deferredStructure = config.structuralLayoutMode !== "PROVISIONAL_EXISTING_PROFILE";
  const architecturalBuilding = deferredStructure ? { ...buildingWithFurniture, floors: buildingWithFurniture.floors.map((f) => ({ ...f, columns: [], beams: [] })), beams: [], metadata: { ...buildingWithFurniture.metadata, tags: [...buildingWithFurniture.metadata.tags ?? [], "STRUCTURAL_DESIGN_DEFERRED"] } } : buildingWithFurniture;
  const placedStructure = deferredStructure ? architecturalBuilding : new GeometryValidator().auditAndFixColumnAndBeamGrid(architecturalBuilding, true).building;
  const audit = validateAndRepairBuildingGeometry(placedStructure, { autoCorrect: false });
  const finalFloors = audit.building.floors.map(namespaceFloorEntities);
  const validatedBuilding = withArchitecturalElements(coordinateArchitecturalStairs({
    ...audit.building,
    floors: finalFloors,
    furniture: [...finalFloors.flatMap((floor) => floor.furniture ?? []), ...(audit.building.furniture ?? []).filter((item) => item.siteZoneId)]
  }));
  const validationReport = { ...audit.report, errors: audit.report.errors.map((error) => ({
    ...error,
    elementIds: error.elementIds.map((value) => value === error.floorId || value.startsWith(`${error.floorId}::`) ? value : `${error.floorId}::${value}`)
  })) };
  const validatedFloorsById = new Map(validatedBuilding.floors.map((f) => [f.id, f]));
  const updatedSheets = sheets.map((s) => {
    if (s.floor) {
      const updatedFloor = validatedFloorsById.get(s.floor.id);
      return { ...s, floor: updatedFloor ?? namespaceFloorEntities(s.floor) };
    }
    return s;
  });
  return {
    config,
    building: validatedBuilding,
    sheets: updatedSheets,
    schedule,
    validationReport,
    totalBuildingHeightMm: stackParams.totalBuildingHeightMm,
    hasRefugeFloor: stackParams.requiresRefugeFloor,
    refugeFloorLevels: stackParams.refugeFloorLevels
  };
}

// packages/planning-engine/src/layout/apartment-unit-packer.ts
var ApartmentUnitPacker = class {
  validate(building) {
    const errors = [];
    for (const f of building.floors.filter(
      (f2) => f2.floorUse === "RESIDENTIAL"
    )) {
      const ledger = measureApartmentAreaLedger(f);
      if (!f.apartmentUnits?.length)
        errors.push(
          infeasible(
            "No canonical apartment units are allocated.",
            [f.id],
            f.id
          )
        );
      for (const u of f.apartmentUnits ?? []) {
        const rooms = f.rooms.filter((r) => r.unitId === u.id), entries = f.doors.filter(
          (d) => d.connectsRooms.some((id) => rooms.some((r) => r.id === id)) && d.connectsRooms.some(
            (id) => f.rooms.some(
              (r) => r.id === id && !r.unitId && ["corridor", "foyer"].includes(r.type)
            )
          )
        );
        if (!entries.length || entries.some(
          (d) => !d.connectsRooms.some(
            (id) => rooms.some((r) => r.id === id && r.type === "living")
          )
        ))
          errors.push(
            infeasible(
              "Each unit entrance must connect common lobby directly to its living room.",
              [u.id, ...entries.map((d) => d.id)],
              f.id
            )
          );
        const bedrooms = /^([1-4])BHK$/.exec(u.unitType);
        if (!bedrooms || rooms.filter((r) => r.type === "bedroom").length !== Number(bedrooms[1]) || !rooms.some((r) => r.type === "kitchen") || !rooms.some((r) => r.type === "bathroom"))
          errors.push(
            infeasible(
              "Unit room inventory does not match its canonical BHK intent.",
              [u.id],
              f.id
            )
          );
        const reachable = new Set(
          rooms.filter((r) => r.type === "living").map((r) => r.id)
        );
        let changed = true;
        while (changed) {
          changed = false;
          for (const door of f.doors)
            if (door.width > 0 && door.connectsRooms.some((id) => reachable.has(id))) {
              for (const id of door.connectsRooms)
                if (rooms.some((r) => r.id === id) && !reachable.has(id)) {
                  reachable.add(id);
                  changed = true;
                }
            }
        }
        if (rooms.some((r) => !reachable.has(r.id)))
          errors.push(
            infeasible(
              "Private room has no explicit door/open-passage route from the living room.",
              [u.id],
              f.id
            )
          );
        for (const r of rooms) {
          if (["living", "bedroom"].includes(r.type)) {
            let area = 0;
            for (const w of f.windows.filter((w2) => w2.roomId === r.id)) {
              const m = measureWindowAdjacency({ ...f, windows: [w] }, r);
              if (!m.invalid.length && m.shaftIds.every(
                (id) => f.rooms.find((r2) => r2.id === id)?.type === "ots"
              ))
                area += m.areaMm2;
            }
            const usable = ledger.roomUsable[r.id];
            if (!ledger.supported || !usable || area < usable / 8)
              errors.push(
                infeasible(
                  "Habitable room lacks measured exterior/OTS window area >=1/8 of clear floor area (project policy).",
                  [r.id],
                  f.id
                )
              );
          }
          if (r.type === "bathroom" && !f.walls.some(
            (w) => w.roomIds.includes(r.id) && (w.type === "external" || w.roomIds.some(
              (id) => f.rooms.some(
                (s) => s.id === id && ["ots", "service_shaft"].includes(s.type)
              )
            ))
          ))
            errors.push(
              infeasible(
                "Wet room has no registered external/shaft plumbing adjacency.",
                [r.id],
                f.id
              )
            );
        }
      }
      const expected = {
        EXTERNAL: 230,
        UNIT_SEPARATION: 230,
        COMMON_CORRIDOR: 150,
        INTERNAL_PARTITION: 115,
        SHAFT: 100
      };
      for (const w of f.walls) {
        const width = expected[w.wallUse];
        if (width !== void 0 && w.thickness !== width)
          errors.push(
            infeasible(
              "Wall thickness differs from the explicit apartment hierarchy.",
              [w.id],
              f.id
            )
          );
        if (!w.wallUse)
          errors.push(
            infeasible(
              "Wall use is unclassified; thickness compliance cannot be inferred.",
              [w.id],
              f.id
            )
          );
      }
    }
    return solverResult(building, building, errors);
  }
  pack(config) {
    try {
      if (![config.plotWidthMm, config.plotDepthMm, config.roadWidthMm].every(
        (v) => Number.isFinite(v) && v > 0
      ) || !Number.isInteger(config.numTypicalFloors) || config.numTypicalFloors < 1 || config.numTypicalFloors > 40 || ![2, 3, 4].includes(config.flatsPerFloor) || config.units?.length !== config.flatsPerFloor)
        throw infeasible(
          "Invalid or incomplete canonical apartment generation requirements."
        );
      const b = solveMultiSheetApartmentProject(config).building;
      return this.validate(b);
    } catch (error) {
      throw infeasible(error instanceof Error ? error.message : String(error));
    }
  }
};

// packages/planning-engine/src/layout/opening-integrity-solver.ts
var OpeningIntegritySolver = class {
  jamb(f, d) {
    const w = f.walls.find((w2) => w2.id === d.wallId);
    if (!w) return null;
    const p = projectOnSegment(d.position, w.startPoint, w.endPoint);
    if (!p || ![d.width, d.height, d.position.x, d.position.y].every(Number.isFinite) || d.width <= 0 || d.height <= 0 || p.distance > w.thickness / 2 || p.along - d.width / 2 < 0 || p.along + d.width / 2 > p.length)
      return null;
    const returns = f.walls.filter(
      (r) => r.id !== w.id && Math.abs(
        (r.endPoint.x - r.startPoint.x) * (w.endPoint.x - w.startPoint.x) + (r.endPoint.y - r.startPoint.y) * (w.endPoint.y - w.startPoint.y)
      ) < 1e-3
    ).flatMap(
      (r) => [r.startPoint, r.endPoint].map((q) => ({
        projection: projectOnSegment(q, w.startPoint, w.endPoint),
        thickness: r.thickness
      }))
    ).filter((r) => r.projection && r.projection.distance <= w.thickness / 2);
    const clear = returns.map(
      (r) => Math.abs(p.along - r.projection.along) - d.width / 2 - r.thickness / 2
    );
    if (clear.some((x) => x < 0)) return null;
    return { p, returns, clearance: clear.length ? Math.min(...clear) : null };
  }
  validate(building) {
    const errors = [];
    for (const f of building.floors) {
      for (const d of f.doors) {
        const j = this.jamb(f, d);
        if (!j)
          errors.push(
            infeasible(
              "Door is unhosted, off wall, or outside the host span.",
              [d.id],
              f.id
            )
          );
        else if (!["sliding", "open_passage"].includes(d.type) && (j.clearance === null || j.clearance < 50 || j.clearance > 100))
          errors.push(
            infeasible(
              "Swing-door clear jamb must be 50\u2013100mm from a perpendicular return wall.",
              [d.id],
              f.id
            )
          );
        for (const win of f.windows.filter((w) => w.wallId === d.wallId)) {
          const host = f.walls.find((w) => w.id === d.wallId);
          if (!host) continue;
          const a = projectOnSegment(
            d.position,
            host.startPoint,
            host.endPoint
          ), b = projectOnSegment(win.position, host.startPoint, host.endPoint);
          if (a && b && Math.abs(a.along - b.along) < (d.width + win.width) / 2)
            errors.push(
              infeasible(
                "Door/window opening intervals intersect.",
                [d.id, win.id],
                f.id
              )
            );
        }
        const connected = d.connectsRooms.map(
          (id) => f.rooms.find((r) => r.id === id)
        );
        if (d.floorId !== f.id || d.connectsRooms[0] === d.connectsRooms[1] || !connected.some(Boolean) || connected.some((r) => !r) && f.walls.find((w) => w.id === d.wallId)?.type !== "external")
          errors.push(
            infeasible(
              "Opening semantic ownership or floor registration is invalid.",
              [d.id],
              f.id
            )
          );
        if (j && connected.some(
          (r) => r && (!isConvex(r.boundary) || !containsPolygon(r.boundary, {
            points: [
              j.p.pointAt(j.p.along - d.width / 2),
              d.position,
              j.p.pointAt(j.p.along + d.width / 2)
            ]
          }))
        ))
          errors.push(
            infeasible(
              "Opening no longer lies on the boundary of its semantic owner rooms.",
              [d.id],
              f.id
            )
          );
        if (connected.some((r) => r?.type === "bedroom") && !connected.every(Boolean) && !connected.some((r) => r?.type === "balcony" || r?.type === "utility"))
          errors.push(
            infeasible(
              "External bedroom door lacks a canonical balcony connection.",
              [d.id],
              f.id
            )
          );
      }
      for (const w of f.windows) {
        const host = f.walls.find((h) => h.id === w.wallId), q = host && projectOnSegment(w.position, host.startPoint, host.endPoint);
        if (!q || ![w.width, w.height].every(Number.isFinite) || w.width <= 0 || w.height <= 0 || q.distance > host.thickness / 2 || q.along - w.width / 2 < 0 || q.along + w.width / 2 > q.length) {
          errors.push(
            infeasible("Window is invalid or unhosted.", [w.id], f.id)
          );
          continue;
        }
        const poly = segmentFootprint(
          q.pointAt(q.along - w.width / 2),
          q.pointAt(q.along + w.width / 2),
          host.thickness
        );
        for (const d of f.doors) {
          const doorHost = f.walls.find((h) => h.id === d.wallId), p = doorHost && projectOnSegment(
            d.position,
            doorHost.startPoint,
            doorHost.endPoint
          );
          if (p && d.width > 0 && Number.isFinite(d.width) && hardeningOverlapArea(
            poly,
            segmentFootprint(
              p.pointAt(p.along - d.width / 2),
              p.pointAt(p.along + d.width / 2),
              doorHost.thickness
            )
          ) >= 1e-3)
            errors.push(
              infeasible(
                "Door/window physical aperture footprints intersect.",
                [d.id, w.id],
                f.id
              )
            );
        }
      }
      const cuts = floorOpeningFootprints(f);
      for (const column of f.columns)
        if (cuts.polygons.some(
          (c) => hardeningOverlapArea(columnFootprint(column), c.polygon) >= 1e-3
        ))
          errors.push(
            infeasible(
              "Column obstructs an aperture or conservative door swing envelope.",
              [column.id],
              f.id
            )
          );
      const swing = f.doors.filter(
        (d) => !["sliding", "open_passage"].includes(d.type)
      );
      for (let i = 0; i < swing.length; i++)
        for (let j = i + 1; j < swing.length; j++) {
          const a = swing[i], b = swing[j];
          if (Math.hypot(
            a.position.x - b.position.x,
            a.position.y - b.position.y
          ) < 1.5 * (a.width + b.width))
            errors.push(
              infeasible(
                "Conservative 90-degree swing envelopes conflict; handedness must be resolved.",
                [a.id, b.id],
                f.id
              )
            );
        }
    }
    return solverResult(building, building, errors);
  }
  solve(building) {
    const floors = building.floors.map((f) => {
      const chosen = [];
      for (const d of f.doors) {
        if (["sliding", "open_passage"].includes(d.type)) {
          chosen.push(d);
          continue;
        }
        const j = this.jamb(f, d);
        if (!j) {
          chosen.push(d);
          continue;
        }
        const targets = [
          j.p.along,
          ...j.returns.flatMap(
            (r) => [50, 75, 100].flatMap((gap) => [
              r.projection.along + r.thickness / 2 + gap + d.width / 2,
              r.projection.along - r.thickness / 2 - gap - d.width / 2
            ])
          )
        ].filter((t) => t >= d.width / 2 && t <= j.p.length - d.width / 2).sort((a, b) => Math.abs(a - j.p.along) - Math.abs(b - j.p.along)).slice(0, 32);
        const choice = targets.map((t) => ({ ...d, position: j.p.pointAt(t) })).find(
          (test) => this.validate({
            ...building,
            floors: [{ ...f, doors: [...chosen, test] }]
          }).accepted
        );
        chosen.push(choice ?? d);
      }
      return { ...f, doors: chosen };
    });
    const candidate = { ...building, floors }, audit = this.validate(candidate);
    return solverResult(building, candidate, audit.errors);
  }
};

// packages/planning-engine/src/pipeline/residential-layout-builder.ts
function buildResidentialLayout(config) {
  if (![config.plotWidthMm, config.plotDepthMm, config.roadWidthMm].every(
    (v) => Number.isFinite(v) && v > 0
  ) || !Number.isInteger(config.numTypicalFloors) || config.numTypicalFloors < 1 || config.numTypicalFloors > 40 || config.verticalStackType !== "STILT_PLUS_N" || config.flatsPerFloor !== 2 || config.units?.length !== 2 || config.units.some(
    (u) => !["2BHK", "3BHK"].includes(u.bhkType) || !Number.isInteger(u.unitIndex) || u.unitIndex < 1 || !Number.isInteger(u.attachedBathCount ?? 0) || (u.attachedBathCount ?? 0) < 0 || (u.attachedBathCount ?? 0) >= Number(u.bhkType[0])
  ) || new Set(config.units.map((u) => u.unitIndex)).size !== 2)
    throw infeasible(
      "ENVELOPE: supported brief requires positive dimensions, stilt, 1\u201340 residential levels and two explicitly specified 2BHK/3BHK units."
    );
  const facing = config.roadAccessSides[0] ?? Direction.North;
  const plot = config.plotBoundary ?? rectToPolygon(0, 0, config.plotWidthMm, config.plotDepthMm);
  const plotBounds = polygonBoundingBox(plot);
  if (Math.abs(plotBounds.width - config.plotWidthMm) > 1e-3 || Math.abs(plotBounds.height - config.plotDepthMm) > 1e-3)
    throw infeasible(
      "ENVELOPE: surveyed polygon extents disagree with declared plot dimensions."
    );
  const frame = residentialRoadFrame(plot, facing), localPlot = { points: plot.points.map(frame.toLocal) };
  const margins = config.setbacksMm ?? {
    front: 3e3,
    rear: 1500,
    left: 1500,
    right: 1500
  };
  const centreMargins = {
    front: margins.front + 115,
    rear: margins.rear + 115,
    left: margins.left + 115,
    right: margins.right + 115
  };
  const outer = permissibleResidentialEnvelope(
    localPlot,
    centreMargins,
    Direction.North
  );
  const inscribed = inscribedResidentialRectangle(outer), raw = rectangularBounds(inscribed);
  const width = Math.min(raw.width, 18e3), depth = Math.min(raw.height, 26e3);
  const x = raw.minX + (raw.width - width) / 2, y = raw.minY;
  if (width < 12e3 || depth < 18e3)
    throw infeasible(
      `ENVELOPE: at (${x}, ${y}) usable ${width} x ${depth} mm cannot fit the bounded two-wing residential topology.`
    );
  const slab = rectToPolygon(x, y, width, depth), bay = width / 3, balconyDepth = 1600;
  const gridEnvelope = rectToPolygon(
    x,
    y + balconyDepth,
    width,
    depth - balconyDepth
  );
  const rowCount = Math.ceil((depth - balconyDepth) / 6e3), row = (depth - balconyDepth) / rowCount;
  const stairY = y + balconyDepth + row, stairDepth = row, stairWidth = bay - 1500;
  if (row < 3600 || stairWidth < 2600)
    throw infeasible(
      `CORE_ANCHOR: insufficient flight/landing bay at (${x + bay}, ${stairY}).`
    );
  const initial = createBuilding({
    projectId: config.projectId ?? "residential-synthesis",
    name: config.projectName ?? "Residential synthesis",
    site: { plotWidth: config.plotWidthMm, plotDepth: config.plotDepthMm }
  });
  const buildingId = `synthesis:${config.projectId ?? "residential"}`;
  const groundOuter = raw.width === width && raw.height === depth ? outer : slab;
  const floors = [];
  const driveway = rectToPolygon(x + bay + 115, 0, bay - 230, stairY);
  const gate = {
    id: `${buildingId}:gate`,
    position: { x: x + 1.5 * bay, y: 0 },
    width: bay - 230,
    direction: Direction.North
  };
  const plotTop = Math.min(...localPlot.points.map((p) => p.y));
  if (plotTop !== 0) throw infeasible("ENVELOPE: unsupported road origin.");
  for (let level = 0; level <= config.numTypicalFloors + 1; level++) {
    const ground = level === 0, roof = level === config.numTypicalFloors + 1;
    const f0 = createFloor({
      buildingId,
      level,
      name: ground ? "Stilt" : roof ? "Terrace" : `Residential ${level}`,
      floorHeight: ground ? config.stiltHeightMm ?? 3300 : config.floorToFloorHeightMm ?? 3e3,
      boundary: ground || roof ? groundOuter : slab
    });
    const floorId = `${buildingId}:floor:${level}`;
    const rooms = [], links = [], units = [];
    const room = (name, type, rx, ry, w, h, unitId, tags = []) => {
      const r = {
        ...createRoom({
          floorId,
          type,
          name,
          x: rx,
          y: ry,
          width: w,
          height: h,
          tags: [...tags]
        }),
        id: `${floorId}:room:${name}`,
        unitId,
        spaceUse: unitId ? type === RoomType.Balcony ? "OUTDOOR" : "UNIT" : [RoomType.Staircase, RoomType.Lift].includes(type) ? "CORE" : "COMMON",
        clearHeightMm: f0.floorHeight - 250
      };
      const role = roof && type === RoomType.Staircase ? "STAIR_MUMTY" : name === "Common lift lobby" ? "LIFT_LOBBY" : ground && name === "Common entrance" ? "VEHICLE_AISLE" : architecturalSpaceRole(r);
      const semanticRoom = { ...r, architecturalRole: role };
      rooms.push(semanticRoom);
      return semanticRoom;
    };
    const commonFront = room(
      "Common entrance",
      ground ? RoomType.Parking : RoomType.Corridor,
      x + bay,
      y,
      bay,
      stairY - y,
      void 0,
      ground ? ["STILT_CIRCULATION"] : []
    );
    const stair = room(
      roof ? "Stair cover" : "Stair enclosure",
      RoomType.Staircase,
      x + bay,
      stairY,
      stairWidth,
      stairDepth
    );
    const beside = room(
      "Common stair lobby",
      RoomType.Corridor,
      x + bay + stairWidth,
      stairY,
      bay - stairWidth,
      stairDepth
    );
    const liftY = stairY + stairDepth, liftSize = 2100;
    const lift = room(
      "Lift well",
      RoomType.Lift,
      x + bay,
      liftY,
      liftSize,
      liftSize
    );
    const liftLobby = room(
      "Common lift lobby",
      RoomType.Corridor,
      x + bay + liftSize,
      liftY,
      bay - liftSize,
      liftSize
    );
    const backHeight = y + depth - liftY - liftSize;
    if (backHeight <= 1300)
      throw infeasible(`CORE_ANCHOR: no back lobby at (${x + bay}, ${liftY}).`);
    const machineRoomRequired = roof && config.architectureOptions?.liftSystem === "MACHINE_ROOM_REQUIRED";
    const back = room(
      machineRoomRequired ? "Lift equipment room" : roof ? "Open roof access" : "Common rear lobby",
      machineRoomRequired ? RoomType.Custom : roof ? RoomType.Terrace : RoomType.Corridor,
      x + bay,
      liftY + liftSize,
      bay,
      backHeight,
      void 0,
      machineRoomRequired ? ["LIFT_MACHINE_ROOM"] : []
    );
    const accessPoint = { x: x + bay + stairWidth / 2, y: stairY };
    links.push(
      {
        a: commonFront,
        b: stair,
        width: 1300,
        type: DoorType.OpenPassage,
        point: accessPoint
      },
      { a: commonFront, b: beside, width: 1200, type: DoorType.OpenPassage },
      { a: beside, b: liftLobby, width: 1200, type: DoorType.OpenPassage },
      { a: lift, b: liftLobby, width: 900, type: DoorType.Sliding },
      { a: liftLobby, b: back, width: 1200, type: DoorType.OpenPassage }
    );
    for (let side = 0; side < 2; side++) {
      const ux = x + side * 2 * bay, inner = side === 0 ? ux + bay : ux;
      if (ground) {
        const serviceX = side === 0 ? ux + 230 : ux + bay - 2e3 - 230;
        const service = room(
          side === 0 ? "Security cabin" : "Electrical meter room",
          RoomType.Custom,
          serviceX,
          y,
          2e3,
          2500,
          void 0,
          [side === 0 ? "SECURITY_CABIN" : "ELECTRICAL_METER_ROOM"]
        );
        const stallX = side === 0 ? ux + bay - 2615 : ux + 115;
        const stall = room(
          `C-0${side + 1}`,
          RoomType.Parking,
          stallX,
          y + 115,
          2500,
          5e3
        );
        const xs = [
          .../* @__PURE__ */ new Set([
            ux,
            ux + bay,
            service.x,
            service.x + service.width,
            stall.x,
            stall.x + stall.width
          ])
        ].sort((a, b2) => a - b2);
        const ys = [
          .../* @__PURE__ */ new Set([
            y,
            y + depth,
            service.y,
            service.y + service.height,
            stall.y,
            stall.y + stall.height
          ])
        ].sort((a, b2) => a - b2);
        for (let i = 1; i < xs.length; i++)
          for (let j = 1; j < ys.length; j++) {
            const mx = (xs[i] + xs[i - 1]) / 2, my = (ys[j] + ys[j - 1]) / 2;
            if ([service, stall].some(
              (r) => mx > r.x && mx < r.x + r.width && my > r.y && my < r.y + r.height
            ))
              continue;
            room(
              `Stilt circulation ${side}-${i}-${j}`,
              RoomType.Foyer,
              xs[i - 1],
              ys[j - 1],
              xs[i] - xs[i - 1],
              ys[j] - ys[j - 1]
            );
          }
      } else if (roof) {
        room(`Open terrace ${side}`, RoomType.Terrace, ux, y, bay, depth);
      } else {
        const spec = config.units[side], unitId = `${floorId}:unit:${spec.unitIndex}`;
        units.push({
          id: unitId,
          unitType: spec.bhkType,
          boundary: rectToPolygon(ux, y, bay, depth)
        });
        const balcony = room(
          `Unit ${side} balcony`,
          RoomType.Balcony,
          ux,
          y,
          bay,
          balconyDepth,
          unitId
        );
        const living = room(
          `Unit ${side} living`,
          RoomType.Living,
          ux,
          y + balconyDepth,
          bay,
          3600,
          unitId
        );
        const privateWidth = 1300, privateX = side === 0 ? ux + bay - privateWidth : ux, privateY = y + balconyDepth + 3600;
        const privatePassage = room(
          `Unit ${side} private passage`,
          RoomType.Corridor,
          privateX,
          privateY,
          privateWidth,
          y + depth - privateY,
          unitId
        );
        const outerX = side === 0 ? ux : ux + privateWidth, outerWidth = bay - privateWidth;
        const n = Number(spec.bhkType[0]), bedDepth = (y + depth - privateY - 2400 - n * 1200) / n;
        if (bedDepth < 2900)
          throw infeasible(
            `UNIT_PACKING: ${spec.bhkType} bedroom depth ${bedDepth} mm at (${outerX}, ${privateY}) is infeasible.`
          );
        const entryY = living.y + 115 + 75 + 1050 / 2;
        links.push(
          {
            a: commonFront,
            b: living,
            width: 1050,
            type: DoorType.Single,
            point: { x: inner, y: entryY }
          },
          {
            a: living,
            b: balcony,
            width: 1100,
            type: DoorType.Sliding,
            point: { x: side === 0 ? ux + bay - 850 : ux + 850, y: living.y }
          },
          {
            a: living,
            b: privatePassage,
            width: 1e3,
            type: DoorType.OpenPassage
          }
        );
        let ry = privateY;
        const kitchen = room(
          `Unit ${side} kitchen`,
          RoomType.Kitchen,
          outerX,
          ry,
          outerWidth,
          2400,
          unitId
        );
        ry += 2400;
        links.push({
          a: privatePassage,
          b: kitchen,
          width: 900,
          type: DoorType.OpenPassage
        });
        for (let k = 0; k < n; k++) {
          const bed = room(
            `Unit ${side} bedroom ${k + 1}`,
            RoomType.Bedroom,
            outerX,
            ry,
            outerWidth,
            bedDepth,
            unitId
          );
          ry += bedDepth;
          const bath = room(
            `Unit ${side} bath ${k + 1}`,
            RoomType.Bathroom,
            outerX,
            ry,
            outerWidth,
            k === n - 1 ? y + depth - ry : 1200,
            unitId
          );
          const attached = k < (spec.attachedBathCount ?? 0);
          rooms[rooms.indexOf(bath)] = {
            ...bath,
            bathroomOwnerRoomId: attached ? bed.id : void 0,
            bathroomAccessClass: attached ? "ATTACHED" : "COMMON"
          };
          ry = bath.y + bath.height;
          links.push(
            {
              a: privatePassage,
              b: bed,
              width: 900,
              type: DoorType.Single,
              point: {
                x: side === 0 ? privateX : privateX + privateWidth,
                y: bed.y + 57.5 + 75 + 450
              }
            },
            {
              a: attached ? bed : privatePassage,
              b: bath,
              width: 750,
              type: DoorType.Sliding
            }
          );
        }
      }
    }
    if (ground || roof)
      for (const [i, p] of residentialEnvelopeRemainder(
        groundOuter,
        slab
      ).entries()) {
        const bounds = polygonBoundingBox(p), r = room(
          `Skew circulation ${i}`,
          roof ? RoomType.Terrace : RoomType.Foyer,
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height
        );
        rooms[rooms.indexOf(r)] = {
          ...r,
          boundary: p,
          tags: [
            ...r.tags,
            "NON_RECTANGULAR_BOUNDARY",
            "NOMINAL_BOUNDING_BOX_AREA"
          ]
        };
      }
    const walls = buildWalls(floorId, rooms, ground, roof, links, config.architectureOptions?.guardHeightMm);
    const doors = links.map((link, i) => {
      const wall = walls.find(
        (w) => w.roomIds.includes(link.a.id) && w.roomIds.includes(link.b.id)
      );
      if (!wall)
        throw infeasible(
          `OPENING_REFINEMENT: no shared boundary for ${link.a.id} / ${link.b.id}.`
        );
      const point = link.point ?? {
        x: (wall.startPoint.x + wall.endPoint.x) / 2,
        y: (wall.startPoint.y + wall.endPoint.y) / 2
      };
      return {
        id: `${floorId}:door:${i}`,
        floorId,
        wallId: wall.id,
        position: point,
        width: link.width,
        height: 2100,
        type: link.type,
        swingDirection: SwingDirection.Inward,
        connectsRooms: [link.a.id, link.b.id]
      };
    });
    const windows = [];
    if (!ground && !roof)
      for (const r of rooms.filter(
        (r2) => r2.unitId && [RoomType.Living, RoomType.Bedroom, RoomType.Kitchen].includes(
          r2.type
        )
      )) {
        const host = walls.find(
          (w) => w.wallUse === "EXTERNAL" && w.roomIds.includes(r.id) && (r.type === RoomType.Living ? w.startPoint.y === r.y && w.endPoint.y === r.y : w.startPoint.x === w.endPoint.x)
        );
        if (!host)
          throw infeasible(
            `UNIT_PACKING: no exterior window host for ${r.id}.`
          );
        const living = r.type === RoomType.Living;
        const side = Number(r.name.split(" ")[1]);
        let position = living ? { x: side === 0 ? r.x + 1150 : r.x + r.width - 1150, y: r.y } : {
          x: host.startPoint.x,
          y: (host.startPoint.y + host.endPoint.y) / 2
        };
        const windowWidth = living ? 1600 : r.type === RoomType.Kitchen ? 900 : Math.max(1e3, r.area / 12e3);
        if (!living) {
          const low = Math.min(host.startPoint.y, host.endPoint.y) + windowWidth / 2 + 100, high = Math.max(host.startPoint.y, host.endPoint.y) - windowWidth / 2 - 100;
          const targets = [
            position.y,
            low,
            high,
            ...Array.from(
              { length: 9 },
              (_, i) => low + (high - low) * i / 8
            )
          ].filter((v) => v >= low && v <= high);
          const chosen = targets.find(
            (v) => Array.from(
              { length: rowCount + 1 },
              (_, i) => y + balconyDepth + i * row
            ).every((line) => Math.abs(line - v) >= windowWidth / 2 + 115)
          );
          if (chosen === void 0)
            throw infeasible(
              `OPENING_REFINEMENT: column-free exterior aperture unavailable for ${r.id}.`
            );
          position = { ...position, y: chosen };
        }
        windows.push({
          id: `${floorId}:window:${windows.length}`,
          floorId,
          wallId: host.id,
          roomId: r.id,
          position,
          width: windowWidth,
          height: r.type === RoomType.Bathroom ? 900 : 1500,
          sillHeight: 900,
          type: WindowType.Casement
        });
      }
    const clearWidth = (stairWidth - 230) / 2, landing = 1300;
    const canonical = {
      id: `${floorId}:stair`,
      floorId,
      polygon: stair.boundary,
      flight1: rectToPolygon(
        stair.x + 115,
        stair.y + 115,
        clearWidth,
        stairDepth - 230 - landing
      ),
      flight2: rectToPolygon(
        stair.x + 115 + clearWidth,
        stair.y + 115,
        clearWidth,
        stairDepth - 230 - landing
      ),
      midLanding: rectToPolygon(
        stair.x + 115,
        stair.y + stairDepth - 115 - landing,
        stairWidth - 230,
        landing
      ),
      riserCount: 18,
      treadWidthMm: 250,
      clearWidthMm: clearWidth,
      accessEdge: {
        type: "OPEN_PASSAGE",
        startPoint: { x: accessPoint.x - 650, y: stairY },
        endPoint: { x: accessPoint.x + 650, y: stairY }
      }
    };
    floors.push({
      ...f0,
      id: floorId,
      rooms,
      walls: walls.map((w) => ({
        ...w,
        hasOpening: doors.some((d) => d.wallId === w.id) || windows.some((v) => v.wallId === w.id)
      })),
      doors,
      windows,
      apartmentUnits: units,
      floorUse: ground ? "STILT_PARKING" : roof ? "ROOF" : "RESIDENTIAL",
      canonicalStaircases: [canonical],
      elevationMm: level === 0 ? 0 : (config.stiltHeightMm ?? 3300) + (level - 1) * (config.floorToFloorHeightMm ?? 3e3),
      parkingClearHeightMm: ground ? (config.stiltHeightMm ?? 3300) - 450 : void 0,
      slabThicknessMm: 150
    });
  }
  const b = {
    ...initial,
    id: buildingId,
    regulatoryContext: config.regulatoryContext,
    floors,
    site: {
      ...initial.site,
      id: `${buildingId}:site`,
      plotBoundary: localPlot,
      plotShape: rectangularBounds(localPlot) ? PlotShape.Rectangular : PlotShape.Irregular,
      plotArea: polygonArea2(localPlot),
      setbacks: margins,
      roadFacing: Direction.North,
      roadWidth: config.roadWidthMm,
      plannedFloorCount: config.numTypicalFloors + 2,
      accessPoints: [gate],
      siteZones: [
        {
          id: `${buildingId}:driveway`,
          kind: "vehicle_circulation",
          regulatoryUse: "DRIVEWAY",
          name: "Open stilt driveway",
          boundary: driveway,
          area: polygonArea2(driveway),
          accessLinks: [gate.id],
          source: "GENERATED",
          reviewStatus: "UNREVIEWED"
        }
      ]
    },
    metadata: {
      ...initial.metadata,
      tags: ["ASSERTED_FROM_BRIEF", "PROVISIONAL_STRUCTURAL_LAYOUT"],
      generationBrief: {
        source: "DETERMINISTIC",
        units: config.units.map((u) => ({
          unitIndex: u.unitIndex,
          bhkType: u.bhkType,
          targetCarpetSqFt: u.targetCarpetSqFt
        }))
      }
    }
  };
  return {
    building: transformBuilding(b, frame.fromLocal, facing, plot),
    structuralEnvelope: { points: gridEnvelope.points.map(frame.fromLocal) },
    permissibleEnvelope: { points: outer.points.map(frame.fromLocal) }
  };
}
function buildWalls(floorId, rooms, ground, roof, links, guardHeightMm = 1100) {
  const lines = /* @__PURE__ */ new Map();
  for (const r of rooms)
    r.boundary.points.forEach((a, i) => {
      const b = r.boundary.points[(i + 1) % r.boundary.points.length];
      if (a.x !== b.x && a.y !== b.y) return;
      const vertical = a.x === b.x, constant = vertical ? a.x : a.y;
      const start = Math.min(vertical ? a.y : a.x, vertical ? b.y : b.x), end = Math.max(vertical ? a.y : a.x, vertical ? b.y : b.x);
      const cuts = [
        .../* @__PURE__ */ new Set([
          start,
          end,
          ...rooms.flatMap(
            (q) => q.boundary.points.filter((p) => (vertical ? p.x : p.y) === constant).map((p) => vertical ? p.y : p.x)
          ).filter((v) => v > start && v < end)
        ])
      ].sort((a2, b2) => a2 - b2);
      for (let j = 1; j < cuts.length; j++) {
        const low = cuts[j - 1], high = cuts[j];
        if (high - low < 1e-6) continue;
        const key2 = `${vertical ? "v" : "h"}:${constant}:${low}:${high}`;
        const item = lines.get(key2) ?? {
          a: vertical ? { x: constant, y: low } : { x: low, y: constant },
          b: vertical ? { x: constant, y: high } : { x: high, y: constant },
          rooms: []
        };
        if (!item.rooms.includes(r)) item.rooms.push(r);
        lines.set(key2, item);
      }
    });
  const walls = [];
  for (const { a, b, rooms: owners } of lines.values()) {
    const core = owners.some(
      (r) => r.type === RoomType.Staircase || r.type === RoomType.Lift
    );
    const service = owners.some(
      (r) => r.tags.includes("SECURITY_CABIN") || r.tags.includes("ELECTRICAL_METER_ROOM")
    );
    if (ground && !core && !service && !links.some((link) => owners.includes(link.a) && owners.includes(link.b)))
      continue;
    let use = "INTERNAL_PARTITION", thickness = 115, type = WallType.Internal;
    if (owners.length === 1) {
      use = roof || owners[0].type === RoomType.Balcony ? "PARAPET" : "EXTERNAL";
      thickness = use === "PARAPET" ? 100 : 230;
      type = WallType.External;
    } else if (owners.some((r) => r.type === RoomType.Balcony)) {
      use = "EXTERNAL";
      thickness = 230;
      type = WallType.External;
    } else if (owners.some((r) => !!r.unitId) && owners.some((r) => !r.unitId)) {
      use = "UNIT_SEPARATION";
      thickness = 230;
    } else if (core) {
      use = "CORE";
      thickness = 230;
    } else if (owners.every((r) => !r.unitId)) {
      use = "COMMON_CORRIDOR";
      thickness = 150;
    }
    const boundaryRole = architecturalBoundaryRole(owners, owners.length === 1);
    walls.push({
      ...createWall({
        floorId,
        startPoint: a,
        endPoint: b,
        thickness,
        type,
        roomIds: owners.map((r) => r.id)
      }),
      id: `${floorId}:wall:${walls.length}`,
      wallUse: boundaryRole === "PARAPET" ? "PARAPET" : use,
      boundaryRole,
      heightMm: boundaryRole === "OPEN_BOUNDARY" ? 0 : boundaryRole === "PARAPET" ? guardHeightMm : void 0,
      unitIds: [
        ...new Set(owners.flatMap((r) => r.unitId ? [r.unitId] : []))
      ],
      loadBearing: use === "UNIT_SEPARATION" || use === "EXTERNAL",
      provenance: "PROVISIONAL_HEURISTIC"
    });
  }
  return walls;
}
function transformBuilding(b, map, facing, plot) {
  const poly = (p) => ({ points: p.points.map(map) });
  const floors = b.floors.map((f) => ({
    ...f,
    boundary: poly(f.boundary),
    rooms: f.rooms.map((r) => {
      const boundary = poly(r.boundary), bounds = polygonBoundingBox(boundary);
      return {
        ...r,
        boundary,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      };
    }),
    walls: f.walls.map((w) => ({
      ...w,
      startPoint: map(w.startPoint),
      endPoint: map(w.endPoint)
    })),
    doors: f.doors.map((d) => ({ ...d, position: map(d.position) })),
    windows: f.windows.map((w) => ({ ...w, position: map(w.position) })),
    apartmentUnits: f.apartmentUnits?.map((u) => ({
      ...u,
      boundary: poly(u.boundary)
    })),
    canonicalStaircases: f.canonicalStaircases?.map((s) => ({
      ...s,
      polygon: poly(s.polygon),
      flight1: poly(s.flight1),
      flight2: poly(s.flight2),
      midLanding: poly(s.midLanding),
      accessEdge: {
        ...s.accessEdge,
        startPoint: map(s.accessEdge.startPoint),
        endPoint: map(s.accessEdge.endPoint)
      }
    }))
  }));
  return {
    ...b,
    floors,
    site: {
      ...b.site,
      plotBoundary: plot,
      roadFacing: facing,
      accessPoints: b.site.accessPoints.map((g) => ({
        ...g,
        position: map(g.position),
        direction: facing
      })),
      siteZones: b.site.siteZones?.map((z) => ({
        ...z,
        boundary: poly(z.boundary)
      }))
    }
  };
}

// packages/planning-engine/src/pipeline/multi-story-residential-synthesizer.ts
var MultiStoryResidentialSynthesizer = class {
  synthesize(config) {
    let stage = "ENVELOPE_AND_CORE_ANCHOR";
    try {
      const layout = buildResidentialLayout(config), original = layout.building;
      let candidate = original;
      const stages = ["ENVELOPE_AND_CORE_ANCHOR"];
      const run = (name, solve) => {
        stage = name;
        const result = solve(candidate);
        if (!result.accepted) {
          const details = result.errors.slice(0, 12).map((e) => {
            const f = candidate.floors.find((f2) => f2.id === e.floorId);
            const door = f?.doors.find((d) => e.elementIds.includes(d.id));
            const column = f?.columns.find(
              (c) => e.elementIds.includes(c.id)
            );
            const room = f?.rooms.find((r) => e.elementIds.includes(r.id));
            const wall = f?.walls.find((w) => e.elementIds.includes(w.id));
            const p = door?.position ?? column?.position ?? room?.boundary.points[0] ?? wall?.startPoint;
            const origin = f?.boundary.points[0];
            const location = p ? ` at (${p.x}, ${p.y})` : origin ? ` (floor origin ${origin.x}, ${origin.y})` : "";
            return `${e.floorId ?? "project"} [${e.elementIds.join(", ")}]${location}: ${e.message}`;
          }).join("; ");
          throw new SolverGeometryInfeasibleError(
            `${stage}: ${details}`,
            result.errors.flatMap((e) => [...e.elementIds])
          );
        }
        candidate = result.building;
        stages.push(name);
      };
      run(
        "COLUMN_GRID",
        (b) => new ColumnGridGenerator().generate(b, layout.structuralEnvelope)
      );
      run("STILT_LAYOUT", (b) => new StiltLevelEnclosureGuard().solve(b));
      run(
        "TYPICAL_FLOOR_PACKING",
        (b) => new ApartmentUnitPacker().validate(b)
      );
      run("BEAM_NETWORK", (b) => new BeamNetworkGenerator().generate(b));
      run("OPENING_REFINEMENT", (b) => new OpeningIntegritySolver().solve(b));
      run(
        "TERRACE_AND_CORE_CONTINUITY",
        (b) => new VerticalCoreContinuitySolver().solve(b)
      );
      run(
        "FINAL_PLANAR_AND_GEOMETRY_ACCEPTANCE",
        (b) => solverResult(b, b, residentialAcceptanceErrors(b))
      );
      const building = withArchitecturalElements(coordinateArchitecturalStairs({
        ...candidate,
        version: original.version + 1,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        canonicalStaircases: candidate.floors.flatMap(
          (f) => f.canonicalStaircases ?? []
        )
      }));
      return {
        ...solverResult(original, building, []),
        statutoryStatus: "INTERNAL_GATES_PASSED",
        professionalReviewRequired: true,
        structuralEnvelope: layout.structuralEnvelope,
        permissibleEnvelope: layout.permissibleEnvelope,
        stages,
        floorLedgers: building.floors.map((f) => ({
          floorId: f.id,
          buildingRevision: building.version,
          ledger: measureApartmentAreaLedger(f)
        })),
        openings: building.floors.map((f) => ({
          floorId: f.id,
          doorIds: f.doors.map((d) => d.id),
          windowIds: f.windows.map((w) => w.id),
          buildingRevision: building.version
        }))
      };
    } catch (error) {
      if (error instanceof SolverGeometryInfeasibleError) throw error;
      throw new SolverGeometryInfeasibleError(
        `${stage}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
};

// packages/planning-engine/src/structural/hardened-residential-generation.ts
function generateHardenedResidential(config) {
  const result = new MultiStoryResidentialSynthesizer().synthesize(config);
  if (!result.accepted) return result;
  const evidence = Object.fromEntries(result.building.floors.flatMap((f) => [...f.doors, ...f.windows].map((o) => [o.id, "CENTER"])));
  return { ...result, building: migrateOpeningGeometry(result.building, evidence) };
}

// packages/backend/src/services/export-selection.ts
var ExportError = class extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
};

// packages/backend/src/services/structural-analysis-engine.ts
var StructuralAnalysisEngine = class {
  generateComprehensiveModel(_building) {
    throw new ExportError("NATIVE_ANALYSIS_REQUIRED", "NOT_ANALYZED: reviewed structural inputs and revision-bound native analysis evidence are required.", 409);
  }
};

// packages/backend/src/services/etabs-report-pdf.ts
async function generateETABSAnalysisPdfReport(_model) {
  throw new ExportError(
    "NATIVE_ANALYSIS_REQUIRED",
    "NOT_VERIFIED: legacy structural report payloads cannot establish native ETABS evidence.",
    409
  );
}

// packages/backend/src/services/structural-drawings-service.ts
var StructuralDrawingsService = class {
  async generateStructuralDrawingPackage(_building) {
    throw new ExportError(
      "REVIEWED_STRUCTURAL_MODEL_REQUIRED",
      "NOT_VERIFIED: architectural geometry cannot supply approved structural sections, foundations or reinforcement.",
      409
    );
  }
};

// scripts/verify-structural-exports.mjs
var require2 = createRequire(import.meta.url);
var { PDFDocument } = require2("../packages/backend/node_modules/pdf-lib");
var outDir = path.resolve("test-artifacts/verified-structural-exports");
fs.mkdirSync(outDir, { recursive: true });
async function main() {
  console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
  console.log(" RH PLANNER \u2014 P3.3 STRUCTURAL DRAWINGS & REPORT VERIFICATION PIPELINE");
  console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n");
  console.log("[1/4] Synthesizing reviewed multi-storey residential project...");
  const res = generateHardenedResidential({
    projectId: "rh-structural-p3-project",
    plotWidthMm: 18e3,
    plotDepthMm: 25e3,
    roadWidthMm: 12e3,
    roadAccessSides: ["north" /* North */],
    lotAllotmentMode: "STATUTORY_SETBACK_100_PERCENT",
    jurisdiction: "generic_maharashtra",
    verticalStackType: "STILT_PLUS_N",
    numTypicalFloors: 3,
    flatsPerFloor: 2,
    units: [
      { unitIndex: 1, bhkType: "2BHK", hasUtilityBalcony: true },
      { unitIndex: 2, bhkType: "2BHK", hasUtilityBalcony: true }
    ],
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    parkingMode: "STILT_ONLY"
  });
  const building = res.building;
  console.log(`  Project: "${building.name}" (${building.floors.length} storeys: Stilt, Floor 1, Floor 2, Floor 3, Terrace)`);
  console.log("\n[2/4] Generating comprehensive structural framing model (IS 456, IS 1893:2016)...");
  const engine = new StructuralAnalysisEngine();
  const model = engine.generateComprehensiveModel(building);
  console.log(`  Grids generated: ${model.gridLines.length} grid lines (X: A..${String.fromCharCode(64 + model.gridLines.filter((g) => g.axis === "X").length)}, Y: 1..${model.gridLines.filter((g) => g.axis === "Y").length})`);
  console.log(`  Columns extracted/synthesized: ${model.columns.length} columns`);
  console.log(`  Beams framed: ${model.beams.length} framing beams`);
  console.log(`  Slabs scheduled: ${model.slabs.length} slab panels`);
  console.log(`  Footings sized: ${model.footings.length} shallow isolated footings (SBC = 200 kPa)`);
  console.log(`  Base reactions: ${model.reactions.length} support reaction nodes`);
  console.log(`  Seismic Base Shear Vb: ${model.summary.baseShearKn} kN (Zone III, Z=0.16, R=5.0, I=1.2)`);
  console.log(`  Max Storey Drift Ratio: ${model.summary.maxDriftRatio} vs Allowable: ${model.summary.allowableDriftRatio} -> ${model.summary.overallStatus}`);
  const jsonPath = path.join(outDir, `${building.id}_structural_model.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(model, null, 2));
  const jsonSha = createHash("sha256").update(fs.readFileSync(jsonPath)).digest("hex");
  console.log(`  Written: ${jsonPath} (${fs.statSync(jsonPath).size} bytes, SHA-256: ${jsonSha.slice(0, 16)})`);
  console.log("\n[3/4] Generating 4-page ETABS Structural Analysis PDF Report (ISO 32000-1)...");
  const reportPdfBytes = await generateETABSAnalysisPdfReport(model);
  const reportDoc = await PDFDocument.load(reportPdfBytes, { throwOnInvalidObject: true });
  const reportPageCount = reportDoc.getPageCount();
  const reportPath = path.join(outDir, `${building.id}_ETABS_Structural_Analysis_Report.pdf`);
  fs.writeFileSync(reportPath, reportPdfBytes);
  const reportSha = createHash("sha256").update(reportPdfBytes).digest("hex");
  console.log(`  Verified PDF pages: ${reportPageCount} A4 pages`);
  console.log(`  Written: ${reportPath} (${reportPdfBytes.length} bytes, SHA-256: ${reportSha.slice(0, 16)})`);
  console.log("\n[4/4] Generating ISO A3 Landscape Structural CAD Drawing Set (S-101 to S-104)...");
  const drawingsService = new StructuralDrawingsService();
  const drawingsResult = await drawingsService.generateStructuralDrawingPackage(building);
  const drawingsDoc = await PDFDocument.load(drawingsResult.data, { throwOnInvalidObject: true });
  const drawingsPageCount = drawingsDoc.getPageCount();
  const drawingsPath = path.join(outDir, `${building.id}_Structural_Drawings_S101_S104.pdf`);
  fs.writeFileSync(drawingsPath, drawingsResult.data);
  const drawingsSha = createHash("sha256").update(drawingsResult.data).digest("hex");
  console.log(`  Verified CAD sheets: ${drawingsPageCount} ISO A3 Landscape sheets`);
  for (let i = 0; i < drawingsPageCount; i++) {
    const page = drawingsDoc.getPage(i);
    console.log(`    Sheet S-10${i + 1}: ${page.getWidth().toFixed(1)} x ${page.getHeight().toFixed(1)} pt (ISO A3 Landscape: 1190.6 x 841.9 pt)`);
  }
  console.log(`  Written: ${drawingsPath} (${drawingsResult.data.length} bytes, SHA-256: ${drawingsSha.slice(0, 16)})`);
  console.log("\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
  console.log(" STRUCTURAL REPORTING & DRAWING PIPELINE VERIFICATION SUCCESSFUL");
  console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
}
main().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
