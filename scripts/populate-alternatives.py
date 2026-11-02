#!/usr/bin/env python3
"""Populate the ``alternatives`` frontmatter block of term Markdown files.

The script queries the local glossary API for every term, cleans the returned
Arabic suggestions, deduplicates them against the primary translation and the
existing alternatives, and splices the new entries into the YAML frontmatter.
It is deliberately dependency-free (Python standard library only) and uses a
two-phase design: every file is read, fetched and planned first; writes only
happen after the complete planning pass succeeded.

The frontmatter parser is intentionally narrow.  It supports the exact shape
used by this repository:

    alternatives:
      - translation: ...
        note: ...

or an inline empty list:

    alternatives: []

Anything else (tabs, comments, unknown keys, wrapped scalars, flow lists with
content, CRLF, a BOM, ...) is reported as a per-file error and the file is left
untouched.  A column-0 ``- translation:`` entry is intentionally unsupported;
entries must be indented by at least one space.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import stat
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

TIMEOUT = 15.0
RETRY_DELAYS = (0.4, 1.0)
MAX_PAGES = 20
PAGE_LIMIT = 100
CIRCUIT_BREAKER_LIMIT = 5
DEFAULT_API = "http://127.0.0.1:8080"
DEFAULT_NOTES = "source"
SKIPPED_CAP = 50

PIPELINE_DESCRIPTION = (
    "clean_value (NFKC, strip digits/brackets/invisibles) -> "
    "split_synonyms (::, أو/او, punctuation) -> normalize_key dedupe against "
    "primary and existing alternatives; notes from glossaryAr/publisherAr"
)

DIGITS_RE = re.compile(r"[0-9\u0660-\u0669\u06f0-\u06f9]")
INVISIBLES_RE = re.compile(
    r"[\u200b-\u200f\u061c\u202a-\u202e\u2066-\u2069\ufeff]"
)
TATWEEL_RE = re.compile("\u0640")
TASHKEEL_RE = re.compile(
    "[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]"
)
ARABIC_LETTER_RE = re.compile(r"[\u0621-\u064a]")
LATIN_LETTER_RE = re.compile(r"[A-Za-z]")
OPENERS = "([{"
CLOSERS = ")]}"
BALANCED_PATTERNS = (
    re.compile(r"\([^()]*\)"),
    re.compile(r"\[[^\[\]]*\]"),
    re.compile(r"\{[^{}]*\}"),
)

SPLIT_RE = re.compile(r"::|\s+او\s+|\s+أو\s+|[;؛,،/]+")
EDGE_PUNCT = "-–—.,،؛;:/\\|!?؟«»\"“”‘’'()[]{}…"
TRANSLATION_MAP = str.maketrans(
    {
        "أ": "ا",
        "إ": "ا",
        "آ": "ا",
        "ٱ": "ا",
        "ى": "ي",
        "ی": "ي",
        "ئ": "ي",
        "ؤ": "و",
        "ک": "ك",
        "ۀ": "ه",
    }
)

UNSAFE_START = set("-?:,[]{}#&*!|>'\"%@`")
YAML_NULL_BOOL = {
    "null",
    "~",
    "true",
    "false",
    "yes",
    "no",
    "on",
    "off",
    "y",
    "n",
}

ALTERNATIVES_KEY_RE = re.compile(
    r"^alternatives[ ]*:[ ]*(?P<rest>\S.*)?$"
)
ENTRY_RE = re.compile(r"^(?P<ind> {1,})- translation:(?P<val> .*)$")
NOTE_RE = re.compile(r"^[ ]+note:(?P<val> .*)$")
BLANK_RE = re.compile(r"^ *$")
TOP_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]*[ ]*:")
SINGLE_QUOTED_RE = re.compile(r"^'(?:[^']|'')*'$", re.DOTALL)


class TermFileError(Exception):
    """A per-file parse or validation error."""


class ApiError(Exception):
    """A per-file API failure."""


def clean_value(raw: str) -> str:
    """Apply the shared cleaning pipeline to one value."""
    text = unicodedata.normalize("NFKC", raw or "")
    text = DIGITS_RE.sub("", text)

    for _ in range(5):
        before = text
        for pattern in BALANCED_PATTERNS:
            text = pattern.sub(" ", text)
        if text == before:
            break

    # Anything still opening is unmatched after the balanced passes.
    opener_indexes = [text.find(ch) for ch in OPENERS if ch in text]
    if opener_indexes:
        text = text[: min(opener_indexes)]
    text = re.sub(r"[)\]}]", "", text)

    text = INVISIBLES_RE.sub("", text)
    text = TATWEEL_RE.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_key(value: str) -> str:
    """Normalize an Arabic value for comparison (never stored)."""
    text = unicodedata.normalize("NFKC", value or "")
    text = TASHKEEL_RE.sub("", text)
    text = INVISIBLES_RE.sub("", text)
    text = TATWEEL_RE.sub("", text)
    text = text.translate(TRANSLATION_MAP)
    text = re.sub(r"\s+", " ", text).strip()
    return text.casefold()


def split_synonyms(raw: str) -> list[str]:
    """Split, clean and deduplicate a raw API ``arabic`` value."""
    text = clean_value(raw)
    fragments = SPLIT_RE.split(text)
    result: list[str] = []
    seen: set[str] = set()
    for fragment in fragments:
        value = clean_value(fragment).strip(EDGE_PUNCT)
        value = re.sub(r"\s+", " ", value).strip()
        if len(value) < 2:
            continue
        has_arabic = bool(ARABIC_LETTER_RE.search(value))
        has_latin = len(LATIN_LETTER_RE.findall(value)) >= 2
        if not has_arabic and not has_latin:
            continue
        key = normalize_key(value)
        if len(key) < 2 or key in seen:
            continue
        seen.add(key)
        result.append(value)
    return result


def clean_label(raw: str) -> str:
    """Clean a glossary/publisher label without touching its middle."""
    text = unicodedata.normalize("NFKC", raw or "")
    text = INVISIBLES_RE.sub("", text)
    text = TATWEEL_RE.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = text.strip(EDGE_PUNCT + " \t")
    return re.sub(r"\s+", " ", text).strip()


def quote_scalar(value: str) -> str:
    """Render a YAML scalar, preferring the plain form when safe."""
    value = "" if value is None else str(value)
    has_control = any(ord(ch) < 32 or ord(ch) == 127 for ch in value)
    if has_control:
        return json.dumps(value, ensure_ascii=False)

    unsafe = (
        value == ""
        or value != value.strip()
        or ":" in value
        or "#" in value
        or value[0] in UNSAFE_START
        or value.casefold() in YAML_NULL_BOOL
    )
    if not unsafe:
        return value
    return "'" + value.replace("'", "''") + "'"


def unquote_scalar(raw: str) -> str:
    """Read the simple scalar forms used by the frontmatter."""
    value = (raw or "").strip()
    if len(value) >= 2 and value[0] == "'" and SINGLE_QUOTED_RE.match(value):
        return value[1:-1].replace("''", "'")
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return value[1:-1]
    return value


def _validate_scalar(value: str, path: Path, lineno: int, label: str) -> None:
    stripped = value.strip()
    if stripped.startswith("|") or stripped.startswith(">"):
        raise TermFileError(
            f"{path}:{lineno}: block scalars are not supported in {label}"
        )
    if stripped.startswith("[") or stripped.startswith("{"):
        raise TermFileError(
            f"{path}:{lineno}: flow collections are not supported in {label}"
        )
    if stripped.startswith("'"):
        if not SINGLE_QUOTED_RE.match(stripped):
            raise TermFileError(
                f"{path}:{lineno}: unclosed single quote in {label}"
            )
    elif stripped.startswith('"'):
        try:
            json.loads(stripped)
        except (ValueError, TypeError) as exc:
            raise TermFileError(
                f"{path}:{lineno}: unsupported double-quoted {label}"
            ) from exc
    else:
        if " #" in stripped:
            raise TermFileError(
                f"{path}:{lineno}: inline comments are not supported in {label}"
            )
        if stripped.startswith("*") or stripped.startswith("!"):
            raise TermFileError(
                f"{path}:{lineno}: aliases/tags are not supported in {label}"
            )


def _frontmatter_scalar(lines: list[str], close: int, key: str) -> str | None:
    pattern = re.compile(r"^" + re.escape(key) + r"[ ]*:[ ]*(.*)$")
    for index in range(1, close):
        match = pattern.match(lines[index])
        if match:
            return unquote_scalar(match.group(1))
    return None


def _parse_alternatives_block(
    lines: list[str], start: int, end: int, path: Path
) -> tuple[list[dict], list[str]]:
    entries: list[dict] = []
    trailing_blank: list[str] = []
    current: dict | None = None
    index = start

    while index < end:
        line = lines[index]
        lineno = index + 1
        if "\t" in line:
            raise TermFileError(f"{path}:{lineno}: tabs are not supported")

        if BLANK_RE.match(line):
            for following in range(index, end):
                if "\t" in lines[following]:
                    raise TermFileError(
                        f"{path}:{following + 1}: tabs are not supported"
                    )
                if not BLANK_RE.match(lines[following]):
                    raise TermFileError(
                        f"{path}:{following + 1}: blank line inside "
                        "alternatives block"
                    )
            trailing_blank = lines[index:end]
            break

        if line.lstrip(" ").startswith("#"):
            raise TermFileError(
                f"{path}:{lineno}: comments are not supported in "
                "alternatives block"
            )

        entry_match = ENTRY_RE.match(line)
        if entry_match:
            value = entry_match.group("val")
            _validate_scalar(value, path, lineno, "translation")
            cleaned = clean_value(unquote_scalar(value))
            if not cleaned:
                raise TermFileError(
                    f"{path}:{lineno}: empty translation in alternatives block"
                )
            current = {
                "indent": entry_match.group("ind"),
                "translation": cleaned,
                "key": normalize_key(cleaned),
                "lines": [line],
                "index": index,
            }
            entries.append(current)
            index += 1
            continue

        if current is not None and index == current["index"] + 1:
            note_match = None
            if line.startswith(current["indent"]):
                note_match = NOTE_RE.match(line[len(current["indent"]) :])
            if note_match:
                _validate_scalar(note_match.group("val"), path, lineno, "note")
                current["lines"].append(line)
                index += 1
                continue

        raise TermFileError(
            f"{path}:{lineno}: unsupported content in alternatives block"
        )

    return entries, trailing_blank


def parse_frontmatter(text: str, path: Path) -> dict:
    """Parse the parts of the frontmatter this script needs."""
    if text.startswith("\ufeff"):
        raise TermFileError(f"{path}:1: UTF-8 BOM is not supported")
    if "\r" in text:
        line = text[: text.index("\r")].count("\n") + 1
        raise TermFileError(f"{path}:{line}: CRLF is not supported")
    if not text.startswith("---\n"):
        raise TermFileError(f"{path}:1: frontmatter must start with ---")

    lines = text.split("\n")
    if text.endswith("\n"):
        lines.pop()

    close = None
    for index in range(1, len(lines)):
        if lines[index] == "---":
            close = index
            break
    if close is None:
        raise TermFileError(f"{path}:1: missing closing --- delimiter")

    key_index = None
    rest = None
    for index in range(1, close):
        match = ALTERNATIVES_KEY_RE.match(lines[index])
        if match:
            key_index = index
            rest = match.group("rest")
            break

    if key_index is not None and rest is not None and rest.strip() != "[]":
        raise TermFileError(
            f"{path}:{key_index + 1}: alternatives must be a block or []"
        )

    entries: list[dict] = []
    trailing_blank: list[str] = []
    block_start = block_end = None
    if key_index is not None:
        block_start = key_index + 1
        block_end = block_start
        while block_end < close and not TOP_KEY_RE.match(lines[block_end]):
            block_end += 1
        entries, trailing_blank = _parse_alternatives_block(
            lines, block_start, block_end, path
        )

    return {
        "lines": lines,
        "close": close,
        "key_index": key_index,
        "rest": rest,
        "block_start": block_start,
        "block_end": block_end,
        "entries": entries,
        "trailing_blank": trailing_blank,
        "term": _frontmatter_scalar(lines, close, "term"),
        "translation": _frontmatter_scalar(lines, close, "translation"),
    }


def _format_entries(entries: list[dict], indent: str) -> list[str]:
    lines: list[str] = []
    for entry in entries:
        lines.append(f"{indent}- translation: {quote_scalar(entry['translation'])}")
        if entry.get("note"):
            lines.append(f"{indent}  note: {quote_scalar(entry['note'])}")
    return lines


def _splice(
    text: str,
    parsed: dict,
    additions: list[dict],
    dedupe: bool,
) -> tuple[str, bool, list[dict], list[dict]]:
    """Return (new_text, changed, kept_entries, removed_entries)."""
    entries = parsed["entries"]
    primary = clean_value(parsed.get("translation") or "")
    primary_key = normalize_key(primary)

    removed: list[dict] = []
    kept: list[dict] = []
    seen: dict[str, str] = {}

    for entry in entries:
        matched = None
        if entry["key"] == primary_key:
            matched = primary
        elif entry["key"] in seen:
            matched = seen[entry["key"]]
        if dedupe and matched is not None:
            removed.append(
                {
                    "translation": entry["translation"],
                    "matched": matched,
                    "raw": list(entry["lines"]),
                }
            )
            continue
        seen.setdefault(entry["key"], entry["translation"])
        kept.append(entry)

    if not additions and not removed:
        return text, False, entries, []

    indent = entries[0]["indent"] if entries else "  "
    lines = list(parsed["lines"])
    new_block = [line for entry in kept for line in entry["lines"]]
    new_block.extend(_format_entries(additions, indent))
    new_block.extend(parsed["trailing_blank"])

    key_index = parsed["key_index"]
    if key_index is None:
        # There is no key: insert a complete block before the closing ---.
        insertion = ["alternatives:"] + new_block
        lines[parsed["close"] : parsed["close"]] = insertion
    else:
        rest = parsed["rest"]
        inline_empty = rest is not None and rest.strip() == "[]"
        drop_all = not kept and not additions and bool(removed)

        if drop_all:
            key_line = "alternatives: []"
            new_block = []
        elif inline_empty:
            key_line = "alternatives:"
        else:
            key_line = lines[key_index]

        lines[key_index : parsed["block_end"]] = [key_line] + new_block

    new_text = "\n".join(lines)
    if text.endswith("\n"):
        new_text += "\n"
    return new_text, new_text != text, kept, removed


def _http_fetcher(url: str, timeout: float) -> tuple[int, object]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "muarrib-populate-alternatives/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = getattr(response, "status", response.getcode())
            body = response.read()
    except urllib.error.HTTPError as exc:
        # Return the status so _request_json can retry 5xx but not 4xx.
        status = exc.code
        body = exc.read()
        try:
            return int(status), json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            return int(status), {}
    try:
        data = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise ApiError(f"invalid JSON response: {exc}") from exc
    return int(status), data


def _request_json(url: str, fetcher, sleep) -> dict:
    last_error: Exception | None = None
    for attempt in range(len(RETRY_DELAYS) + 1):
        try:
            result = fetcher(url, TIMEOUT)
            if isinstance(result, tuple) and len(result) == 2:
                status, data = result
            else:
                status, data = 200, result

            if 500 <= int(status) < 600:
                last_error = ApiError(f"HTTP {status}")
            elif int(status) >= 400:
                raise ApiError(f"HTTP {status}")
            elif not isinstance(data, dict):
                raise ApiError("invalid JSON payload")
            else:
                return data
        except ApiError:
            raise
        except Exception as exc:  # transport failures
            last_error = exc

        if attempt < len(RETRY_DELAYS):
            sleep(RETRY_DELAYS[attempt])

    raise ApiError(str(last_error) if last_error else "API request failed")


def fetch_items(
    api: str, term: str, fetcher=None, sleep=time.sleep, state=None
) -> list[dict]:
    """Fetch every API result for ``term``, following pagination."""
    fetcher = fetcher or _http_fetcher
    base = api.rstrip("/")
    items: list[dict] = []
    previous_ids: tuple | None = None
    offset = 0
    total_valid = False
    total = 0
    terminal_first_page = False
    truncated = False

    for page in range(MAX_PAGES):
        query = urllib.parse.urlencode(
            {
                "q": term,
                "exact": "true",
                "limit": PAGE_LIMIT,
                "offset": offset,
            }
        )
        data = _request_json(f"{base}/api/search?{query}", fetcher, sleep)
        page_items = data.get("items") or []
        if not isinstance(page_items, list):
            page_items = []

        if page == 0:
            raw_total = data.get("total")
            total_valid = isinstance(raw_total, int) and not isinstance(
                raw_total, bool
            )
            total = raw_total if total_valid else 0
            if not total_valid:
                terminal_first_page = True

        page_ids = tuple(
            item.get("id") for item in page_items if isinstance(item, dict)
        )
        if (
            page > 0
            and page_ids == previous_ids
            and all(item_id is not None for item_id in page_ids)
        ):
            break
        if not page_items:
            break

        items.extend(item for item in page_items if isinstance(item, dict))
        previous_ids = page_ids
        offset += len(page_items)

        if terminal_first_page:
            break
        if total_valid and offset >= total:
            break
    else:
        truncated = True

    if truncated:
        if state is not None:
            state["truncated"] = True
        print(
            f"{term}: pagination truncated at {MAX_PAGES} pages",
            file=sys.stderr,
        )
    return items


def _source_for_item(item: dict) -> str:
    raw_glossary = item.get("glossaryAr")
    raw_publisher = item.get("publisherAr")
    glossary = clean_label(raw_glossary if isinstance(raw_glossary, str) else "")
    publisher = clean_label(
        raw_publisher if isinstance(raw_publisher, str) else ""
    )
    for source in (glossary, publisher):
        if source:
            return source
    return ""


def _plan_file(
    path: Path,
    api: str,
    notes_mode: str,
    dedupe: bool,
    fetcher,
    sleep,
) -> dict:
    try:
        text = path.read_bytes().decode("utf-8")
    except (UnicodeDecodeError, OSError) as exc:
        raise TermFileError(f"{path}: unreadable: {exc}") from exc

    parsed = parse_frontmatter(text, path)
    term = (parsed.get("term") or "").strip() or path.stem
    primary = clean_value(parsed.get("translation") or "")
    primary_key = normalize_key(primary)

    existing_keys = {entry["key"] for entry in parsed["entries"]}
    existing_display: dict[str, str] = {}
    for entry in parsed["entries"]:
        existing_display.setdefault(entry["key"], entry["translation"])

    fetch_state = {"truncated": False}
    fetched = fetch_items(
        api, term, fetcher=fetcher, sleep=sleep, state=fetch_state
    )
    no_results = len(fetched) == 0

    additions: list[dict] = []
    added_keys: set[str] = set()
    added_display: dict[str, str] = {}
    skipped: list[dict] = []
    skipped_count = 0

    def record_skip(value: str, matched: str) -> None:
        nonlocal skipped_count
        skipped_count += 1
        if len(skipped) < SKIPPED_CAP:
            skipped.append({"value": value, "matched": matched})

    for item in fetched:
        raw_arabic = item.get("arabic")
        if not isinstance(raw_arabic, str):
            continue
        source = _source_for_item(item)
        for value in split_synonyms(raw_arabic):
            key = normalize_key(value)
            if key == primary_key:
                record_skip(value, primary or "primary translation")
                continue
            if key in existing_keys:
                record_skip(
                    value, existing_display.get(key, "existing alternative")
                )
                continue
            if key in added_keys:
                record_skip(value, added_display.get(key, "added alternative"))
                existing = next(
                    entry
                    for entry in additions
                    if normalize_key(entry["translation"]) == key
                )
                if (
                    notes_mode == "source"
                    and source
                    and source not in existing["sources"]
                ):
                    existing["sources"].append(source)
                    existing["note"] = "من " + "، ".join(existing["sources"])
                continue

            sources = [source] if source and notes_mode == "source" else []
            note = "من " + "، ".join(sources) if sources else ""
            additions.append(
                {
                    "translation": value,
                    "note": note,
                    "sources": sources,
                }
            )
            added_keys.add(key)
            added_display[key] = value

    new_text, changed, _kept, removed = _splice(
        text, parsed, additions, dedupe
    )

    has_duplicates = False
    seen_keys: set[str] = set()
    for entry in parsed["entries"]:
        if entry["key"] == primary_key or entry["key"] in seen_keys:
            has_duplicates = True
            break
        seen_keys.add(entry["key"])

    return {
        "file": path,
        "term": term,
        "apiItems": len(fetched),
        "added": additions,
        "removedDuplicates": removed,
        "skippedDuplicates": skipped,
        "skippedDuplicatesCount": skipped_count,
        "noResults": no_results,
        "truncated": bool(fetch_state["truncated"]),
        "error": None,
        "changed": changed,
        "new_text": new_text,
        "has_duplicates": has_duplicates,
        "parse_error": False,
    }


def _atomic_write(path: Path, text: str) -> None:
    mode = stat.S_IMODE(path.stat().st_mode)
    handle = tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        newline="",
        dir=str(path.parent),
        delete=False,
    )
    temp_name = handle.name
    try:
        with handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp_name, mode)
        os.replace(temp_name, path)
    finally:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass


def _report_entry(plan: dict, terms_dir: Path) -> dict:
    entry = {
        "file": os.path.relpath(str(plan["file"]), str(terms_dir)),
        "term": plan["term"],
        "apiItems": plan["apiItems"],
        "added": [
            {
                "translation": item["translation"],
                "note": item["note"],
                "sources": item["sources"],
            }
            for item in plan["added"]
        ],
        "removedDuplicates": plan["removedDuplicates"],
        "skippedDuplicates": plan["skippedDuplicates"],
        "skippedDuplicatesCount": plan["skippedDuplicatesCount"],
    }
    if plan["noResults"]:
        entry["noResults"] = True
    if plan["truncated"]:
        entry["truncated"] = True
    if plan["error"]:
        entry["error"] = plan["error"]
    return entry


def _build_parser() -> argparse.ArgumentParser:
    default_terms = (
        Path(__file__).resolve().parents[1] / "src" / "content" / "terms"
    )
    parser = argparse.ArgumentParser(
        description="Populate alternatives in term frontmatter from the API."
    )
    parser.add_argument("--api", default=DEFAULT_API)
    parser.add_argument("--terms-dir", default=str(default_terms))
    parser.add_argument("--only", nargs="+", default=[])
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--notes", choices=("source", "none"), default=DEFAULT_NOTES)
    parser.add_argument("--dedupe-existing", action="store_true")
    parser.add_argument("--report", default=None)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("-v", "--verbose", action="store_true")
    return parser


def main(argv=None, fetcher=None, sleep=time.sleep) -> int:
    args = _build_parser().parse_args(argv)
    terms_dir = Path(args.terms_dir)
    if not terms_dir.is_dir():
        print(f"error: terms directory not found: {terms_dir}", file=sys.stderr)
        return 2

    files = sorted(terms_dir.glob("*.md"), key=lambda p: p.name)
    if args.only:
        files = [
            path
            for path in files
            if any(fnmatch.fnmatch(path.name, pattern) for pattern in args.only)
        ]
    if args.limit is not None:
        files = files[: max(0, args.limit)]

    plans: list[dict] = []
    consecutive_api_failures = 0
    fatal = False

    for path in files:
        try:
            plan = _plan_file(
                path,
                args.api,
                args.notes,
                args.dedupe_existing,
                fetcher,
                sleep,
            )
        except ApiError as exc:
            consecutive_api_failures += 1
            plan = {
                "file": path,
                "term": path.stem,
                "apiItems": 0,
                "added": [],
                "removedDuplicates": [],
                "skippedDuplicates": [],
                "skippedDuplicatesCount": 0,
                "noResults": False,
                "truncated": False,
                "error": str(exc),
                "changed": False,
                "new_text": None,
                "has_duplicates": False,
                "parse_error": False,
            }
            if args.verbose:
                print(f"{path.name}: API error: {exc}")
            if consecutive_api_failures >= CIRCUIT_BREAKER_LIMIT:
                fatal = True
                plans.append(plan)
                break
        except TermFileError as exc:
            consecutive_api_failures = 0
            plan = {
                "file": path,
                "term": path.stem,
                "apiItems": 0,
                "added": [],
                "removedDuplicates": [],
                "skippedDuplicates": [],
                "skippedDuplicatesCount": 0,
                "noResults": False,
                "truncated": False,
                "error": str(exc),
                "changed": False,
                "new_text": None,
                "has_duplicates": False,
                "parse_error": True,
            }
            if args.verbose:
                print(f"{path.name}: {exc}")
        else:
            consecutive_api_failures = 0
            if args.verbose:
                print(
                    f"{path.name}: {plan['apiItems']} api items, "
                    f"+{len(plan['added'])}, "
                    f"-{len(plan['removedDuplicates'])}, "
                    f"skipped {len(plan['skippedDuplicates'])}"
                )
        plans.append(plan)

    if fatal:
        print(
            "fatal: circuit breaker tripped after "
            f"{CIRCUIT_BREAKER_LIMIT} consecutive API failures; no files written",
            file=sys.stderr,
        )
        return 2

    if args.write:
        for plan in plans:
            if not plan["changed"] or plan["error"] or plan["new_text"] is None:
                continue
            try:
                _atomic_write(plan["file"], plan["new_text"])
            except OSError as exc:
                print(
                    f"fatal: could not write {plan['file']}: {exc}",
                    file=sys.stderr,
                )
                return 2

    parse_errors = sum(1 for plan in plans if plan["parse_error"])
    api_errors = sum(
        1 for plan in plans if plan["error"] and not plan["parse_error"]
    )
    changed = sum(1 for plan in plans if plan["changed"])
    added = sum(len(plan["added"]) for plan in plans if plan["changed"])
    removed = sum(len(plan["removedDuplicates"]) for plan in plans)
    no_results = sum(1 for plan in plans if plan["noResults"])
    skipped = sum(plan["skippedDuplicatesCount"] for plan in plans)
    truncated = sum(1 for plan in plans if plan["truncated"])
    duplicates_remaining = any(plan["has_duplicates"] for plan in plans)

    if args.report:
        report = {
            "api": args.api,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "pipeline": PIPELINE_DESCRIPTION,
            "files": [_report_entry(plan, terms_dir) for plan in plans],
            "totals": {
                "files": len(files),
                "changed": changed,
                "added": added,
                "removedDuplicates": removed,
                "skippedDuplicates": skipped,
                "noResults": no_results,
                "truncated": truncated,
                "apiErrors": api_errors,
                "parseErrors": parse_errors,
            },
        }
        try:
            Path(args.report).write_text(
                json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        except OSError as exc:
            print(f"fatal: could not write report: {exc}", file=sys.stderr)
            return 2

    print(f"Scanned: {len(files)}")
    print(f"Changed: {changed}")
    print(f"Added: {added}")
    print(f"Removed duplicates: {removed}")
    print(f"No results: {no_results}")
    print(f"Parse errors: {parse_errors}")
    print(f"API errors: {api_errors}")
    if not args.write:
        print("Dry run: pass --write to apply")
    elif not args.dedupe_existing and duplicates_remaining:
        print(
            "Duplicates remain: rerun with --dedupe-existing before "
            "npm test/merge."
        )

    return 1 if parse_errors or api_errors else 0


if __name__ == "__main__":
    sys.exit(main())
