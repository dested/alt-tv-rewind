"""Organize retained Simpsons capsules without network or synthetic post dates."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path

SOURCE_ID = "simpsons-archive-capsules"
RAW_DIR = Path("data/archives/research-2026-09-21")


def digest(value: str | bytes) -> str:
    return hashlib.sha256(value.encode("utf-8") if isinstance(value, str) else value).hexdigest()


class CapsuleHTML(HTMLParser):
    """Preserve PRE spacing and readable heading/block boundaries."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.title_parts: list[str] = []
        self.hidden = 0
        self.in_title = False
        self.in_head = False

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag == "head":
            self.in_head = True
        if tag == "title":
            self.in_title = True
        if tag in {"script", "style"}:
            self.hidden += 1
        if tag in {"br", "p", "div", "pre", "hr", "h1", "h2", "h3", "h4", "li", "tr"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag == "head":
            self.in_head = False
        if tag == "title":
            self.in_title = False
        if tag in {"script", "style"}:
            self.hidden = max(0, self.hidden - 1)
        if tag in {"p", "div", "pre", "h1", "h2", "h3", "h4", "li", "tr"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_parts.append(data)
        if not self.hidden and not self.in_head:
            self.parts.append(data)


def decode(raw: bytes) -> tuple[str, str]:
    match = re.search(rb"charset\s*=\s*[\"']?([\w-]+)", raw[:8192], re.I)
    candidates = [match.group(1).decode("ascii")] if match else []
    candidates.extend(["utf-8-sig", "cp1252", "latin-1"])
    for encoding in candidates:
        try:
            return raw.decode(encoding), encoding
        except (UnicodeDecodeError, LookupError):
            pass
    raise ValueError("No lossless source decoding available")


def document_text(raw: bytes) -> tuple[str, str, str, str]:
    decoded, encoding = decode(raw)
    # Many files with .html suffix are actually plain text.
    is_html = bool(re.search(r"<(?:html|head|body|pre|h1)(?:\s|>)", decoded, re.I))
    title = ""
    if is_html:
        parser = CapsuleHTML()
        parser.feed(decoded)
        parser.close()
        body = "".join(parser.parts)
        title = " ".join("".join(parser.title_parts).split())
    else:
        body = decoded
    body = body.replace("\r\n", "\n").replace("\r", "\n").replace("\x1a", "")
    body = re.sub(r"\n[ \t]*\n(?:[ \t]*\n)+", "\n\n", body).strip()
    if not title:
        first_line = next((line.strip() for line in body.splitlines() if line.strip()), "")
        title = re.split(r"\s{2,}|\s+Written by\b", first_line, maxsplit=1)[0]
    return body, title, encoding, "html" if is_html else "plain_text"


def parsed_date(raw: str) -> dict:
    cleaned = raw.strip().strip("(). ")
    # Keep explicit four-digit years; do not guess the century of two-digit dates.
    for fmt in ["%d-%b-%Y", "%d %B %Y", "%d %b %Y", "%b %d, %Y", "%B %d, %Y"]:
        try:
            return {"raw": raw.strip(), "date": datetime.strptime(cleaned.replace("Sept", "Sep"), fmt).date().isoformat(), "precision": "day"}
        except ValueError:
            pass
    return {"raw": raw.strip(), "date": None, "precision": "unknown"}


def metadata(body: str) -> dict:
    result: dict = {}
    code = re.search(r"Production code\s*:\s*([A-Za-z0-9]+)", body, re.I)
    if code:
        result["productionCode"] = code.group(1)
    air = re.search(r"Original\s+air\s*date[^\n:]*:\s*([^\n]+)", body, re.I)
    if air:
        result["originalAirDate"] = parsed_date(air.group(1))
    revision = re.search(r"Capsule\s+revision\s+([A-Za-z0-9]+)\s*[, (]+([^\n)]+)", body, re.I)
    if revision:
        result["revision"] = {"label": revision.group(1), **parsed_date(revision.group(2))}
    conversion = re.search(r"HTML conversion by[\s\S]{0,150}?\bon\s+(?:[A-Za-z]{3}\s+)?(\d{1,2}\s+[A-Za-z]+\s+\d{4})", body, re.I)
    if conversion:
        result["conversionDate"] = parsed_date(conversion.group(1))
    # These are source excerpts, not a legal interpretation or a reusable license.
    # Full text remains in bodyText; offsets refer to this exact normalized version.
    notices = []
    for match in re.finditer(r"(?im)^.*(?:copyright|not to be redistributed|not to be reproduced|all rights reserved).*$", body):
        end = body.find("\n\n", match.end())
        end = len(body) if end < 0 else end
        if not notices or match.start() >= notices[-1]["end"]:
            notices.append({"start": match.start(), "end": end, "text": body[match.start():end]})
    result["rightsNoticeSpans"] = notices
    return result


def run(root: Path, out: Path) -> dict:
    root = root.resolve()
    out = out.resolve()
    source_dir = out / "sources" / SOURCE_ID
    source_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = root / RAW_DIR / "collection-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entries = {item.get("file", "").replace("\\", "/"): item for item in manifest if item.get("ok")}
    source = {
        "schemaVersion": 1, "sourceId": SOURCE_ID, "kind": "capsule",
        "name": "The Simpsons Archive episode capsules",
        "homeUrl": "https://simpsonsarchive.com/episodes.html",
        "notes": [
            "Compiled documents containing reviews, observations, summaries and quotations; not original threads.",
            "Dates on documents are never used as individual post timestamps.",
            "Retained for local research; embedded redistribution notices remain attached.",
            "verifiedAt is an artifact verification time, not evidence of its first retrieval time.",
        ],
    }
    (source_dir / "source.json").write_text(json.dumps(source, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    count = 0
    formats: dict[str, int] = {}
    with (source_dir / "records.jsonl").open("w", encoding="utf-8", newline="\n") as records, (source_dir / "observations.jsonl").open("w", encoding="utf-8", newline="\n") as observations:
        for path in sorted((root / RAW_DIR / "capsules").glob("*")):
            if not path.is_file():
                continue
            artifact_path = path.relative_to(root).as_posix()
            entry = entries.get(artifact_path, {})
            raw = path.read_bytes()
            artifact_hash = digest(raw)
            if entry.get("sha256") and entry["sha256"] != artifact_hash:
                raise ValueError(f"Raw artifact no longer matches collection manifest: {artifact_path}")
            body, title, encoding, format_name = document_text(raw)
            if not body:
                raise ValueError(f"Empty capsule decoding: {artifact_path}")
            external_id = path.name
            record_id = digest(SOURCE_ID + ":" + external_id)
            original_url = entry.get("url") or "https://simpsonsarchive.com/episodes/" + external_id
            content_hash = digest(body)
            record = {
                "schemaVersion": 1, "recordId": record_id,
                "canonicalId": "document:" + SOURCE_ID + ":" + external_id,
                "sourceId": SOURCE_ID, "kind": "compiled_document", "externalId": external_id,
                "threadExternalId": None, "originalUrl": original_url, "title": title,
                "author": None, "postedAt": None, "postedDate": None, "datePrecision": "unknown",
                "dateTimezone": None, "dateRaw": None, "bodyText": body, "contentSha256": content_hash,
                "documentMetadata": metadata(body), "publicationStatus": "local_research_only",
                "sourceEncoding": encoding, "sourceFormat": format_name,
                "replacementCharacterCount": body.count("\ufffd"),
            }
            observation = {
                "schemaVersion": 1, "observationId": digest(artifact_path + "#document"),
                "recordId": record_id, "sourceId": SOURCE_ID, "artifactPath": artifact_path,
                "artifactSha256": artifact_hash, "locator": "document", "originalUrl": original_url,
                "capturedAt": None, "retrievedAt": None, "verifiedAt": entry.get("verifiedAt"),
                "contentSha256": content_hash,
            }
            records.write(json.dumps(record, ensure_ascii=False) + "\n")
            observations.write(json.dumps(observation, ensure_ascii=False) + "\n")
            count += 1
            formats[format_name] = formats.get(format_name, 0) + 1
    return {"sourceId": SOURCE_ID, "records": count, "observations": count, "formats": formats, "path": str(source_dir)}


if __name__ == "__main__":
    project_root = Path(__file__).resolve().parents[1]
    print(json.dumps(run(project_root, project_root / RAW_DIR / "organized"), indent=2))
