import json
from pathlib import Path
import sys
from deck_topology import coordinate_deck

archive, output = map(Path, sys.argv[1:])
report = {}
for name in ("original", "second"):
    floors = json.loads((archive / (name + ".architecture.json")).read_bytes())["floors"]
    system = json.loads((archive / (name + ".snapshot.json")).read_bytes())["system"]
    rows = []
    for floor in floors:
        top = floor["elevationMm"] + floor["floorHeight"]
        owners = [f for f in floors if f["elevationMm"] == top]
        row = {"supportingFloorId": floor["id"], "frameTopMm": top}
        if len(owners) == 1:
            deck = coordinate_deck(owners[0], system["physicalModel"]["beams"], supporting_floor=floor, registered_surface=True)
            row.update({k:deck[k] for k in ("floorId","footprintAreaMm2","openingAreaMm2","deckAreaMm2","retainedLandingAreaMm2","gapMm2","overlapMm2")})
            row["stairComponents"] = deck["stairComponents"]
            row["status"] = "REGISTERED_SURFACE_CANDIDATE"
        else:
            row["status"] = "SURFACE_OWNERSHIP_REVIEW_REQUIRED"
        rows.append(row)
    report[name]={"architectureSha256":system["sourceArchitecturalSha256"],"floors":rows}
output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
