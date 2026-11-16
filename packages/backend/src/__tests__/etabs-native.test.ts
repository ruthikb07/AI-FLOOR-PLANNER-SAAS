import { expect, it } from "vitest";
import path from "node:path";
import { mkdir, stat, writeFile } from "node:fs/promises";
import {
  detectETABS,
  LocalETABSBridgeTransport,
  LocalETABSConnector,
} from "../services/etabs-connector";
import type { ETABSCommand, ETABSResponse } from "@ai-floor-planner/core";

// Opt-in only: starts an owned licensed application and creates a synthetic model.
it.skipIf(process.env.RH_ETABS_NATIVE_TEST !== "1")(
  "native ETABS verification frame: save, solve, forces, reactions, reopen",
  async () => {
    const install = process.env.ETABS_INSTALL_DIR;
    const bridge = process.env.ETABS_BRIDGE_EXE;
    if (!install || !bridge)
      throw new Error("Set ETABS_INSTALL_DIR and ETABS_BRIDGE_EXE.");
    const modelDirectory = path.resolve(
      "output/etabs",
      "verification-" + Date.now(),
    );
    await mkdir(modelDirectory, { recursive: true });
    const detection = await detectETABS(install);
    expect(detection.status).toBe("DETECTED");
    const connector = new LocalETABSConnector(
      new LocalETABSBridgeTransport({
        bridgeExecutable: bridge,
        installDirectory: install,
        modelDirectory,
        timeoutMs: 120000,
      }),
    );
    const responses: ETABSResponse[] = [];
    async function call(command: ETABSCommand) {
      const response = await connector.execute(command);
      responses.push(response);
      await writeFile(
        path.join(modelDirectory, "native-evidence.json"),
        JSON.stringify({ detection, responses }, null, 2),
      );
      if (!response.ok) throw new Error(JSON.stringify(response.error));
      return response.data;
    }
    try {
      await call({ operation: "detect" });
      const connected = await call({ operation: "connect" });
      expect(connected.applicationVersion).toBeTruthy();
      expect((await call({ operation: "version" })).applicationVersion).toBe(
        connected.applicationVersion,
      );
      await call({
        operation: "create",
        sourceArchitecturalRevisionId: "API-FIXTURE-ONLY-v1",
      });
      // Replacing a dirty model is forbidden even for the fixture.
      const blocked = await connector.execute({
        operation: "create",
        sourceArchitecturalRevisionId: "other",
      });
      expect(blocked).toMatchObject({
        ok: false,
        error: { code: "UNSAVED_MODEL" },
      });
      await call({ operation: "save", fileName: "blank.edb" });
      const data = await call({
        operation: "fixture",
        sourceArchitecturalRevisionId: "API-FIXTURE-ONLY-v1",
      });
      const fixture = data.fixture!;
      const unsafe = await connector.execute({
        operation: "save",
        fileName: "../escape.edb",
      });
      expect(unsafe).toMatchObject({
        ok: false,
        error: { code: "UNSAFE_PATH" },
      });
      await call({ operation: "save", fileName: "verification-frame.edb" });
      expect(
        (await stat(path.join(modelDirectory, "verification-frame.edb"))).size,
      ).toBeGreaterThan(0);
      await call({ operation: "analyze", caseNames: [fixture.caseName] });
      const result = (await call({ operation: "results", ...fixture })).result!;
      expect(result.frameForces.length).toBeGreaterThan(0);
      expect(result.frameForces.some((f) => Math.abs(f.axialN) > 1)).toBe(true);
      for (let axis = 0; axis < 3; axis++) {
        const sum = result.supportReactions.reduce(
          (v, r) => v + r.forceN[axis]!,
          0,
        );
        expect(Math.abs(sum - fixture.expectedReactionN[axis]!)).toBeLessThan(
          0.01,
        );
      }
      await call({ operation: "save", fileName: "verification-frame.edb" });
      await call({ operation: "disconnect" });
      await call({ operation: "connect" });
      await call({
        operation: "open",
        fileName: "verification-frame.edb",
        sourceArchitecturalRevisionId: "API-FIXTURE-ONLY-v1",
      });
      const reopened = await call({ operation: "status" });
      const reopenedCase = reopened.cases?.find((c) => c.name === fixture.caseName);
      expect(reopenedCase).toBeDefined();
      if (reopenedCase!.state !== "FINISHED") {
        // Native results are not guaranteed to persist in an EDB alone.
        const unavailable = await connector.execute({ operation: "results", ...fixture });
        expect(unavailable).toMatchObject({ ok: false, error: { code: "ANALYSIS_INCOMPLETE" } });
        await call({ operation: "analyze", caseNames: [fixture.caseName] });
      }
      const second = (await call({ operation: "results", ...fixture })).result!;
      expect(
        second.frameForces.length,
      ).toBe(result.frameForces.length);
      for (let axis = 0; axis < 3; axis++) {
        const sum = second.supportReactions.reduce((v, r) => v + r.forceN[axis]!, 0);
        expect(Math.abs(sum - fixture.expectedReactionN[axis]!)).toBeLessThan(0.01);
      }
    } finally {
      if (
        connector.connection === "CONNECTED" ||
        connector.connection === "FAULTED"
      ) {
        const response = await connector.execute({
          operation: "disconnect",
          discardUnsaved: true,
        });
        responses.push(response);
        await writeFile(
          path.join(modelDirectory, "native-evidence.json"),
          JSON.stringify({ detection, responses }, null, 2),
        );
      }
      if (connector.connection === "DISCONNECTED") connector.close();
      console.info("Native ETABS evidence:", modelDirectory);
    }
  },
  300000,
);
