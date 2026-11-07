/**
 * Indian Apartment Multi-Floor Configuration & Strategy Model (§12).
 *
 * Supports distinct programs across:
 * - Ground Floor
 * - Podium Parking Floor
 * - Typical Residential Floor
 * - Amenity Floor
 * - Terrace Level
 */

export type ApartmentFloorType = 'ground' | 'podium' | 'typical' | 'amenity' | 'terrace';

export interface FloorSpaceProgramItem {
  readonly id: string;
  readonly name: string;
  readonly category: 'residential' | 'core' | 'parking' | 'amenity' | 'services' | 'circulation';
  readonly minAreaSqM: number;
  readonly description: string;
}

export interface FloorConfigurationProgram {
  readonly floorType: ApartmentFloorType;
  readonly title: string;
  readonly description: string;
  readonly spaces: readonly FloorSpaceProgramItem[];
  readonly allowsResidentialFlats: boolean;
  readonly allowsStairCore: boolean;
  readonly allowsLiftCore: boolean;
}

export const FLOOR_PROGRAMS: Record<ApartmentFloorType, FloorConfigurationProgram> = {
  ground: {
    floorType: 'ground',
    title: 'Ground / Stilt Floor',
    description: 'Building entrance, grand double-height entrance lobby, surface & stilt parking, security cabin, driveway, transformer yard, and service rooms.',
    allowsResidentialFlats: false,
    allowsStairCore: true,
    allowsLiftCore: true,
    spaces: [
      { id: 'entrance_lobby', name: 'Grand Entrance Lobby', category: 'core', minAreaSqM: 35.0, description: 'Double height entrance foyer & visitor reception' },
      { id: 'security_cabin', name: 'Security & Access Control', category: 'amenity', minAreaSqM: 9.0, description: 'CCTV control room and boom barrier desk' },
      { id: 'stilt_parking', name: 'Stilt & Surface Parking Bays', category: 'parking', minAreaSqM: 120.0, description: 'Covered stilt car and two-wheeler parking' },
      { id: 'electrical_substation', name: 'Electrical Substation / Meter Room', category: 'services', minAreaSqM: 15.0, description: 'LT panel, transformer connection, and energy meters' },
      { id: 'fire_pump_room', name: 'Fire Pump & Water Tank Room', category: 'services', minAreaSqM: 18.0, description: 'Hydrant and sprinkler boosting system' },
      { id: 'driveway_circulation', name: 'Peripheral Driveway (6m wide)', category: 'circulation', minAreaSqM: 150.0, description: 'Emergency fire tender movement access' },
    ],
  },
  podium: {
    floorType: 'podium',
    title: 'Podium Parking Level',
    description: 'Elevated multi-level car and two-wheeler parking with one-way ramp circulation and mechanical ventilation.',
    allowsResidentialFlats: false,
    allowsStairCore: true,
    allowsLiftCore: true,
    spaces: [
      { id: 'podium_parking_bays', name: 'Podium Covered Parking Bays', category: 'parking', minAreaSqM: 250.0, description: 'Multi-car parking bays (2.5m x 5.0m per car)' },
      { id: 'vehicular_ramp', name: 'Vehicular Ramp (1:8 slope)', category: 'circulation', minAreaSqM: 60.0, description: 'Connecting ramp between ground and podium levels' },
      { id: 'podium_lift_lobby', name: 'Podium Lift & Stair Lobby', category: 'core', minAreaSqM: 15.0, description: 'Direct access to residential tower core' },
    ],
  },
  typical: {
    floorType: 'typical',
    title: 'Typical Residential Floor',
    description: 'Standard floor plate housing private residential apartments (2BHK / 3BHK) clustered around a central core (lifts, fire stairs, common lobby, OTS ducts).',
    allowsResidentialFlats: true,
    allowsStairCore: true,
    allowsLiftCore: true,
    spaces: [
      { id: 'residential_flats', name: 'Residential Tenements', category: 'residential', minAreaSqM: 180.0, description: 'Exact flat count and unit mix (2BHK / 3BHK)' },
      { id: 'passenger_lifts', name: 'Passenger Lifts', category: 'core', minAreaSqM: 10.0, description: 'High speed 8-13 passenger elevators' },
      { id: 'main_staircase', name: 'Enclosed Main Staircase', category: 'core', minAreaSqM: 14.0, description: 'Naturally ventilated staircase with fire doors' },
      { id: 'fire_escape_stair', name: 'External Fire Escape Staircase', category: 'core', minAreaSqM: 14.0, description: 'Pressurized / external fire evacuation staircase' },
      { id: 'common_lobby', name: 'Central Lift Lobby & Corridor', category: 'circulation', minAreaSqM: 20.0, description: '1.5m wide naturally ventilated common circulation' },
      { id: 'service_shafts', name: 'Plumbing & Electrical Shafts (OTS)', category: 'services', minAreaSqM: 8.0, description: 'Wet utility and electrical distribution risers' },
    ],
  },
  amenity: {
    floorType: 'amenity',
    title: 'Dedicated Amenity / Clubhouse Floor',
    description: 'Recreational facilities for residents, including clubhouse, gymnasium, indoor games, community hall, and landscaped terrace deck.',
    allowsResidentialFlats: false,
    allowsStairCore: true,
    allowsLiftCore: true,
    spaces: [
      { id: 'fitness_gym', name: 'Gymnasium & Yoga Studio', category: 'amenity', minAreaSqM: 60.0, description: 'Equipped fitness and aerobic workout area' },
      { id: 'community_hall', name: 'Multi-Purpose Community Hall', category: 'amenity', minAreaSqM: 90.0, description: 'Resident association events and party hall' },
      { id: 'indoor_games', name: 'Indoor Games Room', category: 'amenity', minAreaSqM: 40.0, description: 'Table tennis, billiards, and board games lounge' },
      { id: 'restrooms', name: 'Restrooms & Changing Rooms', category: 'services', minAreaSqM: 15.0, description: 'Gents, ladies, and accessible toilets' },
    ],
  },
  terrace: {
    floorType: 'terrace',
    title: 'Rooftop Terrace & Services Level',
    description: 'Overhead water tanks, lift machine rooms, solar PV array, refuge terrace area, and landscaped sky garden.',
    allowsResidentialFlats: false,
    allowsStairCore: true,
    allowsLiftCore: true,
    spaces: [
      { id: 'overhead_water_tank', name: 'Overhead Domestic & Fire Water Tanks', category: 'services', minAreaSqM: 25.0, description: 'Gravity distribution domestic and fire reserve tanks' },
      { id: 'lift_machine_room', name: 'Lift Machine Room (LMR)', category: 'services', minAreaSqM: 16.0, description: 'Traction equipment and elevator controller panels' },
      { id: 'solar_pv_zone', name: 'Solar PV & Solar Water Heating', category: 'services', minAreaSqM: 60.0, description: 'Rooftop renewable solar array installation' },
      { id: 'rooftop_garden', name: 'Sky Terrace & Landscaped Seating', category: 'amenity', minAreaSqM: 80.0, description: 'Open-air resident leisure and viewing deck' },
    ],
  },
};

export function getFloorConfigurationProgram(floorType: ApartmentFloorType): FloorConfigurationProgram {
  return FLOOR_PROGRAMS[floorType] ?? FLOOR_PROGRAMS.typical;
}
