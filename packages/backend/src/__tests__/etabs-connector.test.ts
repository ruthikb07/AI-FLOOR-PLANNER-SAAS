import { describe, expect, it } from "vitest";
import {
  LocalETABSConnector,
  validateETABSResponse,
  type ETABSJsonTransport,
} from "../services/etabs-connector";
import type { ETABSRequest, ETABSResponse } from "@ai-floor-planner/core";

/** Explicit transport mocks: these tests prove protocol behavior, not ETABS execution. */
function mock(
  handler: (r: ETABSRequest) => unknown | Promise<unknown>,
): ETABSJsonTransport {
  return { exchange: async (r) => handler(r), close() {} };
}
const ok = (r: ETABSRequest, data: object = {}): ETABSResponse => ({
  id: r.id,
  protocolVersion: 1,
  ok: true,
  connection: "CONNECTED",
  job: "IDLE",
  data,
});

describe("ETABS connector (mock transport)", () => {
  it("preserves structured OAPI failure codes", async () => {
    const c = new LocalETABSConnector(
      mock((r) => ({
        ...ok(r),
        ok: false,
        error: {
          code: "OAPI_ERROR",
          message: "RunAnalysis returned 7",
          operation: r.operation,
          apiReturnCode: 7,
        },
      })),
    );
    const response = await c.execute({
      operation: "analyze",
      caseNames: ["TEST"],
    });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.apiReturnCode).toBe(7);
  });
  it("rejects mismatched response IDs and marks native outcome unknown", async () => {
    const c = new LocalETABSConnector(mock((r) => ({ ...ok(r), id: "other" })));
    const response = await c.execute({ operation: "version" });
    expect(response).toMatchObject({
      ok: false,
      connection: "FAULTED",
      job: "UNKNOWN",
      error: { code: "TRANSPORT_ERROR" },
    });
  });
  it("reports a disconnected transport without fabricating success", async () => {
    const c = new LocalETABSConnector(
      mock(() => {
        throw new Error("license/startup unavailable");
      }),
    );
    expect(await c.execute({ operation: "connect" })).toMatchObject({
      ok: false,
      error: { code: "TRANSPORT_ERROR" },
    });
  });
  it("serializes calls and exposes RUNNING while awaiting analysis", async () => {
    let resolve!: (r: unknown) => void;
    let request!: ETABSRequest;
    const c = new LocalETABSConnector(
      mock((r) => {
        request = r;
        return new Promise((done) => {
          resolve = done;
        });
      }),
    );
    const first = c.execute({ operation: "analyze", caseNames: ["TEST"] });
    expect(c.job).toBe("RUNNING");
    expect(await c.execute({ operation: "version" })).toMatchObject({
      ok: false,
      error: { code: "BUSY" },
    });
    resolve({
      ...ok(request, { cases: [{ name: "TEST", code: 4, state: "FINISHED" }] }),
      job: "SUCCEEDED",
    });
    expect((await first).ok).toBe(true);
    expect(c.job).toBe("SUCCEEDED");
  });
  it("rejects non-finite forces and mismatched unit metadata", () => {
    const r: ETABSRequest = {
      id: "r",
      protocolVersion: 1,
      operation: "results",
      caseName: "T",
      frameNames: ["F"],
      nodeNames: [],
    };
    expect(() =>
      validateETABSResponse(ok(r, { result: { units: "kN_m_C" } }), r),
    ).toThrow();
    const result = {
      units: "N_mm_C",
      verification: "NATIVE_API",
      engineeringApproval: "NOT_PROVIDED",
      sourceArchitecturalRevisionId: "r1",
      applicationVersion: "MOCK",
      modelFile: "test.edb",
      cases: [],
      supportReactions: [],
      frameForces: [
        {
          object: "F",
          element: "E",
          caseName: "T",
          stepType: "",
          step: 0,
          objectStationMm: 0,
          elementStationMm: 0,
          axialN: Infinity,
          shear2N: 0,
          shear3N: 0,
          torsionNmm: 0,
          moment2Nmm: 0,
          moment3Nmm: 0,
        },
      ],
    };
    expect(() => validateETABSResponse(ok(r, { result }), r)).toThrow(
      "Invalid frame force",
    );
  });
  it("rejects results from another architectural revision", async () => {
    const c = new LocalETABSConnector(
      mock((r) =>
        r.operation === "create"
          ? ok(r)
          : ok(r, {
              result: {
                units: "N_mm_C",
                verification: "NATIVE_API",
                engineeringApproval: "NOT_PROVIDED",
                sourceArchitecturalRevisionId: "stale",
                applicationVersion: "MOCK",
                modelFile: "test.edb",
                cases: [],
                frameForces: [],
                supportReactions: [],
              },
            }),
      ),
    );
    await c.execute({
      operation: "create",
      sourceArchitecturalRevisionId: "current",
    });
    expect(
      await c.execute({
        operation: "results",
        caseName: "T",
        frameNames: [],
        nodeNames: [],
      }),
    ).toMatchObject({
      ok: false,
      error: { message: "Stale architectural revision in native results." },
    });
  });
  it("requires successful native disconnect before closing transport", async () => {
    const c = new LocalETABSConnector(
      mock((r) =>
        r.operation === "disconnect"
          ? { ...ok(r), connection: "DISCONNECTED" }
          : ok(r, { applicationVersion: "MOCK", apiVersion: 2 }),
      ),
    );
    await c.execute({ operation: "connect" });
    expect(() => c.close()).toThrow();
    await c.execute({ operation: "disconnect" });
    expect(() => c.close()).not.toThrow();
  });
});
