#!/usr/bin/env python3
"""Build an auditable invoice metadata and CompanyCam matching manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path


NON_INVOICE_NAME_MARKERS = (
    "commission_agreement",
    "portafolio",
    "portfolio",
    "addendum",
    "invoices.eml",
)

SUPPLIER_MARKERS = (
    ("polaris painters", "Polaris Painters"),
    ("curb appeal pro wash", "Curb Appeal Pro Wash"),
    ("xdesign dev inc", "XDesign Dev Inc"),
    ("premium coat", "Premium Coat"),
    ("15337810 canada inc", "Premium Coat"),
    ("firefly home cleaning services", "Premium Coat"),
    ("pixreno construction", "PixReno Construction Inc."),
    ("caledonian painting", "Caledonian Painting Ltd"),
    ("abdellah aouf", "Abdellah Aouf"),
    ("angel marcelo cabrera", "Angel Marcelo Cabrera"),
    ("niels aschengreen", "Niels Aschengreen"),
    ("assmaâ senni", "Assmaâ Senni"),
    ("asmaa senni", "Assmaâ Senni"),
    ("phillip hyde", "Phillip Hyde"),
    ("613painting inc", "613PAINTING INC"),
    ("painttastic pro", "PaintTastic Pro Inc"),
    ("goulet contracting", "Goulet Contracting & Painting Inc."),
    ("mas reno", "Mas Reno"),
    ("andrew bell", "Andrew Bell"),
    ("andre archambault", "Andre Archambault Handyman Services Inc."),
    ("done right handyman", "Done Right Handyman Services"),
    ("amg service construction", "AMG Service Construction"),
    ("grutenco painting", "Grutenco Painting & Construction Services"),
    ("kimberly pel", "Kimberly Pel Abelgas"),
    ("loli taping", "Loli Taping"),
    ("perfect strokes painting", "Perfect Strokes Painting Inc."),
    ("fennec contracting", "Fennec Contracting"),
    ("scott bertin", "Scott Bertin"),
    ("youssef mroueh", "Youssef Mroueh"),
    ("sherwin-williams", "Sherwin-Williams"),
    ("sherwin williams", "Sherwin-Williams"),
    ("capital parking", "Capital Parking"),
    ("loli taping", "Loli Taping"),
    ("kimberly pel", "Kimberly Pel Abelgas"),
)

OVERHEAD_MARKERS = (
    "salary of the month",
    "base salary",
    "monthly salary",
    "monthly bonus",
    "monthly payment",
    "weekly payment",
    "project coordinator",
    "base business development",
    "base business consulting",
    "sales commission",
    "sale commission",
    "sale commision",
    "business consulting",
    "advance payment for services",
    "project supervision and team coordination",
    "proposals",
)

AMOUNT_OVERRIDES = {
    "2025-07-22 - Invoice 278691 and 280975.xlsx": (291.08, 291.08, 0.00),
    "2025-07-22 - Invoice 278691.xlsx": (661.00, 661.00, 0.00),
    "2026-02-11 - application_1.pdf": (250.00, 250.00, 0.00),
    "2026-01-31 - Untitled.pdf": (897.50, 800.00, 97.50),
    "2026-03-02 - Asmaa senni-INVOICE001.docx": (276.00, 276.00, 0.00),
    "2026-03-02 - Marcelo invoice #3-1.pdf": (1728.00, 1728.00, 0.00),
    "2026-03-25 - 1000018917.jpg": (1980.00, 1980.00, 0.00),
    "2026-03-25 - Screenshot_20260324_200419_Sheets.jpg": (1085.00, 1085.00, 0.00),
    "2026-04-27 - Invoice FM-158.pdf": (3600.00, 3600.00, 0.00),
    "2026-05-20 - INV - 1000065 LOLI TAPING.pdf": (4983.30, 4410.00, 573.30),
    "2026-05-21 - Invoice 118- Perfect Strokes Paintinfg Inc (Ottawa Painter).pdf": (
        5181.05,
        4585.00,
        596.05,
    ),
}

INVOICE_NUMBER_OVERRIDES = {
    "2026-03-25 - 1000018917.jpg": "1",
    "2026-03-25 - Screenshot_20260324_200419_Sheets.jpg": "1",
}

# Pre-tax line-item amounts copied from shared invoices that explicitly name
# the CompanyCam job. Amounts not attributable to a specific job (materials,
# base management fees, or unsplit hours) are intentionally left unallocated.
PROJECT_ALLOCATION_OVERRIDES = {
    "2026-01-29 - invoice_ottawa_painters copy.pdf": {
        "96631889": 600.00,
        "96936844": 900.00,
        "97635432": 400.00,
    },
    "2026-02-01 - invoice_ottawa_painters (1).pdf": {
        "96631889": 600.00,
        "96936844": 900.00,
        "97196041": 700.00,
        "97635432": 400.00,
    },
    "2026-02-20 - Invoice Feb 18.pdf": {
        "97216872": 600.00,
        "97255657": 200.00,
    },
    "2026-03-02 - Marcelo invoice#3.pdf": {
        "99369940": 918.75,
        "99430054": 809.25,
    },
    "2026-03-03 - INV-20260302-001.pdf": {
        "99182464": 375.00,
        "99430054": 62.50,
    },
    "2026-03-06 - Invoice #1.pdf": {
        "96869012": 39.30,
        "98421832": 141.90,
        "98940036": 155.88,
    },
    "2026-03-06 - Invoice 1.docx": {
        "99786158": 280.00,
        "99905376": 392.00,
    },
    "2026-03-06 - Marcelo invoice#3-1.pdf": {
        "99786158": 712.50,
        "99905376": 562.50,
    },
    "2026-03-16 - INV-20260316-001.pdf": {
        "98236994": 325.00,
        "98894646": 587.59,
    },
    "2026-03-16 - Marcelo invoice#4.pdf": {
        "98236994": 525.00,
        "98894646": 450.00,
    },
    "2026-03-25 - 1000018917.jpg": {
        "96695216": 1155.00,
        "99200156": 360.00,
        "100424315": 195.00,
        "100775529": 270.00,
    },
    "2026-03-25 - Screenshot_20260324_200419_Sheets.jpg": {
        "96695216": 615.00,
        "100424315": 195.00,
        "100775529": 270.00,
    },
    "2026-03-28 - INV-20260328-001.pdf": {
        "96695216": 700.00,
        "97577862": 162.50,
        "98894646": 237.50,
    },
    "2026-04-01 - Marcelo invoice#7-1.pdf": {
        "96770884": 1125.00,
        "98894646": 375.00,
        "99200156": 487.50,
    },
    "2026-05-10 - 107-Ottawa-painters.pdf": {
        "100014400": 1555.00,
        "104199412": 1625.00,
    },
    "2026-05-23 - 42963bc6-fb46-4ccd-a472-003ddbd9748e.pdf": {
        "101795090": 1415.00,
        "102048180": 650.09,
        "104252366": 1340.00,
        "104952080": 255.00,
        "105106506": 230.00,
        "105384945": 300.00,
    },
    "2026-05-25 - 108-Ottawa-painters.pdf": {
        "102085458": 320.00,
        "102791614": 535.00,
        "105711390": 1850.00,
    },
    "2026-05-26 - 108-Ottawa-painters.pdf": {
        "102085458": 320.00,
        "102791614": 535.00,
        "105302560": 720.00,
        "105445031": 1236.00,
        "105711390": 1850.00,
    },
    "2026-05-28 - 108-Ottawa-painters.pdf": {
        "102085458": 320.00,
        "102791614": 535.00,
        "105302560": 720.00,
        "105445031": 1236.00,
        "105711390": 1850.00,
    },
    "2026-06-02 - 74932994-ffb6-49b1-97e7-0fcd59e5e050.pdf": {
        "102265050": 2550.00,
        "102498783": 185.00,
    },
    "2026-06-03 - 109-Ottawa-painters (2).pdf": {
        "102047669": 0.00,
        "102498783": 1250.75,
        "104972295": 0.00,
    },
    "2026-06-03 - 109-Ottawa-painters.pdf": {
        "102047669": 0.00,
        "102498783": 1447.20,
        "104972295": 0.00,
    },
    "2026-06-17 - Invoice_8590_2026-06-17.pdf": {
        "105938236": 510.00,
        "107341840": 30.00,
    },
    "2026-06-28 - GT-INV-202606-04-Ottawa-Painters.pdf": {
        "104598485": 500.00,
        "105302560": 381.53,
    },
    "2026-07-24 - GT-INV-202707-04-Ottawa-Painters.pdf": {
        "103366525": 600.00,
        "108454712": 750.00,
        "108687702": 1000.00,
    },
}


def normalize(value: str) -> str:
    folded = unicodedata.normalize("NFKD", value or "")
    ascii_text = "".join(char for char in folded if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", ascii_text.lower()).strip()


def storage_safe_filename(value: str) -> str:
    return re.sub(r"[#?]", "-", value)


def repair_spaced_letters(value: str) -> str:
    repaired = value
    for _ in range(4):
        updated = re.sub(r"(?<=\b[A-Za-z0-9]) (?=[A-Za-z0-9]\b)", "", repaired)
        if updated == repaired:
            break
        repaired = updated
    return repaired


def parse_money(value: str | None) -> float | None:
    if not value:
        return None
    cleaned = value.replace(",", "").replace(" ", "")
    try:
        return round(float(cleaned), 2)
    except ValueError:
        return None


def first_money_match(text: str, patterns: tuple[str, ...]) -> float | None:
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            amount = parse_money(match.group(1))
            if amount is not None:
                return amount
    return None


def last_money_match(text: str, patterns: tuple[str, ...]) -> float | None:
    for pattern in patterns:
        matches = list(re.finditer(pattern, text, flags=re.IGNORECASE))
        for match in reversed(matches):
            amount = parse_money(match.group(1))
            if amount is not None:
                return amount
    return None


def extract_amounts(text: str, filename: str) -> tuple[float | None, float | None, float | None]:
    repaired = repair_spaced_letters(text)
    if re.search(r"\bpayment receipt\b", repaired, flags=re.IGNORECASE):
        paid = first_money_match(
            repaired,
            (
                r"Amount Received\s*\$?\s*([\d,]+(?:\.\d{1,2})?)",
                r"Payment Amount\s+[\w/-]+\s+\$?\s*([\d,]+(?:\.\d{1,2})?)",
            ),
        )
        return paid, paid, 0.0 if paid is not None else None

    total = first_money_match(
        repaired,
        (
            r"Total Amount Due(?:\s*\+\s*HST)?\s*:?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)",
            r"INVOICE TOTAL\s*\$?\s*([\d,]+(?:\.\d{1,2})?)",
            r"\bTOTAL\s+CA\$\s*([\d,]+(?:\.\d{1,2})?)",
            r"TOTAL\s*\(CAD\)\s*:?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)",
                r"\bTotal\s*:\s*\$?\s*([\d,]+(?:\.\d{1,2})?)",
                r"\bTotal Due\s*:?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)",
                r"\bTotal\s+\$\s*([\d,]+(?:\.\d{1,2})?)",
                r"\bTOTAL\s+\$?\s*([\d,]+(?:\.\d{1,2})?)",
                r"\bAmount\s*:\s*\$?\s*([\d,]+(?:\.\d{1,2})?)",
                r"\bAMOUNT PAID\s*:?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)",
                r"\bBALANCE DUE\s+\$?\s*([\d,]+(?:\.\d{1,2})?)",
        ),
    )
    subtotal = last_money_match(
        repaired,
        (
            r"\bSub\s*Total\s*:?\s*(?:CA\$|\$)?\s*([\d,]+(?:\.\d{1,2})?)",
            r"\bSubtotal\s*:?\s*(?:CA\$|\$)?\s*([\d,]+(?:\.\d{1,2})?)",
        ),
    )
    tax = first_money_match(
        repaired,
        (
            r"(?:ON\s+13%|HST(?:\s*\(ON\))?\s*@?\s*13%|GST/HST\s*@?\s*13%)\s*:?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)",
            r"\bHST\s*\(13%\)\s*:?\s*(?:CA\$|\$)?\s*([\d,]+(?:\.\d{1,2})?)",
            r"\b(?:GST/)?HST\b(?!\s*(?:No\.?|Number|#))\s*(?:\([^)]*\))?\s*:?\s*(?:CA\$|\$)?\s*([\d,]+\.\d{2})",
            r"\bTax\s+\$?\s*([\d,]+(?:\.\d{1,2})?)",
        ),
    )
    if subtotal is not None and total is not None:
        tax = round(total - subtotal, 2)
    elif subtotal is None and total is not None and tax is not None:
        subtotal = round(total - tax, 2)
    elif subtotal is None and total is not None:
        subtotal = total
        tax = 0.0
    return total, subtotal, tax


def extract_invoice_number(text: str, filename: str, sha256: str) -> str:
    repaired = repair_spaced_letters(text)
    patterns = (
        r"Invoice Number\s*:\s*([A-Z0-9][A-Z0-9-]*)",
        r"Invoice\s*#\s*:?\s*([A-Z0-9][A-Z0-9-]*)",
        r"Invoice No\s*:\s*([A-Z0-9][A-Z0-9-]*)",
        r"\bINVOICE\s+#?\s*([A-Z]{0,4}-?[A-Z0-9][A-Z0-9-]{0,30})\s+(?:DATE|Date|Invoice Date)",
        r"\bINVOICE\s+(FM-\d+)\b",
        r"\bINVOICE\s+(GT-INV-[A-Z0-9-]+)\b",
        r"\bINV\s*-\s*(\d{3,})\b",
        r"\bINVOICE\s+(\d{2,8})\s+DATE\b",
    )
    for pattern in patterns:
        match = re.search(pattern, repaired, flags=re.IGNORECASE)
        if match:
            candidate = match.group(1).strip().upper()
            if candidate not in {"DATE", "INVOICE", "TO"}:
                return candidate

    stem = re.sub(r"^\d{4}-\d{2}-\d{2}\s+-\s+", "", Path(filename).stem)
    filename_patterns = (
        r"(GT-INV-\d{6,8}-\d+)",
        r"(INV-\d{3,})",
        r"(INV-\d{8}-\d+)",
        r"(FM-\d+)",
        r"Invoice[_ ](\d{2,8})",
        r"invoice[_ -]?(\d{2,8})",
        r"Invoice\s*#?(\d{1,8})",
    )
    for pattern in filename_patterns:
        match = re.search(pattern, stem, flags=re.IGNORECASE)
        if match:
            return match.group(1).upper()
    return f"FILE-{sha256[:12].upper()}"


def supplier_name(text: str) -> str:
    normalized = normalize(repair_spaced_letters(text))
    for marker, supplier in SUPPLIER_MARKERS:
        if normalize(marker) in normalized:
            return supplier
    return "Unknown supplier"


def classify(filename: str, text: str) -> str:
    lowered_name = filename.lower()
    lowered_text = normalize(repair_spaced_letters(text))
    if any(marker in lowered_name for marker in NON_INVOICE_NAME_MARKERS):
        return "not_invoice"
    if (
        "payment receipt" in lowered_text
        or lowered_name.startswith("202")
        and ("invoice payment" in lowered_name or "invoice-payment" in lowered_name)
    ):
        return "payment_receipt"
    if "parking" in lowered_name or "transaction record" in lowered_text:
        return "receipt"
    if "sherwin williams" in lowered_text or "materials reimbursement" in lowered_name:
        return "receipt"
    if "bill to ottawa painters" in lowered_text and (
        "total" in lowered_text or "amount" in lowered_text
    ):
        return "invoice"
    if "invoice" in lowered_text or "debit note" in lowered_text:
        return "invoice"
    if re.search(r"\binv\b", lowered_text):
        return "invoice"
    return "needs_review"


def project_aliases(project: dict) -> tuple[list[str], list[str]]:
    raw = project.get("raw") or {}
    primary = raw.get("primary_contact") or {}
    names = {
        project.get("name") or "",
        primary.get("name") or "",
    }
    cleaned_names: list[str] = []
    for name in names:
        name = re.sub(r"\s+-\s+20\d{2}-\d{2}-\d{2}T.*$", "", name).strip()
        normalized = normalize(name)
        tokens = normalized.split()
        if len(normalized) >= 7 and (len(tokens) >= 2 or len(normalized) >= 9):
            cleaned_names.append(normalized)

    addresses = {
        project.get("formatted_address") or "",
        project.get("street_address_1") or "",
        ((raw.get("address") or {}).get("street_address_1") or ""),
    }
    cleaned_addresses = [normalize(value) for value in addresses if len(normalize(value)) >= 5]
    return sorted(set(cleaned_names)), sorted(set(cleaned_addresses))


def score_project(project: dict, normalized_text: str, normalized_filename: str) -> tuple[int, list[str]]:
    names, addresses = project_aliases(project)
    score = 0
    evidence: list[str] = []
    for alias in names:
        if re.search(rf"\b{re.escape(alias)}\b", normalized_text):
            score += 65
            evidence.append(f"name:{alias}")
            break
        if re.search(rf"\b{re.escape(alias)}\b", normalized_filename):
            score += 55
            evidence.append(f"filename:{alias}")
            break
        alias_tokens = alias.split()
        text_tokens = normalized_text.split()
        if len(alias_tokens) == 2 and alias_tokens[1] in text_tokens:
            first_name_similarity = max(
                (
                    SequenceMatcher(None, alias_tokens[0], token).ratio()
                    for token in text_tokens
                    if abs(len(token) - len(alias_tokens[0])) <= 2
                ),
                default=0,
            )
            if first_name_similarity >= 0.78:
                score += 60
                evidence.append(f"fuzzy_name:{alias}")
                break

    for address in addresses:
        match = re.match(r"(\d+[a-z]?)\s+(.+)", address)
        if not match:
            continue
        number, remainder = match.groups()
        street_tokens = [
            token
            for token in remainder.split()
            if token not in {"unit", "apt", "avenue", "ave", "road", "rd", "street", "st", "crescent", "cres", "drive", "dr"}
        ]
        if not street_tokens:
            continue
        street_key = f"{number} {street_tokens[0]}"
        if re.search(rf"\b{re.escape(street_key)}\b", normalized_text):
            score += 85
            evidence.append(f"address:{street_key}")
            break
    if not project.get("is_archived"):
        score += 2
    return score, evidence


def supporting_invoice_reference(text: str) -> str | None:
    repaired = repair_spaced_letters(text)
    match = re.search(
        r"Payment for\s+Invoice Number.*?\b((?:INV|FM|GT-INV)-[A-Z0-9-]+|\d{2,8})\b",
        repaired,
        flags=re.IGNORECASE | re.DOTALL,
    )
    return match.group(1).upper() if match else None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("extracted_json", type=Path)
    parser.add_argument("workbooks_json", type=Path)
    parser.add_argument("project_context_json", type=Path)
    parser.add_argument("output_json", type=Path)
    args = parser.parse_args()

    extracted = json.loads(args.extracted_json.read_text(encoding="utf-8"))
    workbooks = json.loads(args.workbooks_json.read_text(encoding="utf-8"))
    context = json.loads(args.project_context_json.read_text(encoding="utf-8"))
    workbook_text = {}
    for workbook in workbooks:
        values = []
        for sheet in workbook["sheets"]:
            for row in sheet["values"]:
                values.extend(str(value) for value in row if value is not None)
        workbook_text[workbook["source_filename"]] = "\n".join(values)

    projects = [
        project
        for project in context["projects"]
        if not project.get("is_deleted")
        and project.get("companycam_id") != "qa-web-smoke-project"
        and "test" not in normalize(project.get("name") or "")
        and normalize(project.get("name") or "") not in {"jad slim", "scott"}
        and not normalize(project.get("formatted_address") or "").startswith("2377 walkley")
        and not normalize(project.get("formatted_address") or "").startswith("2337 walkley")
    ]
    manifest = []
    for row in extracted:
        text = workbook_text.get(row["source_filename"], row.get("text") or "")
        repaired_text = repair_spaced_letters(text)
        normalized_text = normalize(repaired_text)
        normalized_filename = normalize(row["source_filename"])
        document_type = classify(row["source_filename"], repaired_text)
        total, subtotal, tax = extract_amounts(repaired_text, row["source_filename"])
        if row["source_filename"] in AMOUNT_OVERRIDES:
            total, subtotal, tax = AMOUNT_OVERRIDES[row["source_filename"]]
        supplier = supplier_name(repaired_text)
        invoice_number = extract_invoice_number(repaired_text, row["source_filename"], row["sha256"])
        if row["source_filename"] in INVOICE_NUMBER_OVERRIDES:
            invoice_number = INVOICE_NUMBER_OVERRIDES[row["source_filename"]]
        currency = "USD" if re.search(r"\bUSD\b", repaired_text, flags=re.IGNORECASE) else "CAD"

        candidates = []
        if document_type in {"invoice", "receipt"} and not any(
            marker in normalized_text for marker in OVERHEAD_MARKERS
        ):
            for project in projects:
                score, evidence = score_project(project, normalized_text, normalized_filename)
                if score >= 55:
                    candidates.append(
                        {
                            "companycam_project_id": project["companycam_id"],
                            "project_name": project["name"],
                            "project_address": project.get("formatted_address"),
                            "is_archived": bool(project.get("is_archived")),
                            "is_lead": bool(project.get("is_lead")),
                            "score": score,
                            "evidence": evidence,
                        }
                    )
        candidates.sort(key=lambda item: (-item["score"], item["project_name"]))
        candidates = [
            candidate
            for candidate in candidates
            if any(item.startswith("address:") for item in candidate["evidence"])
            or not any(
                other["companycam_project_id"] != candidate["companycam_project_id"]
                and normalize(
                    re.sub(
                        r"\s+-\s+20\d{2}-\d{2}-\d{2}T.*$",
                        "",
                        other["project_name"],
                    )
                )
                == normalize(
                    re.sub(
                        r"\s+-\s+20\d{2}-\d{2}-\d{2}T.*$",
                        "",
                        candidate["project_name"],
                    )
                )
                and any(item.startswith("address:") for item in other["evidence"])
                for other in candidates
            )
        ]
        strong_candidates = [candidate for candidate in candidates if candidate["score"] >= 65]
        if not strong_candidates and candidates:
            strong_candidates = candidates[:1]
        allocation_overrides = PROJECT_ALLOCATION_OVERRIDES.get(row["source_filename"], {})
        for candidate in strong_candidates:
            project_id = candidate["companycam_project_id"]
            if project_id in allocation_overrides:
                candidate["allocated_amount"] = allocation_overrides[project_id]

        overhead = any(marker in normalized_text for marker in OVERHEAD_MARKERS)
        if document_type == "not_invoice":
            match_status = "not_invoice"
        elif document_type == "payment_receipt":
            match_status = "supporting_document"
        elif overhead and not strong_candidates:
            match_status = "overhead_unmatched"
        elif not strong_candidates:
            match_status = "unmatched"
        elif len(strong_candidates) == 1:
            match_status = "matched"
        else:
            match_status = "matched_multiple"

        explicit_reference = supporting_invoice_reference(repaired_text)
        if document_type == "payment_receipt" and explicit_reference:
            invoice_number = explicit_reference
        duplicate_key_number = explicit_reference or invoice_number
        duplicate_group_key = f"{normalize(supplier)}|{normalize(duplicate_key_number)}"
        manifest.append(
            {
                "source_path": row["source_path"],
                "source_filename": row["source_filename"],
                "source_date": row.get("source_date"),
                "document_type": document_type,
                "supplier_name": supplier,
                "invoice_number": invoice_number,
                "invoice_date": row.get("source_date"),
                "currency": currency,
                "amount_paid": total,
                "amount_before_tax": subtotal,
                "tax_amount": tax,
                "payment_basis": "explicit_payment" if document_type == "payment_receipt" else "invoice_total",
                "storage_bucket": "labour-invoices",
                "storage_path": (
                    f"gmail-labour-invoices/{row['source_date'] or 'unknown-date'}/"
                    f"{row['sha256'][:16]}-{storage_safe_filename(row['source_filename'])}"
                ),
                "mime_type": row["mime_type"],
                "file_size": row["file_size"],
                "sha256": row["sha256"],
                "text_length": row["text_length"],
                "text_excerpt": repaired_text[:2000],
                "match_status": match_status,
                "match_candidates": strong_candidates,
                "duplicate_group_key": duplicate_group_key,
                "supporting_invoice_reference": explicit_reference,
                "overhead": overhead,
            }
        )

    grouped: dict[str, list[dict]] = defaultdict(list)
    for item in manifest:
        grouped[item["duplicate_group_key"]].append(item)
    for items in grouped.values():
        if len(items) < 2:
            continue
        group_id = hashlib.sha256(items[0]["duplicate_group_key"].encode()).hexdigest()[:16]
        for item in items:
            item["duplicate_group_id"] = group_id
            item["duplicate_group_size"] = len(items)
    for item in manifest:
        item.setdefault("duplicate_group_id", None)
        item.setdefault("duplicate_group_size", 1)

    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    status_counts: dict[str, int] = defaultdict(int)
    for item in manifest:
        status_counts[item["match_status"]] += 1
    duplicate_groups = sum(1 for items in grouped.values() if len(items) > 1)
    print(
        json.dumps(
            {
                "files": len(manifest),
                "status_counts": dict(sorted(status_counts.items())),
                "duplicate_groups": duplicate_groups,
                "files_missing_amount": sum(
                    1
                    for item in manifest
                    if item["document_type"] == "invoice" and item["amount_paid"] is None
                ),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
