#!/usr/bin/env python3
"""
AVEP Agent 状态检查脚本
"""

import json
import os
import subprocess
import sys

AVEP_URL = os.environ.get("AVEP_URL", "https://avep.ai")
CONFIG_DIR = os.path.expanduser("~/.config/avep")
CRED_FILE = os.path.join(CONFIG_DIR, "credentials.json")


def main():
    if not os.path.exists(CRED_FILE):
        print("Not initialized. Run: python3 scripts/init.py")
        sys.exit(1)

    with open(CRED_FILE) as f:
        creds = json.load(f)

    did = creds.get("did")
    print(f"DID: {did}")
    print(f"Agent ID: {creds.get('agentId')}")
    print(f"Platform: {creds.get('platform')}")

    result = subprocess.run(
        ["curl", "-s", f"{AVEP_URL}/api/agents/me",
         "-H", f"Authorization: Bearer {did}"],
        capture_output=True, text=True
    )

    try:
        data = json.loads(result.stdout)
        if "error" in data:
            print(f"Status: offline ({data['error']})")
        else:
            print(f"Nectar: {data.get('nectar')}")
            print(f"Status: {data.get('status')}")
    except json.JSONDecodeError:
        print("Status: unreachable")


if __name__ == "__main__":
    main()
