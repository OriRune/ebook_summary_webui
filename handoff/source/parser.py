"""
Ebook splitting logic.

Splits an ebook (.txt, .md, or .epub) into digestible sections — chapters for
fiction, headed sections for nonfiction — small enough to hand to an LLM.

Public entry point: split_ebook(path, max_chars=9000) -> list[Section]
"""

from __future__ import annotations

import re
import os
from dataclasses import dataclass


@dataclass
class Section:
    title: str
    text: str

    @property
    def char_count(self) -> int:
        return len(self.text)

    @property
    def word_count(self) -> int:
        return len(self.text.split())


# Heading patterns that mark the start of a new chapter/section in plain text
# or markdown. Checked against each line (stripped).
_HEADING_PATTERNS = [
    # "CHAPTER I", "Chapter 1", "Chapter One", "CHAPTER 12: The Storm"
    re.compile(r'^(chapter|chap\.?)\s+([ivxlcdm]+|\d+|[a-z\-]+)\b', re.IGNORECASE),
    # "PART ONE", "Part 1", "Book II"
    re.compile(r'^(part|book|section|act)\s+([ivxlcdm]+|\d+|[a-z\-]+)\b', re.IGNORECASE),
    # Markdown headings: "## Chapter I", "# Introduction", "### 3. Methods"
    re.compile(r'^#{1,3}\s+\S'),
    # Valid Roman numeral alone on its own line: "XIV", "IV.", "III"
    # (strict pattern so plain words like "LIVID" or "MILD" don't false-match)
    re.compile(r'^(?=[MDCLXVI])M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})\.?\s*$'),
    # Plain numbered headings: "1. Introduction", "12 Background"
    re.compile(r'^\d{1,3}[\.\)]\s+\S'),
]

# Matches the "(part N of M)" suffix _subdivide_long_sections appends to a
# chapter's title when it has to split it into LLM-sized pieces — e.g.
# "Chapter 5 (part 2 of 3)". Exported so other modules that need to recognize
# or reason about these chapter groupings (the GUI's merge/renumber logic, and
# llm_client's chapter-continuity tracker) share one definition of the format
# rather than maintaining their own copies.
PART_RE = re.compile(r'^(.*) \(part (\d+) of (\d+)\)$')

# Markers used by Project Gutenberg / similar sources to bound the real text
_START_MARKERS = re.compile(r'\*{3}\s*START OF (THE|THIS) PROJECT GUTENBERG', re.IGNORECASE)
_END_MARKERS = re.compile(r'\*{3}\s*END OF (THE|THIS) PROJECT GUTENBERG', re.IGNORECASE)


def _strip_boilerplate(text: str) -> str:
    """Trim Project Gutenberg (or similar) front/back matter if present."""
    start = _START_MARKERS.search(text)
    if start:
        # Skip to the end of that marker line
        text = text[start.end():]
        nl = text.find('\n')
        if nl != -1:
            text = text[nl + 1:]
    end = _END_MARKERS.search(text)
    if end:
        text = text[:end.start()]
    return text.strip()


def _looks_like_heading(line: str) -> bool:
    line = line.strip()
    if not line or len(line) > 120:
        return False
    return any(p.match(line) for p in _HEADING_PATTERNS)


def _split_on_headings(text: str) -> list[Section] | None:
    """Try to split on detected chapter/section headings. Returns None if too
    few headings were found to be a meaningful split."""
    lines = text.split('\n')
    heading_idxs = [i for i, ln in enumerate(lines) if _looks_like_heading(ln)]

    # Require at least 2 headings, and that they're not basically every line
    if len(heading_idxs) < 2 or len(heading_idxs) > len(lines) * 0.5:
        return None

    sections: list[Section] = []
    for n, idx in enumerate(heading_idxs):
        title = lines[idx].strip().lstrip('#').strip()
        end = heading_idxs[n + 1] if n + 1 < len(heading_idxs) else len(lines)
        body = '\n'.join(lines[idx + 1:end]).strip()
        if body:
            sections.append(Section(title=title or f"Section {n + 1}", text=body))

    # If headings only produced one real section, the detection was probably noise
    if len(sections) < 2:
        return None
    return sections


def _chunk_by_paragraphs(text: str, max_chars: int) -> list[Section]:
    """Fallback: break text into roughly-equal chunks at paragraph boundaries."""
    paragraphs = [p.strip() for p in re.split(r'\n\s*\n', text) if p.strip()]
    chunks: list[Section] = []
    current: list[str] = []
    current_len = 0

    for p in paragraphs:
        if current and current_len + len(p) > max_chars:
            chunks.append('\n\n'.join(current))
            current, current_len = [], 0
        current.append(p)
        current_len += len(p) + 2

    if current:
        chunks.append('\n\n'.join(current))

    return [Section(title=f"Part {i + 1}", text=chunk) for i, chunk in enumerate(chunks)]


def _subdivide_long_sections(sections: list[Section], max_chars: int) -> list[Section]:
    """If any detected section is still too large for an LLM pass, split it
    further at paragraph boundaries, keeping the original title with a suffix."""
    result: list[Section] = []
    for sec in sections:
        if sec.char_count <= max_chars:
            result.append(sec)
            continue
        sub_chunks = _chunk_by_paragraphs(sec.text, max_chars)
        if len(sub_chunks) <= 1:
            result.append(sec)
            continue
        for i, sub in enumerate(sub_chunks):
            result.append(Section(title=f"{sec.title} (part {i + 1} of {len(sub_chunks)})", text=sub.text))
    return result


def split_plain_text(text: str, max_chars: int = 9000) -> list[Section]:
    text = _strip_boilerplate(text)
    sections = _split_on_headings(text)
    if sections is None:
        sections = _chunk_by_paragraphs(text, max_chars)
    sections = _subdivide_long_sections(sections, max_chars)
    return sections


def split_epub(path: str, max_chars: int = 9000) -> list[Section]:
    try:
        import ebooklib
        from ebooklib import epub
        from bs4 import BeautifulSoup
    except ImportError as e:
        raise RuntimeError(
            "Reading .epub files requires the 'ebooklib' and 'beautifulsoup4' "
            "packages. Install them with: pip install ebooklib beautifulsoup4"
        ) from e

    book = epub.read_epub(path, options={"ignore_ncx": True})
    sections: list[Section] = []
    for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
        soup = BeautifulSoup(item.get_content(), 'html.parser')
        text = soup.get_text('\n')
        text = re.sub(r'\n{3,}', '\n\n', text).strip()
        if len(text) < 200:  # skip covers, TOC pages, nav, etc.
            continue
        heading = soup.find(['h1', 'h2', 'h3'])
        title = heading.get_text(strip=True) if heading else f"Section {len(sections) + 1}"
        sections.append(Section(title=title, text=text))

    sections = _subdivide_long_sections(sections, max_chars)
    return sections


def split_pdf(path: str, max_chars: int = 9000) -> list[Section]:
    """Extract text from a PDF and split into LLM-sized sections.

    Strategy (in priority order):
    1. If the PDF has a bookmark/outline tree, use bookmark titles as chapter
       boundaries — this gives clean chapter names from properly-produced ebooks.
    2. Otherwise fall back to split_plain_text() which detects headings by regex
       or chunks by paragraph if no headings are found.

    Raises RuntimeError if pypdf is not installed, or if the PDF appears to be
    a scanned document (no extractable text on any page).
    """
    try:
        import pypdf
    except ImportError as e:
        raise RuntimeError(
            "Reading .pdf files requires the 'pypdf' package. "
            "Install it with: pip install pypdf"
        ) from e

    reader = pypdf.PdfReader(path)

    # --- extract text from every page ---
    page_texts: list[str] = []
    for page in reader.pages:
        page_texts.append(page.extract_text() or "")

    # Detect scanned PDFs: if fewer than 10% of pages have any text at all,
    # the PDF is almost certainly images-only and we can't process it.
    non_empty = sum(1 for t in page_texts if t.strip())
    if len(page_texts) > 0 and non_empty / len(page_texts) < 0.10:
        raise RuntimeError(
            "This PDF appears to be a scanned document (no extractable text found). "
            "Only born-digital PDFs are supported. To use a scanned PDF, first run "
            "it through an OCR tool to produce a searchable PDF or a plain text file."
        )

    # --- try to use the PDF outline (bookmarks) for chapter boundaries ---
    sections: list[Section] | None = None
    try:
        outline = reader.outline
        # Flatten nested bookmark lists; skip nested entries (sub-headings) so
        # we only split on top-level chapters.
        flat_bookmarks: list[tuple[str, int]] = []  # (title, page_index)
        for entry in outline:
            if isinstance(entry, list):
                # nested group — use the first item (the parent heading) only
                if entry and not isinstance(entry[0], list):
                    bm = entry[0]
                    page_idx = reader.get_destination_page_number(bm)
                    flat_bookmarks.append((bm.title.strip(), page_idx))
            else:
                page_idx = reader.get_destination_page_number(entry)
                flat_bookmarks.append((entry.title.strip(), page_idx))

        if len(flat_bookmarks) >= 2:
            # Build sections from page ranges defined by consecutive bookmarks.
            bm_sections: list[Section] = []
            for i, (title, start_page) in enumerate(flat_bookmarks):
                end_page = flat_bookmarks[i + 1][1] if i + 1 < len(flat_bookmarks) else len(page_texts)
                body = "\n\n".join(
                    t for t in (page_texts[p].strip() for p in range(start_page, end_page))
                    if t
                )
                if body:
                    bm_sections.append(Section(title=title or f"Section {i + 1}", text=body))
            if len(bm_sections) >= 2:
                sections = bm_sections
    except Exception:
        # Outline parsing failed or outline is absent — fall through to text-based split.
        pass

    # --- fall back to heading-regex / paragraph-chunk split ---
    if sections is None:
        full_text = "\n\n".join(t for t in page_texts if t.strip())
        sections = split_plain_text(full_text, max_chars=max_chars)
        return sections  # split_plain_text already calls _subdivide_long_sections

    return _subdivide_long_sections(sections, max_chars)


def split_ebook(path: str, max_chars: int = 9000) -> list[Section]:
    """Split an ebook file into LLM-sized sections. Supports .txt, .md, .epub, .pdf."""
    ext = os.path.splitext(path)[1].lower()
    if ext == '.epub':
        return split_epub(path, max_chars=max_chars)
    if ext == '.pdf':
        return split_pdf(path, max_chars=max_chars)
    if ext in ('.txt', '.md', '.markdown'):
        with open(path, 'r', encoding='utf-8', errors='replace') as f:
            text = f.read()
        return split_plain_text(text, max_chars=max_chars)
    raise ValueError(f"Unsupported file type: {ext}. Supported: .txt, .md, .epub, .pdf")


# ------------------------------------------------------------ title / author

# Project Gutenberg-style metadata lines: "**Title**: Wuthering Heights", "Author: Emily Brontë"
_TITLE_LINE = re.compile(r'^\*{0,2}Title\*{0,2}\s*:\s*(.+?)\*{0,2}\s*$', re.IGNORECASE)
_AUTHOR_LINE = re.compile(r'^\*{0,2}Author\*{0,2}\s*:\s*(.+?)\*{0,2}\s*$', re.IGNORECASE)
# "by Emily Brontë" lines (often immediately under a title heading)
_BY_LINE = re.compile(r'^#{0,3}\s*by\s+(.+?)\s*$', re.IGNORECASE)
# Markdown heading: capture the marker depth and the heading text
_MD_HEADING = re.compile(r'^(#{1,2})\s+(.+?)\s*$')
_CHAPTER_LIKE = re.compile(r'^(chapter|chap\.?|part|book|section|act)\b', re.IGNORECASE)


def _detect_title_author_from_text(text: str) -> tuple[str, str]:
    """Best-effort scan for a title/author. Returns ('', '') for parts that
    can't be determined confidently — callers should fall back sensibly."""
    title, author = "", ""

    # Pass 1: explicit "Title: ..." / "Author: ..." metadata lines, common in
    # Project Gutenberg and similar sources, usually within the first ~300 lines.
    for raw in text.splitlines()[:300]:
        line = raw.strip()
        if not title:
            m = _TITLE_LINE.match(line)
            if m:
                title = m.group(1).strip()
        if not author:
            m = _AUTHOR_LINE.match(line)
            if m:
                author = m.group(1).strip()
        if title and author:
            return title, author

    # Pass 2: a markdown heading near the top of the real text, optionally
    # followed within a couple lines by a "by AUTHOR NAME" line.
    body = _strip_boilerplate(text)
    nonblank = [ln.strip() for ln in body.splitlines() if ln.strip()]
    for i, line in enumerate(nonblank[:20]):
        m = _MD_HEADING.match(line)
        if not m:
            continue
        candidate = m.group(2).strip()
        if _CHAPTER_LIKE.match(candidate):
            continue  # this heading is a chapter/part marker, not a title
        if not title:
            title = candidate
            for nxt in nonblank[i + 1:i + 4]:
                bm = _BY_LINE.match(nxt)
                if bm:
                    author = bm.group(1).strip()
                    break
            break

    return title, author


def _epub_metadata(path: str, name: str) -> str:
    try:
        import ebooklib
        from ebooklib import epub
    except ImportError:
        return ""
    try:
        book = epub.read_epub(path, options={"ignore_ncx": True})
        items = book.get_metadata('DC', name)
        if items:
            return str(items[0][0]).strip()
    except Exception:
        pass
    return ""


def _pdf_metadata(path: str) -> tuple[str, str]:
    """Extract title and author from a PDF's document-info dictionary."""
    try:
        import pypdf
        reader = pypdf.PdfReader(path)
        info = reader.metadata or {}
        title = (info.get("/Title") or "").strip()
        author = (info.get("/Author") or "").strip()
        return title, author
    except Exception:
        return "", ""


def detect_title_author(path: str) -> tuple[str, str]:
    """Best-effort guess at a book's title and author from the file itself.
    Returns ('', '') for parts it can't determine — the caller should fall
    back to something sensible (e.g. the filename) for the title."""
    ext = os.path.splitext(path)[1].lower()

    if ext == '.epub':
        return _epub_metadata(path, 'title'), _epub_metadata(path, 'creator')

    if ext == '.pdf':
        return _pdf_metadata(path)

    if ext in ('.txt', '.md', '.markdown'):
        try:
            with open(path, 'r', encoding='utf-8', errors='replace') as f:
                text = f.read(40000)
        except OSError:
            return "", ""
        return _detect_title_author_from_text(text)

    return "", ""
