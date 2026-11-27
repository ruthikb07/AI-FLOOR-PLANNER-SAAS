"""Replay diagnostic topology against a recovered closure archive."""
import argparse
import json
from hashlib import sha256
from pathlib import Path
from xml.sax.saxutils import escape

from deck_topology import coordinate_deck


def svg_path(rings):
    return " ".join("M " + " L ".join(f"{x:g},{y:g}" for x, y in ring) + " Z" for ring in rings)


def render(floor, deck):
    points = floor["boundary"]["points"]
    xs, ys = [p["x"] for p in points], [p["y"] for p in points]
    left, top = min(xs), min(ys)
    width, height = max(xs) - left, max(ys) - top
    paths = []
    for region in deck["regions"]:
        paths.append(f'<path d="{svg_path(region["ringsMm"])}" fill="#b8dfed" fill-rule="evenodd" stroke="#23536b" stroke-width="45"/>')
    for line in deck["bearingLines"]:
        paths.append(f'<path d="{svg_path(line["faceRingsMm"])}" fill="#995023" opacity=".55"/>')
    return (f'<h3>{escape(floor["name"])} &middot; elevation {deck["elevationMm"]/1000:g} m</h3>'
            f'<p>{deck["deckAreaMm2"]/1e6:,.3f} m² deck &middot; {deck["openingAreaMm2"]/1e6:,.3f} m² openings</p>'
            f'<svg role="img" aria-label="Floor deck and beam footprints" viewBox="{left-100} {top-100} {width+200} {height+200}">'
            + "".join(paths) + '</svg>')


def replay(archive, output):
    output.mkdir(parents=True, exist_ok=True)
    sheets = []
    results = {}
    for label in ("original", "second"):
        files = {key: (archive / f"{label}.{key}.json").read_bytes()
                 for key in ("snapshot", "architecture", "summary")}
        snapshot, architecture, summary = (json.loads(files[key]) for key in ("snapshot", "architecture", "summary"))
        if snapshot["system"]["sourceArchitecturalSha256"] != summary["architectureSha256"]:
            raise ValueError("Archived snapshot and summary identify different revisions")
        entry = {"architecturalDigest": summary["architectureSha256"],
                 "fileSha256": {k: sha256(v).hexdigest() for k, v in files.items()},
                 "historicalUnassignedKn": summary["unassignedGravityKnByCase"], "floors": []}
        results[label] = entry
        sheets.append(f"<h2>{label.title()} apartment</h2>")
        for floor in architecture["floors"]:
            deck = coordinate_deck(floor, snapshot["system"]["physicalModel"]["beams"])
            entry["floors"].append({k: deck[k] for k in ("floorId", "elevationMm", "deckAreaMm2",
                                                         "openingAreaMm2", "gapMm2", "overlapMm2",
                                                         "gravityStatus")} | {"regionCount": len(deck["regions"])})
            sheets.append(render(floor, deck))
    (output / "deck-replay.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    (output / "deck-review.html").write_text(
        '<!doctype html><meta charset="utf-8"><title>Apartment deck review</title>'
        '<style>body{font:18px/1.5 system-ui;max-width:56rem;margin:auto;padding:2rem}svg{width:100%;max-height:65vh}h2{margin-top:3rem}</style>'
        '<h1>Apartment deck review</h1><p>Blue shows deck coverage. White cutouts show openings. Brown shows physical beam footprints at deck elevation. Gravity transfer requires verification.</p>'
        + "".join(sheets), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    replay(args.archive, args.output)
