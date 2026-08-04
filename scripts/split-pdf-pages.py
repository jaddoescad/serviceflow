#!/usr/bin/env python3

import argparse
import json
from pathlib import Path

from pypdf import PdfReader, PdfWriter


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create invoice-specific PDFs from verified page ranges."
    )
    parser.add_argument("--manifest", required=True)
    args = parser.parse_args()

    tasks = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    completed = []
    for task in tasks:
        source = Path(task["source"])
        output = Path(task["output"])
        page_start = int(task["page_start"])
        page_end = int(task["page_end"])
        reader = PdfReader(source)
        if page_start < 1 or page_end < page_start or page_end > len(reader.pages):
            raise ValueError(
                f"Invalid page range {page_start}-{page_end} for {source} "
                f"with {len(reader.pages)} pages"
            )
        writer = PdfWriter()
        for page_index in range(page_start - 1, page_end):
            writer.add_page(reader.pages[page_index])
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("wb") as stream:
            writer.write(stream)
        reopened = PdfReader(output)
        expected_pages = page_end - page_start + 1
        if len(reopened.pages) != expected_pages:
            raise ValueError(
                f"Expected {expected_pages} pages after splitting {source}; "
                f"found {len(reopened.pages)}"
            )
        completed.append(
            {
                "output": str(output),
                "page_count": len(reopened.pages),
            }
        )

    print(json.dumps({"completed": completed}, indent=2))


if __name__ == "__main__":
    main()
