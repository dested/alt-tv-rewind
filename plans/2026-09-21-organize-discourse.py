"""Offline source-aware research bundle. Does not write to the application DB.

Run: python plans/2026-09-21-organize-discourse.py [--adapter all|none|usenet|forums|capsules]
The adapters retain original downloads and write local JSONL under organized/.
This coordinator verifies them, indexes artifacts, and writes show associations.
"""
import argparse
import collections
import contextlib
import datetime
import hashlib
import importlib.util
import json
import pathlib
import sys

sys.dont_write_bytecode = True

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "data/archives/research-2026-09-21"
OUT = RAW / "organized"
VERSION = 1


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def rows(path):
    with path.open(encoding="utf-8") as stream:
        for number, line in enumerate(stream, 1):
            try:
                yield json.loads(line)
            except ValueError as exc:
                raise ValueError(f"{path.name}:{number}: invalid JSON") from exc


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".partial")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def write_row(stream, value):
    stream.write(json.dumps(value, ensure_ascii=False) + "\n")


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify_and_index():
    manifest = {r["file"]: r for r in read_json(RAW / "collection-manifest.json") if r.get("ok")}
    candidates = collections.defaultdict(list)
    for candidate in read_json(RAW / "candidate-metadata.json"):
        source_id = "usenet-" + candidate["sourceGroup"].replace(".", "-")
        candidates[(source_id, "usenet:" + candidate["idHash"])].append(candidate)

    required_record = {"schemaVersion", "recordId", "canonicalId", "sourceId", "kind", "externalId",
                       "threadExternalId", "originalUrl", "title", "author", "postedAt", "postedDate",
                       "datePrecision", "dateTimezone", "dateRaw", "bodyText", "contentSha256"}
    required_observation = {"schemaVersion", "observationId", "recordId", "sourceId", "artifactPath",
                            "artifactSha256", "locator", "originalUrl", "capturedAt", "retrievedAt", "contentSha256"}
    expected_sources = {"usenet-" + group.replace(".", "-") for group in
                        ["rec.arts.tv", "rec.arts.animation", "alt.tv.game-shows", "alt.tv.familyguy",
                         "alt.tv.simpsons.itchy-scratchy"]} | {"simpsons-archive-capsules", "southpark-official-forum"}
    # This is a dated, fixed collection. Counts guard against structurally valid
    # but truncated adapter output; raw checksums below pin the underlying bytes.
    expected_counts = {
        "usenet-rec-arts-tv": (173216, 173391),
        "usenet-rec-arts-animation": (129714, 132443),
        "usenet-alt-tv-game-shows": (77566, 77660),
        "usenet-alt-tv-familyguy": (852, 852),
        "usenet-alt-tv-simpsons-itchy-scratchy": (5400, 5409),
        "southpark-official-forum": (1324, 1326),
        "simpsons-archive-capsules": (281, 281),
    }
    directories = sorted((OUT / "sources").iterdir())
    require({d.name for d in directories if d.is_dir()} == expected_sources, "Missing or unexpected source directories")
    source_summaries, canonical_ids, used_artifacts = [], set(), collections.defaultdict(set)
    candidate_memberships = other_memberships = 0
    association_path = OUT / "show-associations.jsonl"
    association_tmp = association_path.with_suffix(".jsonl.partial")
    with association_tmp.open("w", encoding="utf-8", newline="\n") as associations:
        for directory in directories:
            if not directory.is_dir():
                continue
            source = read_json(directory / "source.json")
            source_id = source["sourceId"]
            require(source_id == directory.name, "Source directory/identity mismatch")
            require(source["schemaVersion"] == VERSION, "Unsupported source version")
            records, observed, observation_ids = {}, set(), set()
            kinds, precision, years = collections.Counter(), collections.Counter(), collections.Counter()
            for record in rows(directory / "records.jsonl"):
                require(required_record <= record.keys(), f"Incomplete record in {source_id}")
                require(record["sourceId"] == source_id and record["schemaVersion"] == VERSION, "Record source/version mismatch")
                rid = record["recordId"]
                require(rid == digest(source_id + ":" + record["externalId"]), "Unstable record ID")
                if source_id.startswith("usenet-"):
                    canonical_id = "usenet:" + digest(record["externalId"])
                elif source_id == "southpark-official-forum":
                    canonical_id = "forum:" + source_id + ":" + record["externalId"]
                else:
                    canonical_id = "document:" + source_id + ":" + record["externalId"]
                require(record["canonicalId"] == canonical_id, "Incorrect canonical identity")
                require(rid not in records, f"Duplicate record ID in {source_id}")
                require(digest(record["bodyText"]) == record["contentSha256"], "Record content hash mismatch")
                require(record["datePrecision"] in {"second", "minute", "day", "unknown"}, "Invalid date precision")
                if record["datePrecision"] in {"day", "unknown"}:
                    require(record["postedAt"] is None, "Imputed instant for day-only/unknown date")
                if record["postedAt"] is not None:
                    stamp = datetime.datetime.fromisoformat(record["postedAt"].replace("Z", "+00:00"))
                    require(stamp.utcoffset() is not None, "Timestamp without a timezone")
                if record["postedDate"]:
                    datetime.date.fromisoformat(record["postedDate"])
                    years[record["postedDate"][:4]] += 1
                if record["kind"] == "compiled_document":
                    require(record["postedAt"] is None and record["postedDate"] is None, "Document dates used as post dates")
                records[rid] = record["contentSha256"]
                canonical_ids.add(record["canonicalId"])
                kinds[record["kind"]] += 1
                precision[record["datePrecision"]] += 1
                for candidate in candidates.pop((source_id, record["canonicalId"]), []):
                    write_row(associations, {"schemaVersion": VERSION, "recordId": rid, "sourceId": source_id,
                              "showId": candidate["show"], "status": "candidate", "episodeId": None,
                              "evidence": "title_keyword_in_subject" if candidate["subjectMatch"] else "title_keyword_in_body",
                              "note": "1989–2009 broad screen; may be incidental, quoted or spam; not episode attribution"})
                    candidate_memberships += 1
                if source_id in {"southpark-official-forum", "simpsons-archive-capsules"}:
                    write_row(associations, {"schemaVersion": VERSION, "recordId": rid, "sourceId": source_id,
                              "showId": "south-park" if source_id == "southpark-official-forum" else "simpsons",
                              "status": "source_context", "episodeId": None,
                              "evidence": "selected_official_episode_topic" if source_id == "southpark-official-forum" else "show_capsule_collection",
                              "note": "Source context is not confirmation of original-airing timing"})
                    other_memberships += 1
            conflicts = 0
            with contextlib.ExitStack() as opened:
                raw_streams = {}
                for observation in rows(directory / "observations.jsonl"):
                    require(required_observation <= observation.keys(), f"Incomplete observation in {source_id}")
                    require(observation["sourceId"] == source_id and observation["schemaVersion"] == VERSION, "Observation source/version mismatch")
                    rid, oid = observation["recordId"], observation["observationId"]
                    require(rid in records, "Observation points to missing record")
                    require(oid not in observation_ids, "Duplicate observation ID")
                    observation_ids.add(oid)
                    observed.add(rid)
                    path = observation["artifactPath"]
                    require(path in manifest, f"Raw artifact absent from manifest: {path}")
                    require(observation["artifactSha256"] == manifest[path]["sha256"], "Artifact provenance hash mismatch")
                    if source_id.startswith("usenet-"):
                        require(observation["recordOrdinal"] == len(observation_ids), "Noncontiguous mbox ordinal")
                        require(observation["locator"] == "record:" + str(observation["recordOrdinal"]), "Invalid mbox locator")
                        require(oid == digest(path + "#" + str(observation["recordOrdinal"])), "Unstable mbox observation ID")
                        if path not in raw_streams:
                            raw_streams[path] = opened.enter_context((ROOT / path).open("rb"))
                        raw_stream = raw_streams[path]
                        require(observation["byteOffset"] == raw_stream.tell(), "Mbox byte coverage gap/overlap")
                        require(observation["byteLength"] > 0, "Empty mbox occurrence")
                        raw = raw_stream.read(observation["byteLength"])
                        require(len(raw) == observation["byteLength"], "Mbox locator exceeds file")
                        require(hashlib.sha256(raw).hexdigest() == observation["rawSha256"], "Mbox locator/raw hash mismatch")
                    elif source_id == "southpark-official-forum":
                        require(digest(observation["bodyText"]) == observation["contentSha256"], "Forum observation body hash mismatch")
                        post_id = observation["locator"].removeprefix("#p")
                        require(post_id.isdigit() and rid == digest(source_id + ":" + post_id), "Forum post locator mismatch")
                        require(oid == digest(path + "#" + post_id), "Unstable forum observation ID")
                    else:
                        require(observation["locator"] == "document", "Invalid capsule locator")
                        require(oid == digest(path + "#document"), "Unstable capsule observation ID")
                        require(records[rid] == observation["contentSha256"], "Capsule observation hash mismatch")
                    used_artifacts[path].add(source_id)
                    conflicts += records[rid] != observation["contentSha256"]
                for raw_stream in raw_streams.values():
                    require(not raw_stream.read(1), "Unobserved bytes at end of mbox")
            require(observed == records.keys(), f"Record missing raw observation in {source_id}")
            require((len(records), len(observation_ids)) == expected_counts[source_id], f"Incomplete or changed collection: {source_id}")
            source_summaries.append({**source, "records": len(records), "observations": len(observation_ids),
                                     "bodyVariantObservations": conflicts, "kinds": dict(kinds),
                                     "datePrecisionCounts": dict(precision), "years": dict(sorted(years.items()))})
            print(f"Verified {source_id}: {len(records):,} records / {len(observation_ids):,} observations", flush=True)
    require(not candidates, f"Unresolved candidate provenance: {sum(map(len, candidates.values()))}")

    # Verify the original bytes once per file, including supporting ZIPs and indexes.
    for path, entry in manifest.items():
        artifact = (ROOT / path).resolve()
        require(artifact.is_relative_to(RAW.resolve()), "Artifact path outside the research collection")
        with artifact.open("rb") as stream:
            actual = hashlib.file_digest(stream, "sha256").hexdigest()
        require(actual == entry["sha256"], f"Raw file integrity failure: {path}")
    artifact_tmp = OUT / "artifacts.jsonl.partial"
    with artifact_tmp.open("w", encoding="utf-8", newline="\n") as stream:
        for path, entry in sorted(manifest.items()):
            write_row(stream, {"schemaVersion": VERSION, "artifactId": digest(path + ":" + entry["sha256"]),
                      "sourceIds": sorted(used_artifacts[path]), "artifactPath": path, "artifactSha256": entry["sha256"],
                      "role": "record_evidence" if path in used_artifacts and used_artifacts[path] else "collection_support",
                      "collectionEvidence": entry})
    artifact_tmp.replace(OUT / "artifacts.jsonl")
    association_tmp.replace(association_path)
    save(OUT / "sources.json", source_summaries)
    summary = {"schemaVersion": VERSION, "builtAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
               "directory": OUT.relative_to(ROOT).as_posix(), "scope": "Research files only; no application database imports",
               "sourceCount": len(source_summaries), "recordCount": sum(s["records"] for s in source_summaries),
               "observationCount": sum(s["observations"] for s in source_summaries), "canonicalContentCount": len(canonical_ids),
               "candidateShowAssociations": candidate_memberships, "contextShowAssociations": other_memberships,
               "verifiedRawArtifacts": len(manifest), "sources": source_summaries,
               "limitations": ["Show keyword associations retain the original audit's false positives and omissions.",
                               "Full Usenet sources include years outside 1989–2009; filter original posting evidence before using them.",
                               "A compiled document is not a timestamped fan post.",
                               "One record per source/native ID; canonical IDs link Usenet crossposts across sources.",
                               "First occurrence supplies canonical body; observations retain pointers to every raw copy and body variant.",
                               "Verification timestamps do not establish original retrieval or historical capture times."]}
    save(OUT / "summary.json", summary)
    save(ROOT / "plans/2026-09-21-organized-discourse-inventory.json", summary)
    print(json.dumps({k: v for k, v in summary.items() if k != "sources"}, indent=2))
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adapter", choices=["all", "none", "usenet", "forums", "capsules"], default="all")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    adapters = ["usenet", "forums", "capsules"] if args.adapter == "all" else ([] if args.adapter == "none" else [args.adapter])
    for name in adapters:
        path = ROOT / f"plans/2026-09-21-organize-{name}.py"
        spec = importlib.util.spec_from_file_location("discourse_" + name, path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        module.run(ROOT, OUT)
    verify_and_index()


if __name__ == "__main__":
    main()
