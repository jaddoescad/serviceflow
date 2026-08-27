#!/usr/bin/env python3
"""Fail-closed allowlist for tools available to the daily Hermes profile."""

from __future__ import annotations

import json
import re
import shlex
import sys


META_SCRIPT = "/opt/data/skills/ottawa-meta-ads-reporting/scripts/meta-ads-report.mjs"
HEALTH_SCRIPT = "/opt/data/scripts/ops-health-monitor.mjs"
INTAKE_COMMANDS = {"ottawa-email-intake", "/opt/data/bin/ottawa-email-intake"}
INTAKE_SCRIPT = "/opt/data/bin/ottawa-email-intake-cli.mjs"
CONTRACTOR_INVOICE_COMMANDS = {"ottawa-contractor-invoice", "/opt/data/bin/ottawa-contractor-invoice"}
CONTRACTOR_INVOICE_SCRIPT = "/opt/data/bin/ottawa-contractor-invoice-cli.mjs"
READ_COMMANDS = {"ottawa-gmail-read", "/opt/data/bin/ottawa-gmail-read"}
OTTAWA_COMMANDS = {
    "ottawa",
    "ottawa-source",
    "ottawa-gmail-label",
    "ottawa-time",
    "/opt/data/bin/ottawa",
    "/opt/data/bin/ottawa-source",
    "/opt/data/bin/ottawa-gmail-label",
    "/opt/data/bin/ottawa-time",
}
BLOCKED_TOOLS = {
    "close_terminal",
    "focus_pane",
    "open_preview",
    "process",
    "react_to_message",
    "read_terminal",
    "skill_manage",
    "skills_manage",
    "cronjob",
    "delegate_task",
    "write_file",
    "patch",
}
SHELL_CONTROL = re.compile(r"(?:\r|\n|\x00|`|\$\(|\|\||&&|[;|<>])")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MESSAGE_ID = re.compile(r"^[A-Za-z0-9_-]{5,225}$")
INVOICE_NUMBER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$")
SUPPLIER_NAME = re.compile(r"^[^\x00-\x1f\x7f]{1,160}$")


def respond(value: dict[str, str] | None = None) -> None:
    print(json.dumps(value or {}, separators=(",", ":")))


def block(reason: str) -> None:
    respond({"decision": "block", "reason": reason})


def valid_meta(argv: list[str]) -> bool:
    if argv[:2] not in (["node", META_SCRIPT], ["/usr/bin/node", META_SCRIPT]):
        return False
    rest = argv[2:]
    if rest == [] or rest == ["--json"]:
        return True
    if len(rest) == 2 and rest[0] == "--date" and DATE.fullmatch(rest[1]):
        return True
    if len(rest) == 3 and rest[0] == "--date" and DATE.fullmatch(rest[1]) and rest[2] == "--json":
        return True
    return False


def valid_health(argv: list[str]) -> bool:
    if argv[:2] not in (["node", HEALTH_SCRIPT], ["/usr/bin/node", HEALTH_SCRIPT]):
        return False
    rest = argv[2:]
    return rest == [] or rest == ["--self-test"] or (
        len(rest) == 2
        and rest[0] == "--simulate"
        and rest[1] in {"meta", "slack", "gmail", "cron", "email", "invoice", "dripjobs"}
    )


def parse_pairs(argv: list[str], flags: set[str], switches: set[str]) -> dict[str, str | bool] | None:
    result: dict[str, str | bool] = {}
    index = 0
    while index < len(argv):
        token = argv[index]
        if token in switches:
            if token in result:
                return None
            result[token] = True
            index += 1
            continue
        if token not in flags or index + 1 >= len(argv) or argv[index + 1].startswith("--") or token in result:
            return None
        result[token] = argv[index + 1]
        index += 2
    return result


def valid_intake(argv: list[str]) -> bool:
    if argv[0] in INTAKE_COMMANDS:
        command_index = 1
    elif argv[:2] in (["node", INTAKE_SCRIPT], ["/usr/bin/node", INTAKE_SCRIPT]):
        command_index = 2
    else:
        return False
    if len(argv) <= command_index:
        return False
    command, rest = argv[command_index], argv[command_index + 1:]
    if command == "poll":
        options = parse_pairs(rest, {"--limit"}, {"--dry-run", "--yes", "--json"})
        if options is None or bool(options.get("--dry-run")) == bool(options.get("--yes")):
            return False
        limit = str(options.get("--limit", "25"))
        return limit.isdigit() and 1 <= int(limit) <= 25
    if command == "classify":
        options = parse_pairs(rest, {"--message-id", "--label-id"}, {"--yes", "--json"})
        if options is None or not options.get("--yes"):
            return False
        message_id = str(options.get("--message-id", ""))
        label_id = str(options.get("--label-id", ""))
        return bool(MESSAGE_ID.fullmatch(message_id)) and bool(MESSAGE_ID.fullmatch(label_id))
    return False


def valid_contractor_invoice(argv: list[str]) -> bool:
    if argv[0] in CONTRACTOR_INVOICE_COMMANDS:
        command_index = 1
    elif argv[:2] in (["node", CONTRACTOR_INVOICE_SCRIPT], ["/usr/bin/node", CONTRACTOR_INVOICE_SCRIPT]):
        command_index = 2
    else:
        return False
    if len(argv) <= command_index:
        return False
    command, rest = argv[command_index], argv[command_index + 1:]
    if command in {"status", "vision-self-test"}:
        return rest in ([], ["--json"])
    if command == "poll":
        options = parse_pairs(rest, {"--limit"}, {"--dry-run", "--yes", "--json"})
        if options is None or bool(options.get("--dry-run")) == bool(options.get("--yes")):
            return False
        limit = str(options.get("--limit", "10"))
        return limit.isdigit() and 1 <= int(limit) <= 25
    if command == "stage":
        options = parse_pairs(rest, {"--message-id"}, {"--dry-run", "--yes", "--json"})
        return bool(options and bool(options.get("--dry-run")) != bool(options.get("--yes")) and MESSAGE_ID.fullmatch(str(options.get("--message-id", ""))))
    if command == "prepare":
        options = parse_pairs(rest, {"--message-id", "--attachment-index"}, {"--json"})
        index = str(options.get("--attachment-index", "")) if options else ""
        return bool(options and MESSAGE_ID.fullmatch(str(options.get("--message-id", ""))) and index.isdigit() and 1 <= int(index) <= 5)
    if command == "import":
        options = parse_pairs(rest, {"--message-id", "--attachment-index", "--supplier-name", "--invoice-number", "--issued-on", "--subtotal-cents", "--tax-cents", "--total-cents", "--items"}, {"--yes", "--json"})
        if not options or not options.get("--yes"):
            return False
        index = str(options.get("--attachment-index", ""))
        cents = [str(options.get(flag, "")) for flag in ("--subtotal-cents", "--tax-cents", "--total-cents")]
        items = str(options.get("--items", ""))
        return bool(
            MESSAGE_ID.fullmatch(str(options.get("--message-id", "")))
            and index.isdigit() and 1 <= int(index) <= 5
            and SUPPLIER_NAME.fullmatch(str(options.get("--supplier-name", "")))
            and INVOICE_NUMBER.fullmatch(str(options.get("--invoice-number", "")))
            and DATE.fullmatch(str(options.get("--issued-on", "")))
            and all(value.isdigit() and int(value) <= 100_000_000_000 for value in cents)
            and int(cents[2]) > 0
            and 1 <= len(items) <= 6_000 and "::" in items
        )
    if command == "defer":
        options = parse_pairs(rest, {"--message-id", "--attachment-index", "--reason"}, {"--yes", "--json"})
        index = str(options.get("--attachment-index", "")) if options else ""
        return bool(
            options and options.get("--yes")
            and MESSAGE_ID.fullmatch(str(options.get("--message-id", "")))
            and index.isdigit() and 1 <= int(index) <= 5
            and options.get("--reason") in {"unreadable_attachment", "missing_totals", "ambiguous_totals", "not_invoice", "contractor_identity_unverified", "manual_review"}
        )
    return False


def valid_read(argv: list[str]) -> bool:
    if argv[0] not in READ_COMMANDS or len(argv) < 2:
        return False
    command, rest = argv[1], argv[2:]
    options = parse_pairs(rest, {"--query", "--message-id", "--limit"}, {"--include-body", "--json"})
    if options is None:
        return False
    if "--limit" in options and (not str(options["--limit"]).isdigit() or not 1 <= int(str(options["--limit"])) <= 25):
        return False
    if command == "inbox":
        return "--query" not in options and "--message-id" not in options
    if command == "search":
        query = str(options.get("--query", ""))
        return bool(query) and len(query) <= 500 and "--message-id" not in options
    if command == "message":
        return set(options).issubset({"--message-id", "--json"}) and bool(MESSAGE_ID.fullmatch(str(options.get("--message-id", ""))))
    if command == "capabilities":
        return set(options).issubset({"--json"})
    return False


def valid_hermes_diagnostic(argv: list[str]) -> bool:
    if argv[0] not in {"hermes", "/opt/hermes/bin/hermes"}:
        return False
    rest = argv[1:]
    if rest in (["doctor"], ["status"], ["hooks", "list"], ["hooks", "doctor"], ["cron", "status"], ["cron", "list"]):
        return True
    return len(rest) in {3, 5} and rest[:2] == ["cron", "runs"] and (
        len(rest) == 3 or (rest[3] == "--limit" and rest[4].isdigit())
    )


def terminal_allowed(command: object) -> bool:
    if not isinstance(command, str) or not command.strip() or SHELL_CONTROL.search(command):
        return False
    try:
        argv = shlex.split(command, posix=True)
    except ValueError:
        return False
    if not argv:
        return False
    if argv[0] in OTTAWA_COMMANDS:
        return True
    if valid_meta(argv) or valid_health(argv) or valid_intake(argv) or valid_contractor_invoice(argv) or valid_read(argv) or valid_hermes_diagnostic(argv):
        return True
    return argv in (["uv", "pip", "check"], ["/usr/local/bin/uv", "pip", "check"])


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        block("Daily-operation tool policy could not parse the tool request.")
        return 0

    tool = str(payload.get("tool_name") or "")
    if tool in BLOCKED_TOOLS:
        block(f"{tool} is disabled in the daily Hermes profile. Use the admin dashboard for reviewed changes.")
        return 0
    if tool == "terminal":
        tool_input = payload.get("tool_input") or {}
        command = tool_input.get("command") if isinstance(tool_input, dict) else None
        if terminal_allowed(command):
            respond()
        else:
            block("Terminal is restricted to approved Ottawa operations and read-only Hermes diagnostics.")
        return 0

    respond()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
