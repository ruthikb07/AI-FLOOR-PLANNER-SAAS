"""Replay the exact archived apartment inputs through the registered deck mesher."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys
from time import perf_counter

from automatic_mesh import generate_floor
from deck_topology import coordinate_deck


def replay(archive, baseline, historical):
    buildings = {}
    for name, expected in baseline.items():
        inputs = {}
        for kind, digest in expected["fileSha256"].items():
            contents = (archive / f"{name}.{kind}.json").read_bytes()
            if hashlib.sha256(contents).hexdigest() != digest:
                raise ValueError(f"Archived {name} {kind} differs from the checkpoint")
            inputs[kind] = json.loads(contents)
        system = inputs["snapshot"]["system"]
        if system["sourceArchitecturalSha256"] != expected["architecturalDigest"]:
            raise ValueError(f"Unexpected canonical architecture for {name}")
        floors = inputs["architecture"]["floors"]
        beams = system["physicalModel"]["beams"]
        frame, elements = system["nodes"], system["elements"]
        archived_loads = historical[name]
        before = {floor["floorId"]: floor for floor in archived_loads["floors"]}
        first_free = len(frame)
        rows = []
        for floor in floors:
            start = perf_counter()
            top = floor["elevationMm"] + floor["floorHeight"]
            owners = [owner for owner in floors if owner["elevationMm"] == top]
            row = {"supportingFloorId": floor["id"], "frameTopMm": top,
                   "historicalSlabLoadsKn": before[floor["id"]]["slabLoadsKn"]}
            if len(owners) != 1:
                row["status"] = "SURFACE_OWNERSHIP_REVIEW_REQUIRED"
            else:
                deck = coordinate_deck(owners[0], beams, supporting_floor=floor, registered_surface=True)
                generated = generate_floor(deck, frame, beams, elements, first_free)
                first_free = generated["nextFreeNodeIndex"]
                regions = generated["regions"]
                meshed = [region for region in regions if region["status"] == "MESH_GEOMETRY_CHECKED"]
                statuses = Counter(i["status"] for region in meshed for i in region["boundaryInterfaces"])
                row.update({
                    "status": "BEARING_AND_LOAD_TRANSFER_UNVERIFIED",
                    "surfaceFloorId": deck["floorId"],
                    "deckAreaM2": deck["deckAreaMm2"] / 1e6,
                    "openingAreaM2": deck["openingAreaMm2"] / 1e6,
                    "meshedAreaM2": sum(region["areaMm2"] for region in meshed) / 1e6,
                    "regionCount": len(regions),
                    "meshCount": len(meshed),
                    "quadrilaterals": sum(region["quadCount"] for region in meshed),
                    "methodCounts": Counter(region["method"] for region in meshed),
                    "bearingCandidateMemberIds": sorted({bearing["memberId"] for region in deck["regions"]
                                                         for bearing in region["bearingCandidates"]}),
                    "jointRegistry": generated["jointRegistry"],
                    "beamSubdivisionCandidates": [candidate for region in meshed
                                                  for candidate in region["beamSubdivisionCandidates"]],
                    "verifiedBearingAreaM2": 0,
                    "sharedAnalyticalElementIds": sorted({edge["elementId"] for region in meshed
                                                           for edge in region["sharedEdges"]}),
                    "unmatchedAnalyticalElementIds": sorted({element for region in meshed
                                                               for element in region["unmatchedFrameElementIds"]}),
                    "directedBoundaryInterfaceCounts": statuses,
                    "unmeshedRegions": [region for region in regions if region not in meshed],
                    "unverifiedStairIds": [stair["id"] for stair in deck["stairComponents"]],
                })
            row["elapsedMs"] = round(1000 * (perf_counter() - start), 1)
            rows.append(row)
        buildings[name] = {
            "architectureSha256": expected["architecturalDigest"],
            "archiveFileSha256": expected["fileSha256"],
            "structuralRevision": system["structuralRevision"],
            "frameNodes": len(frame),
            "additionalMeshNodes": first_free - len(frame),
            "historicalUnresolvedSlabPaths": archived_loads["unresolvedSlabPaths"],
            "historicalUnassignedSlabLoadsKn": archived_loads["slabUnassignedKn"],
            "appliedCoupledSlabLoadsKn": None,
            "coupledSupportReactionsKn": None,
            "floors": rows,
        }
    return buildings


if __name__ == "__main__":
    archive_dir, output_file = map(Path, sys.argv[1:])
    docs = Path(__file__).resolve().parents[2] / "docs" / "structural"
    checkpoint = json.loads((docs / "6a-evidence" / "deck-replay.json").read_bytes())
    historical_loads = json.loads((docs / "COMPLETE_GRAVITY_TRANSFER_LEDGER.json").read_bytes())
    report = {"status": "MESH_REPLAY_COMPLETE_GRAVITY_UNRESOLVED",
              "buildings": replay(archive_dir, checkpoint, historical_loads)}
    output_file.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
