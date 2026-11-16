#!/usr/bin/env python3
"""
CSI ETABS Windows COM Bridge (`.e2k` -> native `.EDB`).

Checks `comtypes` / `win32com.client` availability upfront. When CSI ETABS COM
libraries or a Windows desktop session are unavailable, emits a structured JSON
status object (`FALLBACK_E2K_ONLY`) so callers cleanly fall back to `.e2k`.
"""

import argparse
import json
import os
import sys


def emit(payload: dict, exit_code: int = 0) -> None:
    sys.stdout.write(json.dumps(payload, indent=2) + "\n")
    sys.exit(exit_code)


def check_com_provider():
    if sys.platform != "win32":
        return None, "Windows COM is required to create native CSI ETABS .EDB files."
    try:
        import comtypes.client  # type: ignore

        return ("comtypes", comtypes.client), None
    except ImportError:
        pass
    try:
        import win32com.client  # type: ignore

        return ("win32com", win32com.client), None
    except ImportError:
        return (
            None,
            "Neither comtypes nor pywin32 (win32com.client) is installed in this Python environment.",
        )


def convert_e2k_to_edb(e2k_path: str, edb_path: str, strict: bool = False) -> None:
    if not os.path.isfile(e2k_path):
        emit(
            {
                "status": "ERROR_MISSING_E2K",
                "reason": f"Input .e2k file not found: {e2k_path}",
                "edbGenerated": False,
            },
            exit_code=1 if strict else 0,
        )

    provider, reason = check_com_provider()
    if provider is None:
        emit(
            {
                "status": "FALLBACK_E2K_ONLY",
                "reason": reason,
                "e2kPath": os.path.abspath(e2k_path),
                "edbGenerated": False,
            },
            exit_code=1 if strict else 0,
        )

    kind, client = provider
    try:
        if kind == "comtypes":
            helper = client.CreateObject("ETABSv1.Helper")
            helper = helper.QueryInterface(client.gen.ETABSv1.cHelper)
            etabs_obj = helper.CreateObjectProgID("CSI.ETABS.API.ETABSObject")
        else:
            helper = client.Dispatch("ETABSv1.Helper")
            etabs_obj = helper.CreateObjectProgID("CSI.ETABS.API.ETABSObject")

        etabs_obj.ApplicationStart()
        sap_model = etabs_obj.SapModel
        sap_model.InitializeNewModel()
        ret = sap_model.File.OpenFile(os.path.abspath(e2k_path))
        if ret != 0:
            etabs_obj.ApplicationExit(False)
            emit(
                {
                    "status": "FALLBACK_E2K_ONLY",
                    "reason": f"CSI ETABS COM OpenFile(.e2k) returned non-zero code {ret}.",
                    "e2kPath": os.path.abspath(e2k_path),
                    "edbGenerated": False,
                },
                exit_code=1 if strict else 0,
            )

        out_dir = os.path.dirname(os.path.abspath(edb_path))
        if out_dir and not os.path.isdir(out_dir):
            os.makedirs(out_dir, exist_ok=True)
        sap_model.File.Save(os.path.abspath(edb_path))
        etabs_obj.ApplicationExit(False)
        emit(
            {
                "status": "NATIVE_EDB_CREATED",
                "e2kPath": os.path.abspath(e2k_path),
                "edbPath": os.path.abspath(edb_path),
                "edbGenerated": True,
            },
            exit_code=0,
        )
    except Exception as exc:  # noqa: BLE001
        emit(
            {
                "status": "FALLBACK_E2K_ONLY",
                "reason": f"CSI ETABS COM automation unavailable: {exc}",
                "e2kPath": os.path.abspath(e2k_path),
                "edbGenerated": False,
            },
            exit_code=1 if strict else 0,
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="RH Planner CSI ETABS .e2k -> .EDB COM bridge")
    parser.add_argument("--e2k", required=True, help="Path to source CSI ETABS .e2k file")
    parser.add_argument("--edb", required=True, help="Target path for native .EDB output")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero if COM automation is unavailable",
    )
    args = parser.parse_args()
    convert_e2k_to_edb(args.e2k, args.edb, strict=args.strict)


if __name__ == "__main__":
    main()

