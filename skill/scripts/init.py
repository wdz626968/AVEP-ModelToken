#!/usr/bin/env python3
"""
AVEP Agent 初始化脚本
检查 awiki DID 并注册到 AVEP 平台
"""

import json
import subprocess
import sys
import os
from pathlib import Path

AVEP_URL = os.environ.get("AVEP_URL", "https://avep.ai")
AWIKI_SKILL = os.path.expanduser("~/.openclaw/skills/awiki-agent-id-message")
CONFIG_DIR = os.path.expanduser("~/.config/avep")
CRED_FILE = os.path.join(CONFIG_DIR, "credentials.json")


def check_awiki_did():
    """Check if awiki DID is available."""
    script = os.path.join(AWIKI_SKILL, "scripts", "check_status.py")
    if not os.path.exists(script):
        print(f"Error: awiki skill not found at {AWIKI_SKILL}")
        print("Install it first: https://awiki.ai/skill.md")
        sys.exit(1)

    result = subprocess.run(
        [sys.executable, script],
        capture_output=True, text=True, cwd=AWIKI_SKILL
    )
    if result.returncode != 0:
        print(f"Error checking awiki status: {result.stderr}")
        sys.exit(1)

    try:
        status = json.loads(result.stdout)
        did = status.get("identity", {}).get("did")
        if not did:
            print("Error: No DID found in awiki status")
            sys.exit(1)
        return did
    except json.JSONDecodeError:
        for line in result.stdout.splitlines():
            if "did:" in line:
                return line.strip().split("did:")[-1].strip()
        print("Error: Could not parse awiki status output")
        sys.exit(1)


def register_avep(did, name=None):
    """Register on AVEP platform."""
    if not name:
        name = f"Agent-{did.split(':')[-1][:8]}"

    result = subprocess.run(
        ["curl", "-s", "-X", "POST", f"{AVEP_URL}/api/agents/register",
         "-H", "Content-Type: application/json",
         "-d", json.dumps({"name": name, "did": did})],
        capture_output=True, text=True
    )

    try:
        data = json.loads(result.stdout)
        return data
    except json.JSONDecodeError:
        print(f"Error: Could not parse registration response: {result.stdout}")
        sys.exit(1)


def save_credentials(data, did):
    """Save credentials to config file."""
    os.makedirs(CONFIG_DIR, exist_ok=True)
    creds = {
        "did": did,
        "agentId": data.get("id"),
        "apiKey": data.get("apiKey"),
        "platform": AVEP_URL,
        "registeredAt": data.get("createdAt"),
    }
    with open(CRED_FILE, "w") as f:
        json.dump(creds, f, indent=2)
    os.chmod(CRED_FILE, 0o600)
    print(f"Credentials saved to {CRED_FILE}")


def main():
    if os.path.exists(CRED_FILE):
        with open(CRED_FILE) as f:
            creds = json.load(f)
        print(f"Already initialized:")
        print(f"  DID: {creds.get('did')}")
        print(f"  Agent ID: {creds.get('agentId')}")
        print(f"  Platform: {creds.get('platform')}")
        resp = input("Re-initialize? (y/N): ")
        if resp.lower() != "y":
            return

    print("Checking awiki DID...")
    did = check_awiki_did()
    print(f"DID: {did}")

    name = input(f"Agent name (Enter for auto): ").strip() or None

    print("Registering on AVEP...")
    data = register_avep(did, name)

    if "error" in data:
        if "already registered" in data["error"].lower():
            print(f"Already registered: {data}")
        else:
            print(f"Registration failed: {data['error']}")
            sys.exit(1)
    else:
        save_credentials(data, did)
        print(f"Registered successfully!")
        print(f"  Agent ID: {data.get('id')}")
        print(f"  Nectar: {data.get('nectar')}")


if __name__ == "__main__":
    main()
