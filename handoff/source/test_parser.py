"""Quick smoke test for parser.py — run with: python test_parser.py <path-to-text-file>

Splits the given file and prints the detected sections with sizes, so you can
sanity-check chapter detection before running the full GUI/API pipeline.
"""

import sys
from parser import split_ebook

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_parser.py <path-to-ebook.txt|.md|.epub>")
        sys.exit(1)

    path = sys.argv[1]
    sections = split_ebook(path)
    print(f"Detected {len(sections)} section(s):\n")
    for i, sec in enumerate(sections, 1):
        preview = sec.text[:90].replace("\n", " ")
        print(f"{i:3}. {sec.title!r:45} {sec.word_count:6} words   {sec.char_count:7} chars   "
              f"\"{preview}...\"")
