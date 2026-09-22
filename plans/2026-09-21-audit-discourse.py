"""Audit existing coverage and derive deduplicated candidate mboxes from new groups.

Candidates are keyword matches, NOT verified episode attributions or spam-filtered posts.
Only messages dated 1989-2009 enter candidate files. Full source mboxes are retained.
"""
import collections
import datetime
import email.header
import email.utils
import hashlib
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "data/archives/research-2026-09-21"
SHOWS = {"family-guy": r"\bfamily[ -]+guy\b", "simpsons": r"\bsimpsons?\b",
         "south-park": r"\bsouth[ -]*park\b", "seinfeld": r"\bseinfeld\b"}


def save(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def messages(path):
    current = []
    with path.open("rb") as stream:
        for line in stream:
            if line.startswith(b"From ") and current:
                yield b"".join(current)
                current = []
            current.append(line)
    if current:
        yield b"".join(current)


def field(headers, name):
    match = re.search(rb"^" + name.encode() + rb":[ \t]*(.*(?:\n[ \t]+.*)*)", headers, re.M | re.I)
    return re.sub(rb"\n[ \t]+", b" ", match.group(1)).decode("latin-1").strip() if match else ""


def decode_header(value):
    try:
        return str(email.header.make_header(email.header.decode_header(value)))
    except (LookupError, UnicodeError):
        return value


def date_value(value):
    try:
        return email.utils.parsedate_to_datetime(value).date().isoformat()
    except (TypeError, ValueError, OverflowError):
        try:
            return datetime.date.fromisoformat(value[:10].replace("/", "-")).isoformat()
        except ValueError:
            return None


def main():
    existing, baseline = {}, []
    for slug in SHOWS:
        ids, years, dates = set(), collections.Counter(), []
        missing = date_only = total = 0
        with (ROOT / f"data/work/{slug}/messages.jsonl").open(encoding="utf-8") as stream:
            for line in stream:
                message = json.loads(line)
                total += 1
                ids.add(message["messageId"])
                date_only += bool(message.get("dateOnly"))
                if message.get("postedAt"):
                    day = message["postedAt"][:10]
                    years[day[:4]] += 1
                    dates.append(day)
                else:
                    missing += 1
        existing[slug] = ids
        baseline.append({"show": slug, "records": total, "missingDate": missing,
                         "dateOnly": date_only, "earliest": min(dates), "latest": max(dates),
                         "years": dict(sorted(years.items()))})
    save("baseline-coverage.json", baseline)
    matchers = {slug: re.compile(pattern, re.I) for slug, pattern in SHOWS.items()}
    seen = {slug: set(ids) for slug, ids in existing.items()}
    candidates = OUT / "candidates"
    candidates.mkdir(exist_ok=True)
    writers = {slug: (candidates / (slug + ".mbox")).open("wb") for slug in SHOWS}
    counters = {slug: collections.Counter() for slug in SHOWS}
    years_new = {slug: collections.Counter() for slug in SHOWS}
    source_reports, candidate_metadata = [], []
    try:
        for group in ["rec.arts.tv", "rec.arts.animation", "alt.tv.game-shows",
                      "alt.tv.familyguy", "alt.tv.simpsons.itchy-scratchy"]:
            count, missing, years = 0, 0, collections.Counter()
            for raw in messages(OUT / (group + ".mbox")):
                headers, _, body = raw.replace(b"\r\n", b"\n").partition(b"\n\n")
                day = date_value(field(headers, "Date"))
                count += 1
                if not day:
                    missing += 1
                    continue
                years[day[:4]] += 1
                if not "1989-01-01" <= day <= "2009-12-31":
                    continue
                subject = decode_header(field(headers, "Subject"))
                # Broad recall screen; encoded bodies and episode-only titles can be missed.
                text = subject + "\n" + body.decode("latin-1")
                message_id = field(headers, "Message-ID")
                key = message_id or "sha256:" + hashlib.sha256(raw).hexdigest()
                for slug, matcher in matchers.items():
                    if not matcher.search(text):
                        continue
                    counters[slug]["keywordMatches"] += 1
                    if key in existing[slug]:
                        counters[slug]["alreadyInShowArchive"] += 1
                        continue
                    if key in seen[slug]:
                        counters[slug]["duplicateAcrossNewSources"] += 1
                        continue
                    seen[slug].add(key)
                    writers[slug].write(raw)
                    counters[slug]["newCandidates"] += 1
                    years_new[slug][day[:4]] += 1
                    direct = bool(matcher.search(subject))
                    counters[slug]["subjectMatches" if direct else "bodyOnlyMatches"] += 1
                    candidate_metadata.append({"show": slug, "sourceGroup": group, "date": day,
                                               "subject": subject, "subjectMatch": direct,
                                               "idHash": hashlib.sha256(key.encode()).hexdigest()})
            source_reports.append({"group": group, "records": count, "missingDate": missing,
                                   "years": dict(sorted(years.items()))})
            print(f"Audited {group}: {count:,} records", flush=True)
    finally:
        for writer in writers.values():
            writer.close()
    report = {"scope": "1989-2009 title keywords in subject/body; not episode attribution; includes quoted mentions and spam",
              "baseline": baseline, "sources": source_reports,
              "candidates": {s: {**dict(counters[s]), "years": dict(sorted(years_new[s].items()))} for s in SHOWS}}
    save("coverage-and-candidates.json", report)
    save("candidate-metadata.json", candidate_metadata)
    print(json.dumps(report["candidates"], indent=2), flush=True)


if __name__ == "__main__":
    main()
