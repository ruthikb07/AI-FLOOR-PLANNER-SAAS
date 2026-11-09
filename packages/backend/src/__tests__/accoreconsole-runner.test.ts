import { it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as acad from "@node-projects/acad-ts";
import {
  AccoreConsoleRunner,
  accoreConsoleScript,
  parseAccoreConsoleEvidence,
  resolveAccoreConsole,
} from "../cad/accoreconsole-runner.js";
it("requires independent native markers and a zero-fix audit rather than echoed script commands", () => {
  expect(
    parseAccoreConsoleEvidence(
      "Total errors found 0 fixed 0\nARGON_TEST_INSUNITS = 4\nARGON_TEST_TILEMODE = 1\n",
      "ARGON_TEST",
    ),
  ).toEqual({
    auditErrorsFound: 0,
    auditErrorsFixed: 0,
    insUnits: 4,
    tileMode: 1,
  });
  expect(
    parseAccoreConsoleEvidence(
      "Total errors found 2 fixed 2\nTotal errors found 0 fixed 0",
      "ARGON_TEST",
    ).auditErrorsFound,
  ).toBe(2);
  expect(
    parseAccoreConsoleEvidence(
      accoreConsoleScript(path.join(os.tmpdir(), "probe.dwg"), "ARGON_TEST"),
      "ARGON_TEST",
    ).insUnits,
  ).toBeUndefined();
});
it("reports an explicit missing binary and never writes a fake DWG", async () => {
  const r = await new AccoreConsoleRunner({
    binaryPath: path.join(os.tmpdir(), "missing-argon.exe"),
  }).convert("missing.dxf", "missing.dwg");
  expect(r.status).toBe("ACCORECONSOLE_SKIPPED");
  expect(r.code).toBe("ACCORECONSOLE_BINARY_NOT_FOUND");
});
it.runIf(!!resolveAccoreConsole())(
  "converts a minimal DXF using the actual installed AutoCAD engine",
  async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "argon-native-probe-"),
    );
    const doc = new acad.CadDocument(acad.ACadVersion.AC1032);
    doc.header!.insUnits = acad.UnitsType.Millimeters;
    doc.header!.showModelSpace = true;
    doc.header!.tileModeEnabled = true;
    doc.entities!.add(
      new acad.Line(new acad.XYZ(0, 0, 0), new acad.XYZ(1000, 0, 0)),
    );
    const chunks: string[] = [];
    const writer = new acad.DxfWriter(
      {
        write: (s: string) => {
          chunks.push(s);
        },
      },
      doc,
      false,
    );
    writer.configuration.writeOptionalValues = true;
    writer.configuration.addHeaderVariable("$TILEMODE");
    writer.write();
    const input = path.join(directory, "input.dxf"),
      output = path.join(directory, "native.dwg");
    fs.writeFileSync(input, chunks.join(""));
    const result = await new AccoreConsoleRunner().convert(input, output);
    console.info("NATIVE_PROBE", JSON.stringify(result));
    expect(
      result.status,
      result.logPath
        ? fs.readFileSync(result.logPath, "utf8")
        : JSON.stringify(result),
    ).toBe("VERIFIED");
  },
  150000,
);

it("rejects script injection in paths and does not overwrite existing output files", async () => {
  expect(() => accoreConsoleScript('bad"\n_QUIT.dwg', "ARGON_TEST")).toThrow(
    /Unsafe/,
  );
  const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "argon-native-guard-"),
    ),
    input = path.join(directory, "source.dxf"),
    output = path.join(directory, "existing.dwg");
  fs.writeFileSync(
    input,
    "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1032\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nEOF\n",
  );
  fs.writeFileSync(output, "PRESERVE");
  const result = await new AccoreConsoleRunner({
    binaryPath: process.execPath,
  }).convert(input, output);
  expect(result.status).toBe("ACCORECONSOLE_ERROR");
  expect(fs.readFileSync(output, "utf8")).toBe("PRESERVE");
});
it("reports a native process failure rather than publishing a fake DWG", async () => {
  const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "argon-native-failure-"),
    ),
    input = path.join(directory, "source.dxf"),
    output = path.join(directory, "missing.dwg");
  fs.writeFileSync(
    input,
    "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1032\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nEOF\n",
  );
  const result = await new AccoreConsoleRunner({
    binaryPath: process.execPath,
    timeoutMs: 5000,
  }).convert(input, output);
  expect(result.status).toBe("ACCORECONSOLE_ERROR");
  expect(result.errors.length).toBeGreaterThan(0);
  expect(fs.existsSync(output)).toBe(false);
});
