/**
 * 27+ Standard Plancraft Architectural CAD SVG Symbols.
 * Generated from @plancraft/furniture elements/default.
 */

export interface PlancraftSymbolDefinition {
  readonly viewBox: string;
  readonly viewBoxWidth: number;
  readonly viewBoxHeight: number;
  readonly inner: string;
}

export const PLANCRAFT_SVG_SYMBOLS: Record<string, PlancraftSymbolDefinition> = {
  "bathtub": {
    viewBox: "0 0 700 1700",
    viewBoxWidth: 700,
    viewBoxHeight: 1700,
    inner: "<!-- Outer shell -->\n  <rect x=\"0\" y=\"0\" width=\"700\" height=\"1700\" rx=\"60\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Inner basin -->\n  <rect x=\"50\" y=\"50\" width=\"600\" height=\"1600\" rx=\"50\" fill=\"#f0f0f0\" stroke=\"black\" stroke-width=\"5\"/>\n  <!-- Drain -->\n  <circle cx=\"350\" cy=\"1500\" r=\"30\" fill=\"#a0a0a0\" stroke=\"black\" stroke-width=\"3\"/>\n  <!-- Faucet area -->\n  <circle cx=\"350\" cy=\"120\" r=\"35\" fill=\"#a0a0a0\" stroke=\"black\" stroke-width=\"3\"/>\n  <circle cx=\"280\" cy=\"120\" r=\"18\" fill=\"#b0b0b0\" stroke=\"black\" stroke-width=\"2\"/>\n  <circle cx=\"420\" cy=\"120\" r=\"18\" fill=\"#b0b0b0\" stroke=\"black\" stroke-width=\"2\"/>",
  },
  "bed": {
    viewBox: "0 0 1400 2000",
    viewBoxWidth: 1400,
    viewBoxHeight: 2000,
    inner: "<!-- Frame -->\n  <rect x=\"0\" y=\"0\" width=\"1400\" height=\"2000\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Headboard -->\n  <rect x=\"0\" y=\"0\" width=\"1400\" height=\"120\" fill=\"#c0c0c0\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Left pillow -->\n  <rect x=\"80\" y=\"200\" width=\"540\" height=\"360\" rx=\"40\" fill=\"#f0f0f0\" stroke=\"black\" stroke-width=\"5\"/>\n  <!-- Right pillow -->\n  <rect x=\"780\" y=\"200\" width=\"540\" height=\"360\" rx=\"40\" fill=\"#f0f0f0\" stroke=\"black\" stroke-width=\"5\"/>\n  <!-- Blanket fold line -->\n  <line x1=\"80\" y1=\"900\" x2=\"1320\" y2=\"900\" stroke=\"black\" stroke-width=\"4\" stroke-dasharray=\"20,10\"/>",
  },
  "bookshelf": {
    viewBox: "0 0 800 350",
    viewBoxWidth: 800,
    viewBoxHeight: 350,
    inner: "<!-- Body -->\n  <rect x=\"0\" y=\"0\" width=\"800\" height=\"350\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"6\"/>\n  <!-- Shelf dividers (horizontal) -->\n  <line x1=\"0\" y1=\"88\" x2=\"800\" y2=\"88\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"0\" y1=\"175\" x2=\"800\" y2=\"175\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"0\" y1=\"263\" x2=\"800\" y2=\"263\" stroke=\"black\" stroke-width=\"4\"/>\n  <!-- Vertical divider -->\n  <line x1=\"400\" y1=\"0\" x2=\"400\" y2=\"350\" stroke=\"black\" stroke-width=\"4\"/>",
  },
  "car": {
    viewBox: "0 0 1800 4200",
    viewBoxWidth: 1800,
    viewBoxHeight: 4200,
    inner: "<!-- Body -->\n  <rect x=\"0\" y=\"0\" width=\"1800\" height=\"4200\" rx=\"300\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"10\"/>\n  <!-- Windshield -->\n  <rect x=\"150\" y=\"600\" width=\"1500\" height=\"500\" rx=\"40\" fill=\"#d8d8d8\" stroke=\"black\" stroke-width=\"6\"/>\n  <!-- Rear window -->\n  <rect x=\"200\" y=\"3100\" width=\"1400\" height=\"400\" rx=\"40\" fill=\"#d8d8d8\" stroke=\"black\" stroke-width=\"6\"/>\n  <!-- Front left wheel -->\n  <rect x=\"-30\" y=\"400\" width=\"120\" height=\"350\" rx=\"30\" fill=\"#a0a0a0\" stroke=\"black\" stroke-width=\"5\"/>\n  <!-- Front right wheel -->\n  <rect x=\"1710\" y=\"400\" width=\"120\" height=\"350\" rx=\"30\" fill=\"#a0a0a0\" stroke=\"black\" stroke-width=\"5\"/>\n  <!-- Rear left wheel -->\n  <rect x=\"-30\" y=\"3200\" width=\"120\" height=\"350\" rx=\"30\" fill=\"#a0a0a0\" stroke=\"black\" stroke-width=\"5\"/>\n  <!-- Rear right wheel -->\n  <rect x=\"1710\" y=\"3200\" width=\"120\" height=\"350\" rx=\"30\" fill=\"#a0a0a0\" stroke=\"black\" stroke-width=\"5\"/>\n  <!-- Hood line -->\n  <line x1=\"200\" y1=\"350\" x2=\"1600\" y2=\"350\" stroke=\"black\" stroke-width=\"4\"/>\n  <!-- Trunk line -->\n  <line x1=\"200\" y1=\"3700\" x2=\"1600\" y2=\"3700\" stroke=\"black\" stroke-width=\"4\"/>",
  },
  "chair": {
    viewBox: "0 0 450 450",
    viewBoxWidth: 450,
    viewBoxHeight: 450,
    inner: "<!-- Seat -->\n  <rect x=\"25\" y=\"80\" width=\"400\" height=\"370\" rx=\"20\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"6\"/>\n  <!-- Backrest -->\n  <rect x=\"25\" y=\"0\" width=\"400\" height=\"100\" rx=\"20\" fill=\"#c0c0c0\" stroke=\"black\" stroke-width=\"6\"/>",
  },
  "coffee_table": {
    viewBox: "0 0 1200 600",
    viewBoxWidth: 1200,
    viewBoxHeight: 600,
    inner: "<!-- Table top -->\n  <rect x=\"0\" y=\"0\" width=\"1200\" height=\"600\" rx=\"30\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"6\"/>\n  <!-- Lower shelf -->\n  <rect x=\"80\" y=\"80\" width=\"1040\" height=\"440\" rx=\"20\" fill=\"#d8d8d8\" stroke=\"black\" stroke-width=\"3\"/>",
  },
  "conference_table": {
    viewBox: "0 0 2400 1200",
    viewBoxWidth: 2400,
    viewBoxHeight: 1200,
    inner: "<!-- Table top -->\n  <rect x=\"0\" y=\"0\" width=\"2400\" height=\"1200\" rx=\"80\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Legs -->\n  <rect x=\"100\" y=\"100\" width=\"80\" height=\"80\" fill=\"#a0a0a0\" stroke=\"black\" stroke-width=\"4\"/>\n  <rect x=\"2220\" y=\"100\" width=\"80\" height=\"80\" fill=\"#a0a0a0\" stroke=\"black\" stroke-width=\"4\"/>\n  <rect x=\"100\" y=\"1020\" width=\"80\" height=\"80\" fill=\"#a0a0a0\" stroke=\"black\" stroke-width=\"4\"/>\n  <rect x=\"2220\" y=\"1020\" width=\"80\" height=\"80\" fill=\"#a0a0a0\" stroke=\"black\" stroke-width=\"4\"/>\n  <!-- Center support -->\n  <rect x=\"1100\" y=\"400\" width=\"200\" height=\"400\" rx=\"20\" fill=\"#d0d0d0\" stroke=\"black\" stroke-width=\"4\"/>",
  },
  "counter": {
    viewBox: "0 0 3000 600",
    viewBoxWidth: 3000,
    viewBoxHeight: 600,
    inner: "<!-- Counter body -->\n  <rect x=\"0\" y=\"0\" width=\"3000\" height=\"600\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Sink basin -->\n  <rect x=\"1200\" y=\"100\" width=\"600\" height=\"400\" rx=\"30\" fill=\"#d8d8d8\" stroke=\"black\" stroke-width=\"5\"/>\n  <!-- Faucet -->\n  <circle cx=\"1500\" cy=\"150\" r=\"25\" fill=\"#a0a0a0\" stroke=\"black\" stroke-width=\"3\"/>\n  <!-- Cabinet dividers -->\n  <line x1=\"750\" y1=\"20\" x2=\"750\" y2=\"580\" stroke=\"black\" stroke-width=\"3\"/>\n  <line x1=\"2250\" y1=\"20\" x2=\"2250\" y2=\"580\" stroke=\"black\" stroke-width=\"3\"/>",
  },
  "desk": {
    viewBox: "0 0 1200 600",
    viewBoxWidth: 1200,
    viewBoxHeight: 600,
    inner: "<!-- Desktop -->\n  <rect x=\"0\" y=\"0\" width=\"1200\" height=\"600\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Drawer unit (right) -->\n  <rect x=\"800\" y=\"60\" width=\"340\" height=\"480\" fill=\"#d0d0d0\" stroke=\"black\" stroke-width=\"6\"/>\n  <!-- Drawer lines -->\n  <line x1=\"820\" y1=\"220\" x2=\"1120\" y2=\"220\" stroke=\"black\" stroke-width=\"3\"/>\n  <line x1=\"820\" y1=\"380\" x2=\"1120\" y2=\"380\" stroke=\"black\" stroke-width=\"3\"/>\n  <!-- Drawer handles -->\n  <line x1=\"950\" y1=\"140\" x2=\"990\" y2=\"140\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"950\" y1=\"300\" x2=\"990\" y2=\"300\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"950\" y1=\"460\" x2=\"990\" y2=\"460\" stroke=\"black\" stroke-width=\"4\"/>",
  },
  "executive_desk": {
    viewBox: "0 0 1800 900",
    viewBoxWidth: 1800,
    viewBoxHeight: 900,
    inner: "<!-- Desktop -->\n  <rect x=\"0\" y=\"0\" width=\"1800\" height=\"900\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Left drawer unit -->\n  <rect x=\"60\" y=\"60\" width=\"450\" height=\"780\" fill=\"#d0d0d0\" stroke=\"black\" stroke-width=\"6\"/>\n  <line x1=\"80\" y1=\"320\" x2=\"490\" y2=\"320\" stroke=\"black\" stroke-width=\"3\"/>\n  <line x1=\"80\" y1=\"580\" x2=\"490\" y2=\"580\" stroke=\"black\" stroke-width=\"3\"/>\n  <!-- Right drawer unit -->\n  <rect x=\"1290\" y=\"60\" width=\"450\" height=\"780\" fill=\"#d0d0d0\" stroke=\"black\" stroke-width=\"6\"/>\n  <line x1=\"1310\" y1=\"320\" x2=\"1720\" y2=\"320\" stroke=\"black\" stroke-width=\"3\"/>\n  <line x1=\"1310\" y1=\"580\" x2=\"1720\" y2=\"580\" stroke=\"black\" stroke-width=\"3\"/>\n  <!-- Drawer handles -->\n  <line x1=\"265\" y1=\"190\" x2=\"305\" y2=\"190\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"265\" y1=\"450\" x2=\"305\" y2=\"450\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"265\" y1=\"710\" x2=\"305\" y2=\"710\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"1495\" y1=\"190\" x2=\"1535\" y2=\"190\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"1495\" y1=\"450\" x2=\"1535\" y2=\"450\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"1495\" y1=\"710\" x2=\"1535\" y2=\"710\" stroke=\"black\" stroke-width=\"4\"/>",
  },
  "filing_cabinet": {
    viewBox: "0 0 400 600",
    viewBoxWidth: 400,
    viewBoxHeight: 600,
    inner: "<!-- Body -->\n  <rect x=\"0\" y=\"0\" width=\"400\" height=\"600\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"6\"/>\n  <!-- Drawer 1 -->\n  <rect x=\"20\" y=\"20\" width=\"360\" height=\"170\" fill=\"#d8d8d8\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"180\" y1=\"95\" x2=\"220\" y2=\"95\" stroke=\"black\" stroke-width=\"5\"/>\n  <!-- Drawer 2 -->\n  <rect x=\"20\" y=\"210\" width=\"360\" height=\"170\" fill=\"#d8d8d8\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"180\" y1=\"285\" x2=\"220\" y2=\"285\" stroke=\"black\" stroke-width=\"5\"/>\n  <!-- Drawer 3 -->\n  <rect x=\"20\" y=\"400\" width=\"360\" height=\"170\" fill=\"#d8d8d8\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"180\" y1=\"475\" x2=\"220\" y2=\"475\" stroke=\"black\" stroke-width=\"5\"/>",
  },
  "floor_lamp": {
    viewBox: "0 0 300 300",
    viewBoxWidth: 300,
    viewBoxHeight: 300,
    inner: "<!-- Base -->\n  <circle cx=\"150\" cy=\"150\" r=\"130\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"5\"/>\n  <!-- Shade outline -->\n  <circle cx=\"150\" cy=\"150\" r=\"90\" fill=\"#f0f0f0\" stroke=\"black\" stroke-width=\"4\"/>\n  <!-- Pole -->\n  <circle cx=\"150\" cy=\"150\" r=\"20\" fill=\"#a0a0a0\" stroke=\"black\" stroke-width=\"3\"/>",
  },
  "fridge": {
    viewBox: "0 0 700 700",
    viewBoxWidth: 700,
    viewBoxHeight: 700,
    inner: "<!-- Body -->\n  <rect x=\"0\" y=\"0\" width=\"700\" height=\"700\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Door divider (freezer/fridge) -->\n  <line x1=\"0\" y1=\"220\" x2=\"700\" y2=\"220\" stroke=\"black\" stroke-width=\"5\"/>\n  <!-- Top handle (freezer) -->\n  <line x1=\"620\" y1=\"80\" x2=\"620\" y2=\"180\" stroke=\"black\" stroke-width=\"5\"/>\n  <!-- Bottom handle (fridge) -->\n  <line x1=\"620\" y1=\"280\" x2=\"620\" y2=\"420\" stroke=\"black\" stroke-width=\"5\"/>",
  },
  "l_sofa": {
    viewBox: "0 0 2400 2000",
    viewBoxWidth: 2400,
    viewBoxHeight: 2000,
    inner: "<!-- Horizontal section back -->\n  <rect x=\"0\" y=\"0\" width=\"2400\" height=\"200\" fill=\"#c0c0c0\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Horizontal section seat -->\n  <rect x=\"0\" y=\"200\" width=\"2400\" height=\"700\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Vertical section back (right side) -->\n  <rect x=\"2200\" y=\"200\" width=\"200\" height=\"1800\" fill=\"#c0c0c0\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Vertical section seat -->\n  <rect x=\"1500\" y=\"900\" width=\"700\" height=\"1100\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Cushion dividers horizontal -->\n  <line x1=\"200\" y1=\"250\" x2=\"200\" y2=\"850\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"850\" y1=\"250\" x2=\"850\" y2=\"850\" stroke=\"black\" stroke-width=\"4\"/>\n  <!-- Cushion dividers vertical -->\n  <line x1=\"1550\" y1=\"950\" x2=\"2150\" y2=\"950\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"1550\" y1=\"1500\" x2=\"2150\" y2=\"1500\" stroke=\"black\" stroke-width=\"4\"/>",
  },
  "office_chair": {
    viewBox: "0 0 550 550",
    viewBoxWidth: 550,
    viewBoxHeight: 550,
    inner: "<!-- Seat -->\n  <circle cx=\"275\" cy=\"295\" r=\"220\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"6\"/>\n  <!-- Backrest -->\n  <rect x=\"75\" y=\"0\" width=\"400\" height=\"140\" rx=\"40\" fill=\"#c0c0c0\" stroke=\"black\" stroke-width=\"6\"/>\n  <!-- Armrests -->\n  <rect x=\"30\" y=\"120\" width=\"60\" height=\"250\" rx=\"15\" fill=\"#d0d0d0\" stroke=\"black\" stroke-width=\"4\"/>\n  <rect x=\"460\" y=\"120\" width=\"60\" height=\"250\" rx=\"15\" fill=\"#d0d0d0\" stroke=\"black\" stroke-width=\"4\"/>\n  <!-- Casters (5-star base) -->\n  <circle cx=\"275\" cy=\"295\" r=\"30\" fill=\"#a0a0a0\" stroke=\"black\" stroke-width=\"3\"/>",
  },
  "oven": {
    viewBox: "0 0 600 600",
    viewBoxWidth: 600,
    viewBoxHeight: 600,
    inner: "<!-- Body -->\n  <rect x=\"0\" y=\"0\" width=\"600\" height=\"600\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Oven door -->\n  <rect x=\"40\" y=\"100\" width=\"520\" height=\"460\" fill=\"#d8d8d8\" stroke=\"black\" stroke-width=\"5\"/>\n  <!-- Door window -->\n  <rect x=\"120\" y=\"160\" width=\"360\" height=\"200\" rx=\"10\" fill=\"#f0f0f0\" stroke=\"black\" stroke-width=\"4\"/>\n  <!-- Handle -->\n  <line x1=\"160\" y1=\"60\" x2=\"440\" y2=\"60\" stroke=\"black\" stroke-width=\"6\"/>",
  },
  "round_table": {
    viewBox: "0 0 1000 1000",
    viewBoxWidth: 1000,
    viewBoxHeight: 1000,
    inner: "<!-- Table top -->\n  <circle cx=\"500\" cy=\"500\" r=\"480\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Center pedestal -->\n  <circle cx=\"500\" cy=\"500\" r=\"80\" fill=\"#a0a0a0\" stroke=\"black\" stroke-width=\"4\"/>",
  },
  "sectional_sofa": {
    viewBox: "0 0 3000 2200",
    viewBoxWidth: 3000,
    viewBoxHeight: 2200,
    inner: "<!-- Horizontal section back -->\n  <rect x=\"0\" y=\"0\" width=\"3000\" height=\"220\" fill=\"#c0c0c0\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Horizontal section seat -->\n  <rect x=\"0\" y=\"220\" width=\"3000\" height=\"800\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Right arm -->\n  <rect x=\"2800\" y=\"220\" width=\"200\" height=\"800\" fill=\"#d0d0d0\" stroke=\"black\" stroke-width=\"6\"/>\n  <!-- Chaise back (left) -->\n  <rect x=\"0\" y=\"220\" width=\"220\" height=\"2000\" fill=\"#c0c0c0\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Chaise seat -->\n  <rect x=\"220\" y=\"1020\" width=\"1000\" height=\"1180\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Cushion dividers (horizontal section) -->\n  <line x1=\"1220\" y1=\"270\" x2=\"1220\" y2=\"970\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"2000\" y1=\"270\" x2=\"2000\" y2=\"970\" stroke=\"black\" stroke-width=\"4\"/>\n  <!-- Chaise cushion divider -->\n  <line x1=\"270\" y1=\"1600\" x2=\"1170\" y2=\"1600\" stroke=\"black\" stroke-width=\"4\"/>",
  },
  "shower": {
    viewBox: "0 0 900 900",
    viewBoxWidth: 900,
    viewBoxHeight: 900,
    inner: "<!-- Shower tray -->\n  <rect x=\"0\" y=\"0\" width=\"900\" height=\"900\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Drain -->\n  <circle cx=\"450\" cy=\"450\" r=\"40\" fill=\"#d0d0d0\" stroke=\"black\" stroke-width=\"4\"/>\n  <!-- Drain grate pattern -->\n  <line x1=\"420\" y1=\"450\" x2=\"480\" y2=\"450\" stroke=\"black\" stroke-width=\"3\"/>\n  <line x1=\"450\" y1=\"420\" x2=\"450\" y2=\"480\" stroke=\"black\" stroke-width=\"3\"/>\n  <!-- Shower head position -->\n  <circle cx=\"150\" cy=\"150\" r=\"60\" fill=\"none\" stroke=\"black\" stroke-width=\"4\" stroke-dasharray=\"12,8\"/>\n  <!-- Glass door arc -->\n  <path d=\"M 0 900 A 900 900 0 0 1 900 0\" fill=\"none\" stroke=\"black\" stroke-width=\"4\" stroke-dasharray=\"15,10\"/>",
  },
  "sink": {
    viewBox: "0 0 500 400",
    viewBoxWidth: 500,
    viewBoxHeight: 400,
    inner: "<!-- Counter/vanity -->\n  <rect x=\"0\" y=\"0\" width=\"500\" height=\"400\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"6\"/>\n  <!-- Basin -->\n  <ellipse cx=\"250\" cy=\"220\" rx=\"170\" ry=\"130\" fill=\"#d8d8d8\" stroke=\"black\" stroke-width=\"5\"/>\n  <!-- Drain -->\n  <circle cx=\"250\" cy=\"240\" r=\"20\" fill=\"#a0a0a0\" stroke=\"black\" stroke-width=\"3\"/>\n  <!-- Faucet -->\n  <circle cx=\"250\" cy=\"60\" r=\"22\" fill=\"#a0a0a0\" stroke=\"black\" stroke-width=\"3\"/>\n  <line x1=\"250\" y1=\"82\" x2=\"250\" y2=\"120\" stroke=\"black\" stroke-width=\"4\"/>",
  },
  "sofa": {
    viewBox: "0 0 2000 900",
    viewBoxWidth: 2000,
    viewBoxHeight: 900,
    inner: "<!-- Back -->\n  <rect x=\"0\" y=\"0\" width=\"2000\" height=\"200\" fill=\"#c0c0c0\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Seat -->\n  <rect x=\"0\" y=\"200\" width=\"2000\" height=\"700\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Left arm -->\n  <rect x=\"0\" y=\"200\" width=\"150\" height=\"700\" fill=\"#d0d0d0\" stroke=\"black\" stroke-width=\"6\"/>\n  <!-- Right arm -->\n  <rect x=\"1850\" y=\"200\" width=\"150\" height=\"700\" fill=\"#d0d0d0\" stroke=\"black\" stroke-width=\"6\"/>\n  <!-- Cushion dividers -->\n  <line x1=\"667\" y1=\"250\" x2=\"667\" y2=\"850\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"1333\" y1=\"250\" x2=\"1333\" y2=\"850\" stroke=\"black\" stroke-width=\"4\"/>",
  },
  "spiral_staircase": {
    viewBox: "0 0 1500 1500",
    viewBoxWidth: 1500,
    viewBoxHeight: 1500,
    inner: "<!-- Outer circle -->\n  <circle cx=\"750\" cy=\"750\" r=\"720\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Center pole -->\n  <circle cx=\"750\" cy=\"750\" r=\"60\" fill=\"#a0a0a0\" stroke=\"black\" stroke-width=\"6\"/>\n  <!-- Radial step lines -->\n  <line x1=\"750\" y1=\"750\" x2=\"750\" y2=\"30\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"750\" y1=\"750\" x2=\"1259\" y2=\"240\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"750\" y1=\"750\" x2=\"1470\" y2=\"750\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"750\" y1=\"750\" x2=\"1259\" y2=\"1259\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"750\" y1=\"750\" x2=\"750\" y2=\"1470\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"750\" y1=\"750\" x2=\"240\" y2=\"1259\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"750\" y1=\"750\" x2=\"30\" y2=\"750\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"750\" y1=\"750\" x2=\"240\" y2=\"240\" stroke=\"black\" stroke-width=\"4\"/>\n  <!-- Direction arrow arc -->\n  <path d=\"M 750 80 A 670 670 0 0 1 1370 750\" fill=\"none\" stroke=\"black\" stroke-width=\"5\"/>\n  <polygon points=\"1370,750 1320,690 1320,810\" fill=\"black\"/>",
  },
  "staircase": {
    viewBox: "0 0 900 2500",
    viewBoxWidth: 900,
    viewBoxHeight: 2500,
    inner: "<!-- Outline -->\n  <rect x=\"0\" y=\"0\" width=\"900\" height=\"2500\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Steps (10 treads) -->\n  <line x1=\"0\" y1=\"250\" x2=\"900\" y2=\"250\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"0\" y1=\"500\" x2=\"900\" y2=\"500\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"0\" y1=\"750\" x2=\"900\" y2=\"750\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"0\" y1=\"1000\" x2=\"900\" y2=\"1000\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"0\" y1=\"1250\" x2=\"900\" y2=\"1250\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"0\" y1=\"1500\" x2=\"900\" y2=\"1500\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"0\" y1=\"1750\" x2=\"900\" y2=\"1750\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"0\" y1=\"2000\" x2=\"900\" y2=\"2000\" stroke=\"black\" stroke-width=\"4\"/>\n  <line x1=\"0\" y1=\"2250\" x2=\"900\" y2=\"2250\" stroke=\"black\" stroke-width=\"4\"/>\n  <!-- Direction arrow -->\n  <line x1=\"450\" y1=\"2300\" x2=\"450\" y2=\"200\" stroke=\"black\" stroke-width=\"5\"/>\n  <polygon points=\"450,150 400,300 500,300\" fill=\"black\"/>",
  },
  "stove": {
    viewBox: "0 0 600 600",
    viewBoxWidth: 600,
    viewBoxHeight: 600,
    inner: "<!-- Body -->\n  <rect x=\"0\" y=\"0\" width=\"600\" height=\"600\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Top-left burner -->\n  <circle cx=\"180\" cy=\"180\" r=\"80\" fill=\"none\" stroke=\"black\" stroke-width=\"5\"/>\n  <circle cx=\"180\" cy=\"180\" r=\"40\" fill=\"none\" stroke=\"black\" stroke-width=\"3\"/>\n  <!-- Top-right burner -->\n  <circle cx=\"420\" cy=\"180\" r=\"80\" fill=\"none\" stroke=\"black\" stroke-width=\"5\"/>\n  <circle cx=\"420\" cy=\"180\" r=\"40\" fill=\"none\" stroke=\"black\" stroke-width=\"3\"/>\n  <!-- Bottom-left burner -->\n  <circle cx=\"180\" cy=\"420\" r=\"80\" fill=\"none\" stroke=\"black\" stroke-width=\"5\"/>\n  <circle cx=\"180\" cy=\"420\" r=\"40\" fill=\"none\" stroke=\"black\" stroke-width=\"3\"/>\n  <!-- Bottom-right burner -->\n  <circle cx=\"420\" cy=\"420\" r=\"80\" fill=\"none\" stroke=\"black\" stroke-width=\"5\"/>\n  <circle cx=\"420\" cy=\"420\" r=\"40\" fill=\"none\" stroke=\"black\" stroke-width=\"3\"/>",
  },
  "table": {
    viewBox: "0 0 1200 800",
    viewBoxWidth: 1200,
    viewBoxHeight: 800,
    inner: "<!-- Table top -->\n  <rect x=\"0\" y=\"0\" width=\"1200\" height=\"800\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Legs -->\n  <rect x=\"40\" y=\"40\" width=\"60\" height=\"60\" fill=\"#a0a0a0\" stroke=\"black\" stroke-width=\"4\"/>\n  <rect x=\"1100\" y=\"40\" width=\"60\" height=\"60\" fill=\"#a0a0a0\" stroke=\"black\" stroke-width=\"4\"/>\n  <rect x=\"40\" y=\"700\" width=\"60\" height=\"60\" fill=\"#a0a0a0\" stroke=\"black\" stroke-width=\"4\"/>\n  <rect x=\"1100\" y=\"700\" width=\"60\" height=\"60\" fill=\"#a0a0a0\" stroke=\"black\" stroke-width=\"4\"/>",
  },
  "toilet": {
    viewBox: "0 0 400 700",
    viewBoxWidth: 400,
    viewBoxHeight: 700,
    inner: "<!-- Tank -->\n  <rect x=\"50\" y=\"0\" width=\"300\" height=\"180\" rx=\"20\" fill=\"#d0d0d0\" stroke=\"black\" stroke-width=\"6\"/>\n  <!-- Bowl -->\n  <ellipse cx=\"200\" cy=\"450\" rx=\"180\" ry=\"230\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"6\"/>\n  <!-- Seat opening -->\n  <ellipse cx=\"200\" cy=\"480\" rx=\"120\" ry=\"160\" fill=\"#f0f0f0\" stroke=\"black\" stroke-width=\"4\"/>",
  },
  "tv_console": {
    viewBox: "0 0 1800 450",
    viewBoxWidth: 1800,
    viewBoxHeight: 450,
    inner: "<!-- Console body -->\n  <rect x=\"0\" y=\"0\" width=\"1800\" height=\"450\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"6\"/>\n  <!-- Left cabinet -->\n  <rect x=\"20\" y=\"20\" width=\"500\" height=\"410\" fill=\"#d8d8d8\" stroke=\"black\" stroke-width=\"4\"/>\n  <!-- Center open shelf -->\n  <rect x=\"560\" y=\"20\" width=\"680\" height=\"410\" fill=\"#f0f0f0\" stroke=\"black\" stroke-width=\"4\"/>\n  <!-- Shelf divider -->\n  <line x1=\"560\" y1=\"225\" x2=\"1240\" y2=\"225\" stroke=\"black\" stroke-width=\"3\"/>\n  <!-- Right cabinet -->\n  <rect x=\"1280\" y=\"20\" width=\"500\" height=\"410\" fill=\"#d8d8d8\" stroke=\"black\" stroke-width=\"4\"/>",
  },
  "wardrobe": {
    viewBox: "0 0 1000 500",
    viewBoxWidth: 1000,
    viewBoxHeight: 500,
    inner: "<!-- Body -->\n  <rect x=\"0\" y=\"0\" width=\"1000\" height=\"500\" fill=\"#e8e8e8\" stroke=\"black\" stroke-width=\"8\"/>\n  <!-- Door divider -->\n  <line x1=\"500\" y1=\"0\" x2=\"500\" y2=\"500\" stroke=\"black\" stroke-width=\"6\"/>\n  <!-- Left door handle -->\n  <line x1=\"460\" y1=\"220\" x2=\"460\" y2=\"280\" stroke=\"black\" stroke-width=\"5\"/>\n  <!-- Right door handle -->\n  <line x1=\"540\" y1=\"220\" x2=\"540\" y2=\"280\" stroke=\"black\" stroke-width=\"5\"/>",
  },
  "whiteboard": {
    viewBox: "0 0 1800 100",
    viewBoxWidth: 1800,
    viewBoxHeight: 100,
    inner: "<!-- Board body -->\n  <rect x=\"0\" y=\"0\" width=\"1800\" height=\"100\" fill=\"#f0f0f0\" stroke=\"black\" stroke-width=\"6\"/>\n  <!-- Frame -->\n  <rect x=\"5\" y=\"5\" width=\"1790\" height=\"90\" fill=\"none\" stroke=\"#a0a0a0\" stroke-width=\"3\"/>\n  <!-- Tray -->\n  <rect x=\"200\" y=\"80\" width=\"1400\" height=\"20\" fill=\"#d0d0d0\" stroke=\"black\" stroke-width=\"3\"/>",
  },
};
