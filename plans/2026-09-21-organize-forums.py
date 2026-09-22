"""Normalize the locally collected South Park forum pages without network/DB access."""
import datetime as dt
import gzip
import hashlib
import html as html_module
import json
import pathlib
import re
import urllib.parse
from html.parser import HTMLParser

SOURCE = "southpark-official-forum"
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
BLOCK = {"p", "div", "br", "li", "ul", "ol", "pre", "blockquote"}


def digest(value):
    return hashlib.sha256(value).hexdigest()


def normalized_text(value):
    value = value.replace("\xa0", " ")
    return "\n".join(line.rstrip() for line in re.sub(r"\n[ \t]*\n(?:[ \t]*\n)+", "\n\n", value).strip().splitlines())


class Posts(HTMLParser):
    """Read post boundaries independently from nested quotes and profile dates."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.posts = []
        self.post = None
        self.page_text = []
        self.regions = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get("class", "").split()
        if tag not in VOID:
            self.stack.append(tag)
        depth = len(self.stack)
        if tag == "div" and "post" in classes and re.fullmatch(r"p\d+", attrs.get("id", "")):
            if self.post is not None:
                raise ValueError("Nested post boundary")
            self.post = {"id": attrs["id"][1:], "depth": depth, "body": [], "author": [], "notice": [], "name": [], "authorId": None}
            self.regions = {}
        if self.post is None:
            return
        if tag == "div" and "content" in classes:
            self.regions["body"] = depth
        if tag == "p" and "author" in classes:
            self.regions["author"] = depth
        if tag == "div" and "notice" in classes:
            self.regions["notice"] = depth
        if tag == "a" and "author" in self.regions and ("username" in classes or "username-coloured" in classes):
            self.regions["name"] = depth
            self.post["authorId"] = urllib.parse.parse_qs(urllib.parse.urlsplit(attrs.get("href", "")).query).get("u", [None])[0]
        if "body" in self.regions:
            if tag in BLOCK:
                self.post["body"].append("\n")
            if tag == "blockquote":
                self.post["body"].append("[quote]\n")
            if tag == "img" and attrs.get("alt"):
                self.post["body"].append(attrs["alt"])

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag not in self.stack:
            return
        depth = len(self.stack) - self.stack[::-1].index(tag)
        if self.post is not None:
            if "body" in self.regions:
                if tag == "blockquote":
                    self.post["body"].append("\n[/quote]\n")
                elif tag in BLOCK:
                    self.post["body"].append("\n")
            for region in list(self.regions):
                if self.regions[region] >= depth:
                    del self.regions[region]
            if depth <= self.post["depth"]:
                self.posts.append(self.post)
                self.post = None
                self.regions = {}
        self.stack = self.stack[:depth - 1]

    def handle_data(self, value):
        self.page_text.append(value)
        if self.post is not None and not any(tag in {"script", "style"} for tag in self.stack):
            for region in self.regions:
                self.post[region].append(value)


def parse_post_date(raw, timezone):
    if not raw:
        return None, None, "unknown"
    for fmt, precision in [("%a %b %d, %Y %I:%M %p", "minute"), ("%a %b %d, %Y %I:%M:%S %p", "second")]:
        try:
            value = dt.datetime.strptime(raw.strip(), fmt)
            instant = value.replace(tzinfo=dt.timezone.utc).isoformat().replace("+00:00", "Z") if timezone == "UTC" else None
            return instant, value.date().isoformat(), precision
        except ValueError:
            pass
    return None, None, "unknown"


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run(root: pathlib.Path, out: pathlib.Path) -> dict:
    root, out = pathlib.Path(root).resolve(), pathlib.Path(out).resolve()
    corpus = root / "data/archives/research-2026-09-21"
    manifest = json.loads((corpus / "southpark-collection-summary.json").read_text(encoding="utf-8"))
    dest = out / "sources" / SOURCE
    dest.mkdir(parents=True, exist_ok=True)
    records, observations, counts = {}, [], {}
    for page in sorted(manifest["pages"], key=lambda entry: entry["file"]):
        if not page.get("ok"):
            continue
        artifact_path = page["file"]
        blob = (root / artifact_path).read_bytes()
        artifact_sha = digest(blob)
        if artifact_sha != page["sha256"]:
            raise ValueError(f"Artifact checksum changed: {artifact_path}")
        raw = gzip.decompress(blob)
        # WARC exporter uses CR CR LF; normalize framing only, decode HTTP payload.
        normalized = raw.replace(b"\r\r\n", b"\n").replace(b"\r\n", b"\n")
        warc_header, response = normalized.split(b"\n\n", 1)
        http_header, payload = response.split(b"\n\n", 1)
        warc = dict(line.decode("utf-8", "replace").split(": ", 1) for line in warc_header.splitlines() if b": " in line)
        charset_match = re.search(rb"charset=([\w-]+)", http_header, re.I)
        charset = charset_match.group(1).decode("ascii") if charset_match else "utf-8"
        html = payload.decode(charset, "replace")
        parser = Posts()
        parser.feed(html)
        parser.close()
        if parser.post is not None:
            raise ValueError(f"Unclosed post: {artifact_path}")
        timezone_match = re.search(r"All times are\s+UTC\b", " ".join(parser.page_text))
        timezone = "UTC" if timezone_match else None
        topic = urllib.parse.parse_qs(urllib.parse.urlsplit(page["originalUrl"]).query)["t"][0]
        title_match = re.search(r"<title>(.*?)</title>", html, re.S)
        title = page.get("title") or (title_match.group(1) if title_match else None)
        if title:
            title = html_module.unescape(title).removesuffix(" | South Park Forums")
        for post in parser.posts:
            external_id = post["id"]
            record_id = digest((SOURCE + ":" + external_id).encode())
            original_url = f"https://southpark.cc.com/forum/viewtopic.php?p={external_id}#p{external_id}"
            author_text = "".join(post["author"])
            date_raw = author_text.rsplit("»", 1)[1].strip() if "»" in author_text else None
            posted_at, posted_date, precision = parse_post_date(date_raw, timezone)
            body = normalized_text("".join(post["body"]))
            content_sha = digest(body.encode("utf-8"))
            name = "".join(post["name"]).strip()
            author = {"externalId": post["authorId"], "displayName": name} if name else None
            notice = normalized_text("".join(post["notice"])) or None
            edit_match = re.search(r" on (.*?), edited (\d+) time", notice or "")
            edited_raw = edit_match.group(1) if edit_match else None
            edited_at, edited_date, edited_precision = parse_post_date(edited_raw, timezone)
            observation = {
                "schemaVersion": 1, "observationId": digest((artifact_path + "#" + external_id).encode()),
                "recordId": record_id, "sourceId": SOURCE, "artifactPath": artifact_path,
                "artifactSha256": artifact_sha, "locator": "#p" + external_id,
                "originalUrl": original_url, "capturedAt": warc.get("WARC-Date"), "retrievedAt": None,
                "contentSha256": content_sha, "bodyText": body,
                "capturedPageUrl": warc.get("WARC-Target-URI"), "warcRecordId": warc.get("WARC-Record-ID"),
                "warcPayloadDigest": warc.get("WARC-Payload-Digest"), "warcBlockDigest": warc.get("WARC-Block-Digest"),
                "archiveCollectionId": "southpark.cc.com_forum_20240110", "warcUrl": page["warcUrl"],
                "compressedOffset": page["offset"], "compressedLength": page["length"],
                "dateRaw": date_raw, "dateTimezone": timezone, "timezoneEvidence": "Page footer: All times are UTC" if timezone else None,
                "editNotice": notice, "editedDateRaw": edited_raw, "editedAt": edited_at,
                "editedDate": edited_date, "editedDatePrecision": edited_precision,
                "editCount": int(edit_match.group(2)) if edit_match else None,
                "extractor": "southpark-phpbb-warc-v1",
            }
            observations.append(observation)
            if record_id in records:
                prior = records[record_id]
                prior["observationCount"] += 1
                if prior["contentSha256"] != content_sha:
                    prior["hasContentConflict"] = True
                if prior["threadExternalId"] != topic:
                    raise ValueError(f"Post appears in multiple topics: {external_id}")
            else:
                records[record_id] = {
                    "schemaVersion": 1, "recordId": record_id, "canonicalId": f"forum:{SOURCE}:{external_id}",
                    "sourceId": SOURCE, "kind": "post", "externalId": external_id, "threadExternalId": topic,
                    "originalUrl": original_url, "title": title, "author": author,
                    "postedAt": posted_at, "postedDate": posted_date, "datePrecision": precision,
                    "dateTimezone": timezone, "dateRaw": date_raw, "bodyText": body,
                    "contentSha256": content_sha, "hasContentConflict": False, "observationCount": 1,
                }
        counts[artifact_path] = len(parser.posts)
        if len(parser.posts) != page["postBlocks"]:
            raise ValueError(f"Post count mismatch: {artifact_path}")
    write_json(dest / "source.json", {
        "schemaVersion": 1, "sourceId": SOURCE, "kind": "forum", "name": "South Park Forums",
        "homeUrl": "https://southpark.cc.com/forum/",
        "notes": ["Official South Park forum; archive provider is ArchiveTeam/Internet Archive, not the original community.",
                  "Four collected topics only; captures are from 2024 and posts include later replies.",
                  "Retrieval timestamps were not recorded for these WARC ranges and remain null.",
                  "Post text is the captured version; edit notices do not prove original wording.",
                  "Source post IDs deduplicate pagination overlap. Observations retain body variants.",
                  "Quoted text remains enclosed in [quote] markers. No reply parents are inferred."],
    })
    for name, values in [("records.jsonl", sorted(records.values(), key=lambda value: int(value["externalId"]))),
                         ("observations.jsonl", observations)]:
        with (dest / name).open("w", encoding="utf-8", newline="\n") as stream:
            for value in values:
                stream.write(json.dumps(value, ensure_ascii=False) + "\n")
    summary = {
        "sourceId": SOURCE, "records": len(records), "observations": len(observations), "artifacts": len(counts),
        "topics": len({r["threadExternalId"] for r in records.values()}),
        "duplicateObservations": len(observations) - len(records),
        "contentConflicts": sum(r["hasContentConflict"] for r in records.values()),
        "unknownDates": sum(r["datePrecision"] == "unknown" for r in records.values()),
        "unknownTimezones": sum(r["dateTimezone"] is None for r in records.values()),
    }
    write_json(dest / "summary.json", summary)
    return summary


if __name__ == "__main__":
    root = pathlib.Path(__file__).resolve().parents[1]
    print(json.dumps(run(root, root / "data/archives/research-2026-09-21/organized"), indent=2))
