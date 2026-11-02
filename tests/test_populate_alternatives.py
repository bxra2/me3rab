"""Offline tests for scripts/populate-alternatives.py."""

from __future__ import annotations

import importlib.util
import io
import json
import tempfile
import unittest
import urllib.parse
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "populate-alternatives.py"
NORMALIZATION_VECTORS = (
    ROOT / "tests" / "fixtures" / "normalization-vectors.json"
)

_spec = importlib.util.spec_from_file_location("populate_alternatives", SCRIPT)
pa = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pa)


def _noop_sleep(_seconds):
    return None


def _frontmatter_body(body: str) -> str:
    return "---\n" + body + "---\n"


def _splice(body: str, additions, dedupe=False):
    text = _frontmatter_body(body)
    parsed = pa.parse_frontmatter(text, Path("fixture.md"))
    return pa._splice(text, parsed, additions, dedupe)


def _write_term(directory: Path, name: str, body: str) -> Path:
    path = directory / name
    path.write_text(_frontmatter_body(body), encoding="utf-8")
    return path


def _items_fetcher(items):
    def fetch(_url, _timeout):
        return 200, {"items": items, "total": len(items)}

    return fetch


def _run_main(directory, fetcher, extra=None):
    argv = ["--terms-dir", str(directory)]
    if extra:
        argv.extend(extra)
    stdout = io.StringIO()
    stderr = io.StringIO()
    with redirect_stdout(stdout), redirect_stderr(stderr):
        code = pa.main(argv, fetcher=fetcher, sleep=_noop_sleep)
    return code, stdout.getvalue(), stderr.getvalue()


class CleaningTests(unittest.TestCase):
    def test_clean_value(self):
        self.assertEqual(pa.clean_value("مخطط\xa0[بياني]"), "مخطط")
        self.assertEqual(pa.clean_value("بايت (ال...)"), "بايت")
        self.assertEqual(pa.clean_value("با\u200dيت"), "بايت")
        self.assertEqual(pa.clean_value("اختبار [ناقص"), "اختبار")
        self.assertEqual(pa.clean_value("اختبار)"), "اختبار")
        self.assertEqual(pa.clean_value("1 لامتزامن ؛ 2 لامتزامن"), "لامتزامن ؛ لامتزامن")

    def test_split_synonyms(self):
        self.assertEqual(pa.split_synonyms("بايت :: جزئ"), ["بايت", "جزئ"])
        self.assertEqual(pa.split_synonyms("خطأ او غلط"), ["خطأ", "غلط"])
        self.assertEqual(pa.split_synonyms("1 لامتزامن ؛ 2 لامتزامن"), ["لامتزامن"])
        self.assertEqual(pa.split_synonyms("'بقّة'"), ["بقّة"])
        self.assertEqual(pa.split_synonyms("بايت (ال...)"), ["بايت"])
        self.assertEqual(pa.split_synonyms("[اختبار] CAPTCHA"), ["CAPTCHA"])
        self.assertEqual(pa.split_synonyms("مخطط\xa0[بياني]"), ["مخطط"])
        self.assertEqual(pa.split_synonyms("...،؛ --"), [])

    def test_normalize_key(self):
        self.assertEqual(pa.normalize_key("مُصَوَّبَة"), "مصوبة")
        self.assertEqual(pa.normalize_key("ی"), pa.normalize_key("ي"))
        self.assertEqual(pa.normalize_key("ک"), pa.normalize_key("ك"))
        self.assertEqual(pa.normalize_key("ۀ"), pa.normalize_key("ه"))
        self.assertNotEqual(pa.normalize_key("ة"), pa.normalize_key("ه"))
        self.assertEqual(pa.normalize_key("أإآٱ"), "اااا")
        self.assertEqual(pa.normalize_key("ىیئ"), "ييي")
        self.assertEqual(pa.normalize_key("CAPTCHA"), "captcha")

    def test_normalization_vectors(self):
        vectors = json.loads(NORMALIZATION_VECTORS.read_text(encoding="utf-8"))
        for source, expected in vectors:
            with self.subTest(source=source):
                self.assertEqual(pa.normalize_key(source), expected)

    def test_quote_scalar(self):
        self.assertEqual(pa.quote_scalar("بايت"), "بايت")
        self.assertEqual(pa.quote_scalar(""), "''")
        self.assertEqual(pa.quote_scalar("a:b"), "'a:b'")
        self.assertEqual(pa.quote_scalar("#x"), "'#x'")
        self.assertEqual(pa.quote_scalar("true"), "'true'")
        self.assertEqual(pa.quote_scalar("a'b"), "a'b")
        self.assertEqual(pa.quote_scalar("a\nb"), '"a\\nb"')


class SpliceTests(unittest.TestCase):
    def test_inline_empty_becomes_block(self):
        body = "term: Test\ntranslation: ''\nalternatives: []\nderivations: []\n"
        additions = [
            {"translation": "تجربة", "note": "من معجم", "sources": ["معجم"]}
        ]
        new_text, changed, kept, removed = _splice(body, additions)
        self.assertTrue(changed)
        self.assertFalse(kept)
        self.assertFalse(removed)
        self.assertNotIn("alternatives: []", new_text)
        self.assertIn(
            "alternatives:\n  - translation: تجربة\n    note: من معجم\n"
            "derivations: []\n",
            new_text,
        )

    def test_append_after_existing_two_space_block(self):
        body = (
            "term: Test\ntranslation: ''\nalternatives:\n"
            "  - translation: أول\n    note: 'ملاحظة'\n"
            "derivations: []\n"
        )
        additions = [{"translation": "ثاني", "note": "", "sources": []}]
        new_text, changed, _, _ = _splice(body, additions)
        self.assertTrue(changed)
        self.assertIn("  - translation: أول\n    note: 'ملاحظة'\n", new_text)
        self.assertIn(
            "  - translation: أول\n    note: 'ملاحظة'\n"
            "  - translation: ثاني\n"
            "derivations: []\n",
            new_text,
        )

    def test_three_space_indent_preserved(self):
        body = (
            "term: Test\ntranslation: ''\nalternatives:\n"
            "   - translation: أول\n     note: 'ملاحظة'\n"
            "derivations: []\n"
        )
        additions = [{"translation": "ثاني", "note": "من معجم", "sources": ["معجم"]}]
        new_text, _, _, _ = _splice(body, additions)
        self.assertIn("   - translation: أول\n     note: 'ملاحظة'\n", new_text)
        self.assertIn("   - translation: ثاني\n     note: من معجم\n", new_text)

    def test_missing_key_inserted_before_closing_delimiter(self):
        body = "term: Test\ntranslation: ''\nderivations: []\n"
        additions = [{"translation": "جديد", "note": "", "sources": []}]
        new_text, changed, _, _ = _splice(body, additions)
        self.assertTrue(changed)
        self.assertIn(
            "derivations: []\nalternatives:\n  - translation: جديد\n---\n",
            new_text,
        )

    def test_alternatives_last_key(self):
        body = (
            "term: Test\ntranslation: ''\nalternatives:\n"
            "  - translation: قديم\n"
        )
        additions = [{"translation": "جديد", "note": "", "sources": []}]
        new_text, _, _, _ = _splice(body, additions)
        self.assertIn(
            "  - translation: قديم\n  - translation: جديد\n---\n", new_text
        )

    def test_dedupe_to_zero_emits_inline_empty(self):
        body = (
            "term: Archipelago\ntranslation: أرخبيل\nalternatives:\n"
            "  - translation: أرخبيل\n    note: قديم\n"
            "derivations: []\n"
        )
        new_text, changed, kept, removed = _splice(body, [], dedupe=True)
        self.assertTrue(changed)
        self.assertFalse(kept)
        self.assertEqual(len(removed), 1)
        self.assertIn("alternatives: []\n", new_text)
        self.assertNotIn("  - translation: أرخبيل", new_text)

    def test_dedupe_off_preserves_duplicates(self):
        body = (
            "term: Test\ntranslation: أرخبيل\nalternatives:\n"
            "  - translation: أرخبيل\n    note: قديم\n"
        )
        additions = [{"translation": "جديد", "note": "", "sources": []}]
        new_text, _, _, removed = _splice(body, additions, dedupe=False)
        self.assertFalse(removed)
        self.assertIn("  - translation: أرخبيل\n    note: قديم\n", new_text)
        self.assertIn("  - translation: جديد\n", new_text)

    def test_unchanged_returns_original(self):
        body = (
            "term: Test\ntranslation: آخر\nalternatives:\n"
            "  - translation: أول\n"
        )
        text = _frontmatter_body(body)
        parsed = pa.parse_frontmatter(text, Path("fixture.md"))
        new_text, changed, _, _ = pa._splice(text, parsed, [], True)
        self.assertFalse(changed)
        self.assertEqual(new_text, text)

    def test_trailing_newline_preserved(self):
        body = "term: Test\ntranslation: ''\nalternatives: []\n"
        additions = [{"translation": "جديد", "note": "", "sources": []}]
        text = _frontmatter_body(body)
        parsed = pa.parse_frontmatter(text, Path("fixture.md"))
        new_text, _, _, _ = pa._splice(text, parsed, additions, False)
        self.assertTrue(new_text.endswith("\n"))

        no_newline = text.rstrip("\n")
        parsed = pa.parse_frontmatter(no_newline, Path("fixture.md"))
        new_text, _, _, _ = pa._splice(no_newline, parsed, additions, False)
        self.assertFalse(new_text.endswith("\n"))

    def test_trailing_blank_preserved(self):
        body = (
            "term: Test\ntranslation: ''\nalternatives:\n"
            "  - translation: أول\n"
            "\n"
            "derivations: []\n"
        )
        additions = [{"translation": "ثاني", "note": "", "sources": []}]
        new_text, changed, _, _ = _splice(body, additions)
        self.assertTrue(changed)
        self.assertIn(
            "  - translation: أول\n"
            "  - translation: ثاني\n"
            "\n"
            "derivations: []\n",
            new_text,
        )

    def test_unsupported_shapes(self):
        bad_shapes = [
            "---\nterm: X\nalternatives:\n  - translation:\tfoo\n---\n",
            "---\r\nterm: X\r\n---\r\n",
            "\ufeff---\nterm: X\n---\n",
            "---\nterm: X\nalternatives:\n  - translation: أ\n    gloss: ب\n---\n",
            "---\nterm: X\nalternatives:\n  - translation: أ\n    استمرار\n---\n",
            "---\nterm: X\nalternatives:\n  - translation: 'أ\n---\n",
            "---\nterm: X\nalternatives:\n  - translation: [أ]\n---\n",
            "---\nterm: X\nalternatives:\n  - translation: أ\n\n  - translation: ب\n---\n",
            "---\nterm: X\nalternatives:\n- translation: أ\n---\n",
            "---\nterm: X\nalternatives:\n    note: قبل\n  - translation: أ\n---\n",
            "---\nterm: X\nalternatives:\n  - translation:value\n---\n",
            "---\nterm: X\nalternatives:\n  - translation: أ\n    note:value\n---\n",
            "---\nterm: X\nalternatives:\n  - translation:\n---\n",
            "---\nterm: X\nalternatives:\n  - translation: \n---\n",
            "---\nterm: X\nalternatives:\n  - translation: أ\n    note: hello # comment\n---\n",
            "---\nterm: X\nalternatives:\n  - translation: أ\n    note: *anchor\n---\n",
            "---\nterm: X\nalternatives:\n  - translation: أ\n    note: !tag\n---\n",
            "---\nterm: X\nalternatives:\n  - translation: أ\n    note: |\n---\n",
            "---\nterm: X\nalternatives:\n  - translation: أ\n    note: >\n---\n",
            "---\nterm: X\nalternatives:\n  - translation: {a: b}\n---\n",
            "---\nterm: X\nalternatives: [x]\n---\n",
            "---\nterm: X\n",
            "term: X\n---\n",
        ]
        for text in bad_shapes:
            with self.subTest(text=text):
                with self.assertRaises(pa.TermFileError):
                    pa.parse_frontmatter(text, Path("bad.md"))


class NoteTests(unittest.TestCase):
    def _plan(self, directory, items, notes="source", dedupe=False):
        body = (
            "term: Test\ntranslation: ''\nalternatives: []\n"
            "derivations: []\n"
        )
        path = _write_term(directory, "test.md", body)
        return pa._plan_file(
            path,
            "http://api",
            notes,
            dedupe,
            _items_fetcher(items),
            _noop_sleep,
        )

    def test_glossary_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan = self._plan(
                Path(tmp),
                [{"arabic": "اختبار", "glossaryAr": "معجم أ", "publisherAr": "ناشر"}],
            )
            self.assertEqual(plan["added"][0]["note"], "من معجم أ")
            self.assertEqual(plan["added"][0]["sources"], ["معجم أ"])

    def test_publisher_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan = self._plan(
                Path(tmp),
                [{"arabic": "اختبار", "glossaryAr": "  ", "publisherAr": "ناشر"}],
            )
            self.assertEqual(plan["added"][0]["note"], "من ناشر")

    def test_unusable_sources_omit_note(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan = self._plan(
                Path(tmp),
                [{"arabic": "اختبار", "glossaryAr": "-", "publisherAr": "-"}],
            )
            self.assertEqual(plan["added"][0]["note"], "")
            self.assertEqual(plan["added"][0]["sources"], [])
            self.assertNotIn("note:", plan["new_text"])

    def test_source_trailing_spaces_cleaned(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan = self._plan(
                Path(tmp),
                [{"arabic": "اختبار", "glossaryAr": " معجم أ  "}],
            )
            self.assertEqual(plan["added"][0]["note"], "من معجم أ")

    def test_multiple_sources_deduped_and_joined(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan = self._plan(
                Path(tmp),
                [
                    {"arabic": "اختبار", "glossaryAr": "أ"},
                    {"arabic": "اختبار", "glossaryAr": "ب"},
                    {"arabic": "اختبار", "glossaryAr": "أ"},
                ],
            )
            self.assertEqual(len(plan["added"]), 1)
            self.assertEqual(plan["added"][0]["note"], "من أ، ب")
            self.assertEqual(plan["added"][0]["sources"], ["أ", "ب"])
            self.assertEqual(len(plan["skippedDuplicates"]), 2)

    def test_notes_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan = self._plan(
                Path(tmp),
                [{"arabic": "اختبار", "glossaryAr": "معجم أ"}],
                notes="none",
            )
            self.assertEqual(plan["added"][0]["note"], "")
            self.assertEqual(plan["added"][0]["sources"], [])
            self.assertNotIn("note:", plan["new_text"])


class FetcherTests(unittest.TestCase):
    def _offset_fetcher(self, total, calls, page_factory=None):
        def fetch(url, _timeout):
            query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
            offset = int(query["offset"][0])
            calls.append(offset)
            if page_factory is not None:
                return 200, page_factory(offset)
            if offset == 0:
                return 200, {
                    "items": [{"id": i} for i in range(100)],
                    "total": total,
                }
            if offset == 100:
                return 200, {
                    "items": [{"id": i} for i in range(100, total)],
                    "total": total,
                }
            return 200, {"items": [], "total": total}

        return fetch

    def test_pagination_with_total(self):
        calls = []
        items = pa.fetch_items(
            "http://api",
            "term",
            fetcher=self._offset_fetcher(150, calls),
            sleep=_noop_sleep,
        )
        self.assertEqual(len(items), 150)
        self.assertEqual(calls, [0, 100])

    def test_identical_pages_stop(self):
        calls = []

        def factory(_offset):
            return {
                "items": [{"id": 1}, {"id": 2}],
                "total": 100,
            }

        items = pa.fetch_items(
            "http://api",
            "term",
            fetcher=self._offset_fetcher(100, calls, factory),
            sleep=_noop_sleep,
        )
        self.assertEqual([item["id"] for item in items], [1, 2])
        self.assertEqual(calls, [0, 2])

    def test_pages_without_ids_are_consumed(self):
        calls = []

        def factory(offset):
            if offset == 0:
                return {
                    "items": [{"arabic": "أول"}, {"arabic": "ثان"}],
                    "total": 4,
                }
            return {
                "items": [{"arabic": "ثالث"}, {"arabic": "رابع"}],
                "total": 4,
            }

        items = pa.fetch_items(
            "http://api",
            "term",
            fetcher=self._offset_fetcher(4, calls, factory),
            sleep=_noop_sleep,
        )
        self.assertEqual(
            [item["arabic"] for item in items], ["أول", "ثان", "ثالث", "رابع"]
        )
        self.assertEqual(calls, [0, 2])

    def test_max_pages_marks_truncated_and_warns(self):
        calls = []

        def factory(offset):
            return {
                "items": [{"id": offset}],
                "total": 10000,
            }

        state = {"truncated": False}
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            items = pa.fetch_items(
                "http://api",
                "term",
                fetcher=self._offset_fetcher(10000, calls, factory),
                sleep=_noop_sleep,
                state=state,
            )
        self.assertEqual(len(items), pa.MAX_PAGES)
        self.assertEqual(len(calls), pa.MAX_PAGES)
        self.assertTrue(state["truncated"])
        self.assertIn("pagination truncated at 20 pages", stderr.getvalue())

    def test_invalid_total_stops_after_first_page(self):
        for total in (None, 1.5, True):
            calls = []

            def factory(_offset, total=total):
                data = {"items": [{"id": 1}, {"id": 2}]}
                if total is not None:
                    data["total"] = total
                return data

            items = pa.fetch_items(
                "http://api",
                "term",
                fetcher=self._offset_fetcher(2, calls, factory),
                sleep=_noop_sleep,
            )
            with self.subTest(total=total):
                self.assertEqual(len(items), 2)
                self.assertEqual(calls, [0])

    def test_missing_arabic_is_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_term(
                Path(tmp),
                "test.md",
                "term: Test\ntranslation: ''\nalternatives: []\n",
            )
            plan = pa._plan_file(
                path,
                "http://api",
                "source",
                False,
                _items_fetcher([{"id": 1, "glossaryAr": "معجم"}]),
                _noop_sleep,
            )
            self.assertEqual(plan["added"], [])
            self.assertFalse(plan["noResults"])

    def test_non_string_api_fields_are_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_term(
                Path(tmp),
                "test.md",
                "term: Test\ntranslation: ''\nalternatives: []\n",
            )
            plan = pa._plan_file(
                path,
                "http://api",
                "source",
                False,
                _items_fetcher(
                    [
                        {"arabic": 123, "glossaryAr": "معجم"},
                        {"arabic": None, "glossaryAr": "معجم"},
                        {
                            "arabic": "اختبار",
                            "glossaryAr": 42,
                            "publisherAr": ["ناشر"],
                        },
                    ]
                ),
                _noop_sleep,
            )
            self.assertEqual(len(plan["added"]), 1)
            self.assertEqual(plan["added"][0]["translation"], "اختبار")
            self.assertEqual(plan["added"][0]["note"], "")

    def test_truncated_flag_reaches_plan(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_term(
                Path(tmp),
                "test.md",
                "term: Test\ntranslation: ''\nalternatives: []\n",
            )

            def fetch(url, _timeout):
                query = urllib.parse.parse_qs(
                    urllib.parse.urlparse(url).query
                )
                offset = int(query["offset"][0])
                return 200, {
                    "items": [{"id": offset}],
                    "total": 10000,
                }

            stderr = io.StringIO()
            with redirect_stderr(stderr):
                plan = pa._plan_file(
                    path, "http://api", "source", False, fetch, _noop_sleep
                )
            self.assertTrue(plan["truncated"])
            self.assertIn("pagination truncated", stderr.getvalue())

    def test_5xx_then_recovery(self):
        calls = []
        sleeps = []

        def fetch(_url, _timeout):
            calls.append(1)
            if len(calls) == 1:
                return 500, {}
            return 200, {"items": [{"id": 1}], "total": 1}

        items = pa.fetch_items(
            "http://api", "term", fetcher=fetch, sleep=sleeps.append
        )
        self.assertEqual(len(items), 1)
        self.assertEqual(len(calls), 2)
        self.assertEqual(sleeps, [0.4])

    def test_retries_then_raises(self):
        calls = []
        sleeps = []

        def fetch(_url, _timeout):
            calls.append(1)
            raise OSError("down")

        with self.assertRaises(pa.ApiError):
            pa.fetch_items(
                "http://api", "term", fetcher=fetch, sleep=sleeps.append
            )
        self.assertEqual(len(calls), 3)
        self.assertEqual(sleeps, [0.4, 1.0])

    def test_circuit_breaker(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            paths = [
                _write_term(
                    directory,
                    f"term{i}.md",
                    "term: Test\ntranslation: ''\nalternatives: []\n",
                )
                for i in range(5)
            ]
            before = [path.read_text(encoding="utf-8") for path in paths]

            def fetch(_url, _timeout):
                raise OSError("down")

            code, _, stderr = _run_main(directory, fetch, ["--write"])
            self.assertEqual(code, 2)
            self.assertIn("circuit breaker", stderr)
            self.assertEqual(
                [path.read_text(encoding="utf-8") for path in paths], before
            )

    def test_circuit_breaker_resets_on_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            for index in range(8):
                _write_term(
                    directory,
                    f"term{index}.md",
                    f"term: T{index}\ntranslation: ''\nalternatives: []\n",
                )

            failing = {0, 1, 2, 4, 5, 6, 7}

            def fetch(url, _timeout):
                query = urllib.parse.parse_qs(
                    urllib.parse.urlparse(url).query
                )
                term = query["q"][0]
                index = int(term[1:])
                if index in failing:
                    raise OSError("down")
                return 200, {"items": [], "total": 0}

            code, _, _ = _run_main(directory, fetch)
            self.assertEqual(code, 1)


class IdempotencyTests(unittest.TestCase):
    def test_second_run_adds_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_term(
                Path(tmp),
                "test.md",
                "term: Test\ntranslation: ''\nalternatives: []\n",
            )
            items = [
                {"arabic": "أول", "glossaryAr": "معجم أ"},
                {"arabic": "ثان", "glossaryAr": "معجم ب"},
            ]
            first = pa._plan_file(
                path, "http://api", "source", True,
                _items_fetcher(items), _noop_sleep,
            )
            self.assertEqual(len(first["added"]), 2)
            path.write_text(first["new_text"], encoding="utf-8")

            second = pa._plan_file(
                path, "http://api", "source", True,
                _items_fetcher(items), _noop_sleep,
            )
            self.assertEqual(second["added"], [])
            self.assertFalse(second["changed"])

            third = pa._plan_file(
                path, "http://api", "source", True,
                _items_fetcher(list(reversed(items))), _noop_sleep,
            )
            self.assertEqual(third["added"], [])
            self.assertFalse(third["changed"])


class ExitCodeTests(unittest.TestCase):
    def test_zero_for_clean_and_no_results(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            _write_term(
                directory,
                "empty.md",
                "term: Empty\ntranslation: ''\nalternatives: []\n",
            )
            _write_term(
                directory,
                "full.md",
                "term: Full\ntranslation: ''\nalternatives: []\n",
            )

            def fetch(url, _timeout):
                if "q=Empty" in url:
                    return 200, {"items": [], "total": 0}
                return 200, {
                    "items": [{"id": 1, "arabic": "مثال", "glossaryAr": "معجم"}],
                    "total": 1,
                }

            code, _, _ = _run_main(directory, fetch)
            self.assertEqual(code, 0)

    def test_one_for_parse_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory / "bad.md").write_bytes(
                b"---\r\nterm: Bad\r\n---\r\n"
            )
            code, _, _ = _run_main(directory, _items_fetcher([]))
            self.assertEqual(code, 1)

    def test_one_for_api_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            _write_term(
                directory,
                "test.md",
                "term: Test\ntranslation: ''\nalternatives: []\n",
            )

            def fetch(_url, _timeout):
                raise OSError("down")

            code, _, _ = _run_main(directory, fetch)
            self.assertEqual(code, 1)

    def test_two_for_missing_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "does-not-exist"
            code, _, _ = _run_main(missing, _items_fetcher([]))
            self.assertEqual(code, 2)


class ReportTests(unittest.TestCase):
    def test_report_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            _write_term(
                directory,
                "a.md",
                "term: Alpha\ntranslation: أساس\nalternatives:\n"
                "  - translation: أساس\n"
                "    note: قديم\n",
            )
            _write_term(
                directory,
                "b.md",
                "term: Beta\ntranslation: ''\nalternatives: []\n",
            )
            (directory / "c.md").write_bytes(
                b"---\r\nterm: Bad\r\n---\r\n"
            )

            def fetch(url, _timeout):
                if "q=Alpha" in url:
                    return 200, {
                        "items": [
                            {
                                "id": 1,
                                "arabic": "تأسيس",
                                "glossaryAr": "معجم",
                            }
                        ],
                        "total": 1,
                    }
                return 200, {"items": [], "total": 0}

            report_path = directory / "report.json"
            code, _, _ = _run_main(
                directory,
                fetch,
                ["--dedupe-existing", "--report", str(report_path)],
            )
            self.assertEqual(code, 1)
            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(
                set(report),
                {"api", "generatedAt", "pipeline", "files", "totals"},
            )
            self.assertIsInstance(report["generatedAt"], str)
            self.assertIsInstance(report["pipeline"], str)
            self.assertEqual(
                report["totals"]["added"],
                sum(len(entry["added"]) for entry in report["files"]),
            )
            by_file = {entry["file"]: entry for entry in report["files"]}
            self.assertEqual(
                by_file["a.md"]["removedDuplicates"][0]["raw"],
                ["  - translation: أساس", "    note: قديم"],
            )
            self.assertTrue(by_file["b.md"]["noResults"])
            self.assertIn("CRLF", by_file["c.md"]["error"])

    def test_skipped_duplicate_count_is_true(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            _write_term(
                directory,
                "test.md",
                "term: Many\ntranslation: أساس\nalternatives: []\n",
            )
            items = [
                {"arabic": "أساس", "glossaryAr": "معجم"}
                for _ in range(51)
            ]
            report_path = directory / "report.json"
            code, _, _ = _run_main(
                directory,
                _items_fetcher(items),
                ["--report", str(report_path)],
            )
            self.assertEqual(code, 0)
            report = json.loads(report_path.read_text(encoding="utf-8"))
            entry = report["files"][0]
            self.assertEqual(len(entry["skippedDuplicates"]), 50)
            self.assertEqual(entry["skippedDuplicatesCount"], 51)
            self.assertEqual(report["totals"]["skippedDuplicates"], 51)


class WriteFailureTests(unittest.TestCase):
    def test_write_failure_exits_2_and_stops(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            paths = [
                _write_term(
                    directory,
                    name,
                    "term: Test\ntranslation: ''\nalternatives: []\n",
                )
                for name in ("a.md", "b.md")
            ]
            before = [path.read_text(encoding="utf-8") for path in paths]

            with mock.patch.object(
                pa, "_atomic_write", side_effect=OSError("disk full")
            ) as writer:
                code, _, _ = _run_main(
                    directory,
                    _items_fetcher(
                        [{"arabic": "مثال", "glossaryAr": "معجم"}]
                    ),
                    ["--write"],
                )

            self.assertEqual(code, 2)
            self.assertEqual(writer.call_count, 1)
            self.assertEqual(
                [path.read_text(encoding="utf-8") for path in paths], before
            )

    def test_report_failure_exits_2(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            _write_term(
                directory,
                "test.md",
                "term: Test\ntranslation: ''\nalternatives: []\n",
            )
            blocker = directory / "blocked"
            blocker.write_text("not a directory", encoding="utf-8")
            code, _, _ = _run_main(
                directory,
                _items_fetcher([]),
                ["--report", str(blocker / "r.json")],
            )
            self.assertEqual(code, 2)


class ReminderTests(unittest.TestCase):
    def test_duplicate_reminder_only_without_dedupe(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            _write_term(
                directory,
                "test.md",
                "term: Test\ntranslation: أساس\nalternatives:\n"
                "  - translation: أساس\n",
            )
            code, stdout, _ = _run_main(
                directory, _items_fetcher([]), ["--write"]
            )
            self.assertEqual(code, 0)
            self.assertIn("Duplicates remain", stdout)

            code, stdout, _ = _run_main(
                directory,
                _items_fetcher([]),
                ["--write", "--dedupe-existing"],
            )
            self.assertEqual(code, 0)
            self.assertNotIn("Duplicates remain", stdout)


class FilterTests(unittest.TestCase):
    def test_only_glob_and_limit(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            for name in ("a.md", "arch.md", "b.md", "byte.md"):
                _write_term(
                    directory,
                    name,
                    f"term: {name[:-3].title()}\ntranslation: ''\n"
                    "alternatives: []\n",
                )

            _, stdout, _ = _run_main(
                directory, _items_fetcher([]), ["--only", "byte.md"]
            )
            self.assertIn("Scanned: 1", stdout)

            _, stdout, _ = _run_main(
                directory, _items_fetcher([]), ["--only", "a*.md"]
            )
            self.assertIn("Scanned: 2", stdout)

            _, stdout, _ = _run_main(
                directory, _items_fetcher([]), ["--limit", "2"]
            )
            self.assertIn("Scanned: 2", stdout)


class UnreadableFileTests(unittest.TestCase):
    def test_unreadable_file_does_not_stop_other_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            bad = _write_term(
                directory,
                "bad.md",
                "term: Bad\ntranslation: ''\nalternatives: []\n",
            )
            good = _write_term(
                directory,
                "good.md",
                "term: Good\ntranslation: ''\nalternatives: []\n",
            )
            bad_before = bad.read_text(encoding="utf-8")
            original_read_bytes = Path.read_bytes

            def guarded_read_bytes(self):
                if self.name == "bad.md":
                    raise PermissionError("denied")
                return original_read_bytes(self)

            with mock.patch.object(Path, "read_bytes", guarded_read_bytes):
                code, _, _ = _run_main(
                    directory,
                    _items_fetcher(
                        [{"arabic": "مثال", "glossaryAr": "معجم"}]
                    ),
                    ["--write"],
                )

            self.assertEqual(code, 1)
            self.assertEqual(bad.read_text(encoding="utf-8"), bad_before)
            self.assertIn(
                "- translation: مثال", good.read_text(encoding="utf-8")
            )


if __name__ == "__main__":
    unittest.main()
