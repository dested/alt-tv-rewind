"""Reproducible research collection; raw material stays in gitignored data/archives.

Run from any directory: python plans/2026-09-21-collect-discourse.py
No database writes or paid services. Downloads are resumable at file boundaries.
"""
import concurrent.futures
import datetime
import gzip
import hashlib
import json
import pathlib
import re
import shutil
import tarfile
import time
import urllib.parse
import urllib.request
import zipfile
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "data/archives/research-2026-09-21"
OUT.mkdir(parents=True, exist_ok=True)
RESULTS = []


def save_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def fetch(url, relative, expected_size=None, expected_sha1=None):
    path = OUT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    entry = {"url": url, "file": str(path.relative_to(ROOT)).replace("\\", "/")}
    try:
        cached = path.exists()
        if not cached:
            request = urllib.request.Request(url, headers={"User-Agent": "alt-tv-rewind archival research"})
            with urllib.request.urlopen(request, timeout=60) as response:
                entry["httpStatus"] = response.status
                entry["finalUrl"] = response.url
                with path.with_suffix(path.suffix + ".partial").open("wb") as stream:
                    shutil.copyfileobj(response, stream)
            path.with_suffix(path.suffix + ".partial").replace(path)
        size = path.stat().st_size
        if expected_size is not None and size != int(expected_size):
            raise ValueError(f"Expected {expected_size} bytes; got {size}")
        if expected_sha1:
            with path.open("rb") as stream:
                actual = hashlib.file_digest(stream, "sha1").hexdigest()
            if actual != expected_sha1:
                raise ValueError("Internet Archive SHA-1 mismatch")
        entry.update(bytes=size, sha256=sha256(path), cached=cached,
                     verifiedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), ok=True)
    except Exception as exc:
        entry.update(ok=False, error=str(exc))
    RESULTS.append(entry)
    return entry


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)


def collect_usenet():
    targets = [("usenet-rec", "rec.arts.tv"), ("usenet-rec", "rec.arts.animation"),
               ("usenet-alt", "alt.tv.game-shows"),
               ("usenet-alt", "alt.tv.familyguy"),
               ("usenet-alt", "alt.tv.simpsons.itchy-scratchy")]
    for item, group in targets:
        meta_name = item + "-metadata.json"
        fetch("https://archive.org/metadata/" + item, meta_name)
        metadata = json.loads((OUT / meta_name).read_text(encoding="utf-8"))
        filename = group + ".mbox.zip"
        info = next(f for f in metadata["files"] if f["name"] == filename)
        result = fetch(f"https://archive.org/download/{item}/{filename}", filename,
                       info["size"], info.get("sha1"))
        if not result["ok"]:
            print(json.dumps(result), flush=True)
            continue
        destination = OUT / (group + ".mbox")
        if not destination.exists():
            with zipfile.ZipFile(OUT / filename) as archive:
                member = next(m for m in archive.infolist() if m.filename.endswith(".mbox"))
                with archive.open(member) as source, destination.with_suffix(".partial").open("wb") as target:
                    shutil.copyfileobj(source, target)
                destination.with_suffix(".partial").replace(destination)
        RESULTS.append({"file": str(destination.relative_to(ROOT)).replace("\\", "/"),
                        "derivedFrom": filename, "bytes": destination.stat().st_size,
                        "sha256": sha256(destination), "ok": True})
        print(f"Collected {group}: {destination.stat().st_size:,} bytes", flush=True)


def collect_capsules():
    url = "https://simpsonsarchive.com/episodes.html"
    fetch(url, "simpsons-capsules-index.html")
    parser = Links()
    parser.feed((OUT / "simpsons-capsules-index.html").read_text(encoding="utf-8", errors="replace"))
    links = sorted({urllib.parse.urljoin(url, h) for h in parser.links
                    if re.search(r"episodes/[0-9A-Z]{4,6}\.(?:html|txt)$", h)})
    save_json(OUT / "capsule-urls.json", links)
    def one(link):
        result = fetch(link, "capsules/" + link.rsplit("/", 1)[1])
        time.sleep(0.4)
        return result
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(one, links))
    print(f"Capsules: {sum(r['ok'] for r in results)}/{len(links)} downloaded", flush=True)


def collect_southpark():
    item = "southpark.cc.com_forum_20240110"
    fetch("https://archive.org/metadata/" + item, "southpark-archive-metadata.json")
    metadata = json.loads((OUT / "southpark-archive-metadata.json").read_text(encoding="utf-8"))
    indexes = [f for f in metadata["files"]
               if re.fullmatch(r"southpark.cc.com-forum-\d+\.warc.os.cdx.gz", f["name"])]
    # Four independently verified episode topics, including every captured offset.
    topics = {"15576", "15753", "18874", "19318"}
    selected = {}
    all_topics = set()
    rows = 0
    for info in indexes:
        name = info["name"]
        result = fetch(f"https://archive.org/download/{item}/{name}", "southpark-indexes/" + name,
                       info["size"], info.get("sha1"))
        if not result["ok"]:
            continue
        with gzip.open(OUT / "southpark-indexes" / name, "rt") as stream:
            next(stream)
            for line in stream:
                p = line.split()
                if len(p) != 11 or p[4] != "200":
                    continue
                query = urllib.parse.parse_qs(urllib.parse.urlsplit(p[2]).query)
                if "viewtopic.php" not in p[2] or "t" not in query:
                    continue
                rows += 1
                topic = query["t"][0]
                all_topics.add(topic)
                if topic in topics:
                    start = query.get("start", ["0"])[0]
                    key = (topic, start)
                    if key not in selected or p[1] > selected[key][1]:
                        selected[key] = p
    save_json(OUT / "southpark-selected-records.json", list(selected.values()))
    def one(kv):
        (topic, start), p = kv
        length, offset = int(p[8]), int(p[9])
        path = OUT / "southpark-threads" / f"{topic}-{start}.warc.gz"
        path.parent.mkdir(exist_ok=True)
        url = "https://archive.org/download/" + p[10]
        entry = {"originalUrl": p[2], "captureTimestamp": p[1], "warcUrl": url,
                 "offset": offset, "length": length,
                 "file": str(path.relative_to(ROOT)).replace("\\", "/")}
        try:
            if not path.exists():
                request = urllib.request.Request(url, headers={"Range": f"bytes={offset}-{offset+length-1}"})
                with urllib.request.urlopen(request, timeout=40) as response:
                    if response.status != 206:
                        raise ValueError(f"Range not honored: HTTP {response.status}")
                    blob = response.read(length + 1)
                if len(blob) != length:
                    raise ValueError("Range length mismatch")
                gzip.decompress(blob)
                path.write_bytes(blob)
            raw = gzip.decompress(path.read_bytes())
            text = raw.decode("utf-8", errors="replace")
            title = re.search(r"<title>(.*?)</title>", text, re.S)
            entry.update(ok=True, sha256=sha256(path), title=title.group(1) if title else None,
                         postBlocks=len(re.findall(r'class="author"', text)))
        except Exception as exc:
            entry.update(ok=False, error=str(exc))
        RESULTS.append(entry)
        time.sleep(0.1)
        return entry
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(one, sorted(selected.items())))
    save_json(OUT / "southpark-collection-summary.json", {
        "scope": "Three base WARC indexes; update/requisite indexes excluded; four selected topics only",
        "indexedTopicPageRecords": rows, "distinctIndexedTopicIds": len(all_topics),
        "selectedPages": len(selected), "successfulPages": sum(r['ok'] for r in results),
        "postBlocks": sum(r.get('postBlocks', 0) for r in results), "pages": results})
    print(f"South Park: {sum(r['ok'] for r in results)}/{len(selected)} selected pages downloaded", flush=True)


if __name__ == "__main__":
    try:
        # Separate source hosts; requests within a source stay bounded.
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            futures = [pool.submit(fn) for fn in (collect_usenet, collect_capsules, collect_southpark)]
            for future in concurrent.futures.as_completed(futures):
                future.result()
    finally:
        save_json(OUT / "collection-manifest.json", RESULTS)
    failures = [r for r in RESULTS if not r.get("ok")]
    print(f"Manifest: {len(RESULTS)} records; {len(failures)} failures", flush=True)
    raise SystemExit(bool(failures))
