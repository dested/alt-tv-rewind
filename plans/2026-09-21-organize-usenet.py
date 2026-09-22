"""Offline, source-aware JSONL organization of five collected Usenet mboxes.

Raw files are immutable; records keep the first occurrence per source/Message-ID,
while observations retain every occurrence, including conflicting body variants.
No database writes, network requests, third-party packages, or inferred clocks.
"""
import collections
import datetime as dt
import email.header
import email.parser
import email.policy
import email.utils
import hashlib
import json
import pathlib
import re
from html.parser import HTMLParser

GROUPS = ["rec.arts.tv", "rec.arts.animation", "alt.tv.game-shows",
          "alt.tv.familyguy", "alt.tv.simpsons.itchy-scratchy"]
COLLECTION = pathlib.Path("data/archives/research-2026-09-21")


def digest(value):
    return hashlib.sha256(value.encode("utf-8") if isinstance(value, str) else value).hexdigest()


def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def emit(stream, value):
    stream.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")


def raw_records(path):
    """Yield exact source bytes, envelope included, and byte coordinates."""
    chunks, offset, start, ordinal = [], 0, 0, 0
    with path.open("rb") as stream:
        for line in stream:
            if line.startswith(b"From ") and chunks:
                ordinal += 1
                yield ordinal, start, b"".join(chunks)
                chunks, start = [], offset
            chunks.append(line)
            offset += len(line)
        if chunks:
            yield ordinal + 1, start, b"".join(chunks)


def decode_bytes(value, charset=None):
    for encoding in [charset, "utf-8", "windows-1252", "latin-1"]:
        if not encoding:
            continue
        try:
            return value.decode(encoding)
        except (LookupError, UnicodeError):
            pass
    return value.decode("utf-8", errors="replace")


def decode_header(value):
    parts = []
    try:
        for fragment, charset in email.header.decode_header(str(value or "")):
            parts.append(decode_bytes(fragment, charset) if isinstance(fragment, bytes) else fragment)
        return "".join(parts)
    except (ValueError, email.errors.HeaderParseError):
        return str(value or "")


class PlainHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.hidden = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1
        elif tag in ("p", "div", "br", "li", "tr", "h1", "h2", "blockquote"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def body_text(message):
    if message.is_multipart():
        children = message.get_payload()
        if message.get_content_subtype() == "alternative":
            preferred = next((p for p in children if p.get_content_type() == "text/plain"), None)
            if preferred is not None:
                return body_text(preferred)
            return body_text(children[-1]) if children else ""
        return "\n\n".join(body_text(p) for p in children
                           if p.get_content_disposition() != "attachment")
    if message.get_content_maintype() != "text":
        return ""
    payload = message.get_payload(decode=True)
    if payload is None:
        value = message.get_payload()
        text = value if isinstance(value, str) else ""
    else:
        text = decode_bytes(payload, message.get_content_charset())
    if message.get_content_subtype() == "html":
        parser = PlainHTML()
        parser.feed(text)
        text = "".join(parser.parts)
    # The original bytes remain retrievable; this is the readable projection.
    return re.sub(r"(?m)^>From ", "From ", text.replace("\r\n", "\n").replace("\r", "\n"))


def date_fields(raw):
    result = {"postedAt": None, "postedDate": None, "datePrecision": "unknown",
              "dateTimezone": None, "dateRaw": raw}
    if not raw:
        return result
    clean = re.sub(r"\([^)]*\)", " ", raw)
    clean = re.sub(r"\s+", " ", clean).strip()
    day = re.fullmatch(r"(\d{4})[/-](\d{1,2})[/-](\d{1,2})", clean)
    if day:
        try:
            result.update(postedDate=dt.date(*map(int, day.groups())).isoformat(), datePrecision="day")
        except ValueError:
            pass
        return result
    try:
        parsed = email.utils.parsedate_to_datetime(clean)
    except (TypeError, ValueError, OverflowError):
        return result
    clock = re.search(r"\b\d{1,2}:\d{2}(?::\d{2})?\b", clean)
    result["postedDate"] = parsed.date().isoformat()
    if not clock:
        result["datePrecision"] = "day"
        return result
    result["datePrecision"] = "second" if clock[0].count(":") == 2 else "minute"
    zone = clean[clock.end():].strip()
    result["dateTimezone"] = zone or None
    # Missing zone and RFC -0000 mean unknown timezone, not UTC.
    if parsed.tzinfo is not None:
        result["postedAt"] = parsed.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    return result


def author_value(raw):
    name, address = email.utils.parseaddr(decode_header(raw))
    name = name.strip().strip('"')
    # Neither addresses nor email-like names belong in the author field.
    if "@" in name:
        name = ""
    return {"externalId": None, "displayName": name or "unknown"} if raw else None


def run(root: pathlib.Path, out: pathlib.Path) -> dict:
    root, out = root.resolve(), out.resolve()
    manifest = json.loads((root / COLLECTION / "collection-manifest.json").read_text(encoding="utf-8"))
    artifacts = {entry.get("file"): entry for entry in manifest if entry.get("ok")}
    summaries = []
    parser = email.parser.BytesParser(policy=email.policy.compat32)
    for group in GROUPS:
        source_id = "usenet-" + group.replace(".", "-")
        destination = out / "sources" / source_id
        destination.mkdir(parents=True, exist_ok=True)
        relative = (COLLECTION / (group + ".mbox")).as_posix()
        artifact = artifacts[relative]
        path = root / relative
        with path.open("rb") as stream:
            artifact_hash = hashlib.file_digest(stream, "sha256").hexdigest()
        if artifact_hash != artifact["sha256"]:
            raise ValueError(f"Artifact differs from collection manifest: {relative}")
        seen = {}
        stats = collections.Counter()
        precisions, newsgroups = collections.Counter(), collections.Counter()
        records_tmp = destination / "records.jsonl.partial"
        observations_tmp = destination / "observations.jsonl.partial"
        with records_tmp.open("w", encoding="utf-8", newline="\n") as records, \
                observations_tmp.open("w", encoding="utf-8", newline="\n") as observations:
            for ordinal, offset, raw in raw_records(path):
                raw_hash = digest(raw)
                payload = raw.partition(b"\n")[2] if raw.startswith(b"From ") else raw
                message = parser.parsebytes(payload)
                # Match audit identity exactly, including brackets and original case.
                external_id = re.sub(r"\r?\n[ \t]+", " ", str(message.get("Message-ID", ""))).strip()
                missing_id = not external_id
                if missing_id:
                    external_id = "sha256:" + raw_hash
                record_id = digest(source_id + ":" + external_id)
                canonical_id = "usenet:" + digest(external_id)
                text = body_text(message)
                text_hash = digest(text)
                original_url = None
                observation = {
                    "schemaVersion": 1, "observationId": digest(relative + "#" + str(ordinal)),
                    "recordId": record_id, "sourceId": source_id, "artifactPath": relative,
                    "artifactSha256": artifact_hash, "locator": "record:" + str(ordinal),
                    "recordOrdinal": ordinal, "byteOffset": offset, "byteLength": len(raw),
                    "originalUrl": original_url, "capturedAt": None, "retrievedAt": None,
                    "contentSha256": text_hash, "rawSha256": raw_hash,
                }
                emit(observations, observation)
                stats["observations"] += 1
                if external_id in seen:
                    stats["duplicateObservations"] += 1
                    if seen[external_id] != text_hash:
                        stats["conflictingBodyObservations"] += 1
                    continue
                seen[external_id] = text_hash
                dates = date_fields(str(message.get("Date", "")).strip() or None)
                groups = [g.strip() for g in str(message.get("Newsgroups", "")).split(",") if g.strip()]
                record = {
                    "schemaVersion": 1, "recordId": record_id, "canonicalId": canonical_id,
                    "sourceId": source_id, "kind": "post", "externalId": external_id,
                    "identityMethod": "raw-sha256" if missing_id else "message-id",
                    "threadExternalId": None, "originalUrl": original_url,
                    "title": decode_header(message.get("Subject")),
                    "author": author_value(message.get("From")), **dates,
                    "bodyText": text, "contentSha256": text_hash, "newsgroups": groups,
                    "references": re.findall(r"<[^<>]+>", str(message.get("References", ""))),
                    "inReplyTo": str(message.get("In-Reply-To", "")).strip() or None,
                    "dateHeaders": {key: str(message[key]).strip() for key in
                                    ["Date", "NNTP-Posting-Date", "Injection-Date"] if message[key] is not None},
                    "dateDerivation": "Date header" if dates["postedDate"] else "unknown",
                }
                emit(records, record)
                stats["records"] += 1
                stats["missingMessageId"] += missing_id
                precisions[dates["datePrecision"]] += 1
                newsgroups.update(groups)
        records_tmp.replace(destination / "records.jsonl")
        observations_tmp.replace(destination / "observations.jsonl")
        summary = {"sourceId": source_id, "group": group, **dict(stats),
                   "datePrecisionCounts": dict(precisions), "declaredNewsgroupCounts": dict(newsgroups),
                   "artifactPath": relative, "artifactSha256": artifact_hash}
        source = {"schemaVersion": 1, "sourceId": source_id, "kind": "usenet", "name": group,
                  "homeUrl": "https://groups.google.com/g/" + group,
                  "groupsRead": [group], "recordCount": stats["records"],
                  "observationCount": stats["observations"], "notes": [
                      "First occurrence per source and exact Message-ID is the canonical readable record.",
                      "Every raw occurrence is retained as a byte-addressable observation, including body conflicts.",
                      "Original posting dates are never replaced with artifact capture or verification dates.",
                      "Unknown-zone clock values retain date and raw text; postedAt stays null.",
                      "Source association identifies the downloaded group; Newsgroups declares distribution.",
                      "Body text is complete MIME-decoded readable text, with HTML-only bodies reduced to text.",
                  ]}
        dump(destination / "source.json", source)
        dump(destination / "summary.json", summary)
        summaries.append(summary)
        print(f"{source_id}: {stats['records']:,} records; {stats['observations']:,} observations; "
              f"{stats['duplicateObservations']:,} duplicates; {stats['conflictingBodyObservations']:,} body conflicts", flush=True)
    result = {"schemaVersion": 1, "adapter": "usenet", "sources": summaries,
              "recordCount": sum(s["records"] for s in summaries),
              "observationCount": sum(s["observations"] for s in summaries)}
    dump(out / "usenet-summary.json", result)
    return result


if __name__ == "__main__":
    repository = pathlib.Path(__file__).resolve().parents[1]
    run(repository, repository / COLLECTION / "organized")
