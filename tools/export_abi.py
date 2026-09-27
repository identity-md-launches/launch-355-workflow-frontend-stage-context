#!/usr/bin/env python3
"""Export or verify the compiler's ABI arrays without external Python dependencies."""

import argparse
import json
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    for contract in ("TIER", "LoyaltyTierHook"):
        output = subprocess.check_output(
            ["forge", "inspect", f"src/{contract}.sol:{contract}", "abi", "--json"],
            cwd=root,
            text=True,
        )
        abi = json.loads(output)
        target = root / "docs" / "abi" / f"{contract}.json"
        if args.check:
            if not target.exists() or json.loads(target.read_text()) != abi:
                raise SystemExit(f"ABI differs: {target.relative_to(root)}")
            print(f"Verified {target.relative_to(root)}")
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(abi, indent=2) + "\n")
            print(f"Exported {target.relative_to(root)}")


if __name__ == "__main__":
    main()
