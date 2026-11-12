// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  createBuilding,
  createFloor,
  createRoom,
  rectToPolygon,
  RoomType,
  type Building,
  type ExportFileDescriptor,
  type IEditorCommand,
} from "@ai-floor-planner/core";
import { UdcprEtabsAnalysis } from "../components/argon/UdcprEtabsAnalysis";
import { ProjectSetupWizard } from "../components/argon/ProjectSetupWizard";
import { createArgonRequest } from "../services/argon-request";
import {
  requestVerifiedExport,
  fetchVerifiedBytes,
  downloadVerifiedExport,
} from "../services/export-client";
import type { EditorContextValue } from "../stores/editor-store";
vi.mock("../services/export-client", () => ({
  requestVerifiedExport: vi.fn(),
  fetchVerifiedBytes: vi.fn(),
  downloadVerifiedExport: vi.fn(),
}));
describe("Phase 3 measured dashboard and wizard", () => {
  let root: Root, host: HTMLDivElement, building: Building;
  const switchFloor = vi.fn(),
    selectEntity = vi.fn(),
    onHighlight = vi.fn();
  const descriptor = {
    fileName: "report.pdf",
    mimeType: "application/pdf",
    revision: 1,
  } as ExportFileDescriptor;
  const mount = () =>
    root.render(
      <UdcprEtabsAnalysis
        editor={
          {
            building,
            switchFloor,
            selectEntity,
            executeCommand: (cmd: IEditorCommand) => {
              const result = cmd.execute(building, {} as never);
              if (result.building) {
                building = result.building;
                mount();
              }
            },
          } as unknown as EditorContextValue
        }
        onHighlight={onHighlight}
      />,
    );
  const click = async (text: string) =>
    act(async () => {
      const button = [...host.querySelectorAll("button")].find(
        (b) => !b.disabled && b.textContent === text,
      );
      expect(button).toBeDefined();
      button!.click();
    });
  beforeEach(async () => {
    (
      globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const b = createBuilding({
        projectId: "phase3-ui",
        name: "Live revision",
        site: { plotWidth: 20000, plotDepth: 20000 },
      }),
      f = createFloor({
        buildingId: b.id,
        level: 0,
        boundary: rectToPolygon(5000, 5000, 10000, 10000),
      });
    building = {
      ...b,
      floors: [
        {
          ...f,
          floorUse: "RESIDENTIAL",
          elevationMm: 0,
          rooms: [
            {
              ...createRoom({
                floorId: f.id,
                type: RoomType.Living,
                x: 5000,
                y: 5000,
                width: 10000,
                height: 10000,
              }),
              unitId: "u",
            },
          ],
          apartmentUnits: [{ id: "u", boundary: f.boundary, unitType: "2BHK" }],
        },
      ],
      regulatoryContext: {
        buildingUsage: "RESIDENTIAL_APARTMENT",
        stiltParkingEnabled: false,
        roadWidthM: 12,
      },
    };
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    URL.createObjectURL = vi.fn().mockReturnValue("blob:report");
    URL.revokeObjectURL = vi.fn();
    vi.mocked(requestVerifiedExport).mockResolvedValue(descriptor);
    vi.mocked(fetchVerifiedBytes).mockResolvedValue(
      new Blob(["%PDF"], { type: "application/pdf" }),
    );
    await act(async () => mount());
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });
  it("uses undoable context edits, reruns measurements and filters actual clauses", async () => {
    expect(host.textContent).toContain("Not verified");
    const hash = host.textContent!.match(/SHA-256 ([a-f0-9]{64})/)![1];
    await act(async () => {
      const el = host.querySelector<HTMLSelectElement>(
        '[aria-label="Planning authority"]',
      )!;
      el.value = "MUNICIPAL_CORPORATION";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      const el = host.querySelector<HTMLSelectElement>(
        '[aria-label="Congestion zone"]',
      )!;
      el.value = "NON_CONGESTED";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(building.regulatoryContext?.authorityType).toBe(
      "MUNICIPAL_CORPORATION",
    );
    expect(building.version).toBe(3);
    expect(host.textContent).toContain("Basic 1.10");
    expect(host.textContent).not.toContain(`SHA-256 ${hash}`);
    await click("Violations");
    const rows = [...host.querySelectorAll("tbody tr")];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.textContent?.includes("VIOLATION"))).toBe(true);
    await click("All");
    await click("Highlight affected elements");
    expect(switchFloor).toHaveBeenCalledWith(building.floors[0]!.id);
    expect(selectEntity).toHaveBeenCalled();
    expect(onHighlight).toHaveBeenCalled();
  });
  it("invokes independent real PDF preview / PDF and JSON download actions", async () => {
    await click("Preview UDCPR Report (.PDF)");
    expect(requestVerifiedExport).toHaveBeenLastCalledWith(
      building,
      "udcpr-pdf",
      { exportScope: "all_floors" },
      expect.any(AbortSignal),
    );
    expect(host.querySelector("iframe")?.src).toBe("blob:report");
    await click("Close preview");
    await click("Download UDCPR Report (.PDF)");
    expect(downloadVerifiedExport).toHaveBeenCalledWith(
      descriptor,
      expect.any(AbortSignal),
    );
    await click("Download UDCPR Report (.JSON)");
    expect(requestVerifiedExport).toHaveBeenLastCalledWith(
      building,
      "udcpr-json",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });
  it("discards an in-flight report when the canonical revision changes", async () => {
    let resolve!: (d: ExportFileDescriptor) => void;
    vi.mocked(requestVerifiedExport).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await click("Preview UDCPR Report (.PDF)");
    await act(async () => {
      building = { ...building, version: building.version + 1 };
      mount();
    });
    await act(async () => resolve(descriptor));
    expect(fetchVerifiedBytes).not.toHaveBeenCalled();
    expect(host.querySelector("iframe")).toBeNull();
  });
  it("ETABS presents verified structural analysis with SE-1 review gate", async () => {
    await click("ETABS Structural Analysis");
    expect(host.textContent).toContain("CSI ETABS v23.3.2 OAPI");
    expect(host.textContent).toContain("CONSTRUCTION: BLOCKED");
    expect(host.textContent).toContain("STOREY DISPLACEMENT & INTER-STOREY DRIFT CHECK");
    expect(host.textContent).not.toContain("Structural Integrity Validated");
  });
  it("passes explicit wizard jurisdiction and road values through the millimetre request boundary", async () => {
    const onGenerate = vi.fn();
    await act(async () =>
      root.render(<ProjectSetupWizard onGenerate={onGenerate} />),
    );
    await act(async () => {
      for (const [label, value] of [
        ["Planning authority", "MUNICIPAL_COUNCIL"],
        ["Congestion zone", "CONGESTED"],
      ]) {
        const e = host.querySelector<HTMLSelectElement>(
          `[aria-label="${label}"]`,
        )!;
        e.value = value!;
        e.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    for (let i = 0; i < 3; i++)
      await act(async () => {
        [...host.querySelectorAll("button")]
          .find((b) => b.textContent?.includes("Continue to Step"))!
          .click();
      });
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent?.includes("Generate"))!
        .click();
    });
    expect(onGenerate).toHaveBeenCalledTimes(1);
    const request = createArgonRequest(onGenerate.mock.calls[0]![0]);
    expect(request.regulatoryContext).toMatchObject({
      authorityType: "MUNICIPAL_COUNCIL",
      congestionZone: "CONGESTED",
      roadWidthM: 12,
      buildingUsage: "RESIDENTIAL_APARTMENT",
      stiltParkingEnabled: true,
    });
    expect(request.roadWidthMm).toBe(12000);
  });
});
