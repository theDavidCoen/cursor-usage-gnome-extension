#!/usr/bin/env python3
"""Fetch Cursor plan usage for the GNOME Shell extension.

Reads the local IDE access token from Cursor's state DB and calls the same
dashboard endpoints the IDE/dashboard use. Prints one JSON object to stdout.
Never prints the token.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_BASE = "https://api2.cursor.sh"
STATE_DB_CANDIDATES = (
    Path.home() / ".config/Cursor/User/globalStorage/state.vscdb",
    Path.home() / ".config/Cursor/Cursor/User/globalStorage/state.vscdb",
)


def _find_state_db() -> Path | None:
    for path in STATE_DB_CANDIDATES:
        if path.is_file():
            return path
    return None


def _read_item(db_path: Path, key: str) -> str | None:
    uri = f"file:{db_path}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    try:
        row = conn.execute(
            "SELECT value FROM ItemTable WHERE key = ?",
            (key,),
        ).fetchone()
        if not row or row[0] is None:
            return None
        value = row[0]
        if isinstance(value, bytes):
            value = value.decode("utf-8", errors="replace")
        return str(value).strip() or None
    finally:
        conn.close()


def _api_json(token: str, method: str, path: str, body: dict | None = None) -> dict:
    data = None
    headers = {
        "Authorization": f"Bearer {token}",
        "User-Agent": "CursorUsageGnomeExtension/1.0",
        "Accept": "application/json",
    }
    if method == "POST":
        headers["Content-Type"] = "application/json"
        headers["Connect-Protocol-Version"] = "1"
        data = json.dumps(body if body is not None else {}).encode("utf-8")

    req = urllib.request.Request(
        f"{API_BASE}{path}",
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
            if not raw:
                return {}
            return json.loads(raw)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        raise RuntimeError(f"HTTP {exc.code} on {path}: {detail}") from exc


def _ms_to_iso(value) -> str | None:
    if value is None or value == "":
        return None
    try:
        ms = int(value)
    except (TypeError, ValueError):
        text = str(value)
        return text if text else None
    if ms > 10_000_000_000:
        seconds = ms / 1000.0
    else:
        seconds = float(ms)
    return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()


def _cents_to_dollars(cents) -> float | None:
    if cents is None:
        return None
    try:
        return round(int(cents) / 100.0, 2)
    except (TypeError, ValueError):
        return None


def _pct(value) -> float | None:
    if value is None:
        return None
    try:
        return round(float(value), 1)
    except (TypeError, ValueError):
        return None


def build_snapshot() -> dict:
    db_path = _find_state_db()
    if db_path is None:
        return {
            "ok": False,
            "error": "Cursor state database not found. Sign in to Cursor on this machine.",
        }

    token = _read_item(db_path, "cursorAuth/accessToken")
    if not token:
        return {
            "ok": False,
            "error": "No Cursor access token in local state. Sign in to Cursor.",
        }

    cached_plan = _read_item(db_path, "cursorAuth/stripeMembershipType")
    cached_status = _read_item(db_path, "cursorAuth/stripeSubscriptionStatus")
    cached_email = _read_item(db_path, "cursorAuth/cachedEmail")

    usage = _api_json(
        token, "POST", "/aiserver.v1.DashboardService/GetCurrentPeriodUsage"
    )
    plan = _api_json(token, "POST", "/aiserver.v1.DashboardService/GetPlanInfo")
    try:
        profile = _api_json(token, "GET", "/auth/full_stripe_profile")
    except RuntimeError:
        profile = {}

    plan_info = plan.get("planInfo") or {}
    plan_usage = usage.get("planUsage") or {}
    spend_limit = usage.get("spendLimitUsage") or {}

    membership = (
        profile.get("membershipType")
        or profile.get("individualMembershipType")
        or cached_plan
        or plan_info.get("planName")
        or "unknown"
    )
    status = profile.get("subscriptionStatus") or cached_status or "unknown"
    plan_name = plan_info.get("planName") or membership
    price = plan_info.get("price")

    cycle_start = _ms_to_iso(
        usage.get("billingCycleStart") or plan_info.get("billingCycleStart")
    )
    cycle_end = _ms_to_iso(
        usage.get("billingCycleEnd") or plan_info.get("billingCycleEnd")
    )
    pending_cancel = _ms_to_iso(profile.get("pendingCancellationDate"))

    total_pct = _pct(plan_usage.get("totalPercentUsed"))
    auto_pct = _pct(plan_usage.get("autoPercentUsed"))
    api_pct = _pct(plan_usage.get("apiPercentUsed"))

    return {
        "ok": True,
        "fetchedAt": datetime.now(tz=timezone.utc).isoformat(),
        "email": cached_email,
        "plan": {
            "name": plan_name,
            "membershipType": membership,
            "price": price,
            "status": status,
            "isYearly": bool(profile.get("isYearlyPlan")),
            "isTeamMember": bool(profile.get("isTeamMember")),
            "pendingCancellationDate": pending_cancel,
        },
        "billingCycle": {
            "start": cycle_start,
            "end": cycle_end,
        },
        "usage": {
            "totalPercentUsed": total_pct,
            "autoPercentUsed": auto_pct,
            "apiPercentUsed": api_pct,
            "totalSpendUsd": _cents_to_dollars(plan_usage.get("totalSpend")),
            "includedSpendUsd": _cents_to_dollars(plan_usage.get("includedSpend")),
            "bonusSpendUsd": _cents_to_dollars(plan_usage.get("bonusSpend")),
            "limitUsd": _cents_to_dollars(plan_usage.get("limit")),
            "remainingBonus": plan_usage.get("remainingBonus"),
            "bonusTooltip": plan_usage.get("bonusTooltip"),
            "displayMessage": usage.get("displayMessage"),
            "autoMessage": usage.get("autoModelSelectedDisplayMessage"),
            "apiMessage": usage.get("namedModelSelectedDisplayMessage"),
            "enabled": usage.get("enabled"),
            "limitType": spend_limit.get("limitType"),
        },
    }


def main() -> int:
    try:
        snapshot = build_snapshot()
    except Exception as exc:  # noqa: BLE001 — surface any failure as JSON
        snapshot = {"ok": False, "error": str(exc)}
    json.dump(snapshot, sys.stdout, separators=(",", ":"), ensure_ascii=False)
    sys.stdout.write("\n")
    return 0 if snapshot.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
