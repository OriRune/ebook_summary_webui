import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { splitEpub, detectTitleAuthorEpub } from "@/lib/parser/epub";

const BODY1 =
  "It is a truth universally acknowledged, that a single man in possession of a " +
  "good fortune, must be in want of a wife. However little known the feelings or " +
  "views of such a man may be on his first entering a neighbourhood, this truth is " +
  "so well fixed in the minds of the surrounding families.";

const BODY2 =
  "Mr. Bennet was so odd a mixture of quick parts, sarcastic humour, reserve, and " +
  "caprice, that the experience of three-and-twenty years had been insufficient to " +
  "make his wife understand his character. Her mind was less difficult to develop, " +
  "and her sole business was to get her daughters married.";

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

// Note: epub2 (xml2js 0.1 defaults) only treats manifest/spine children as arrays
// when there are 2+ of them, so the fixture intentionally has two chapters.
const OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Pride and Prejudice</dc:title>
    <dc:creator>Jane Austen</dc:creator>
    <dc:identifier id="bookid">urn:uuid:test-book</dc:identifier>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="chap1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chap2" href="chap2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chap1"/>
    <itemref idref="chap2"/>
  </spine>
</package>`;

const chapXhtml = (heading: string, body: string) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${heading}</title></head>
<body><h1>${heading}</h1><p>${body}</p></body></html>`;

let epubPath: string;

beforeAll(async () => {
  const zip = new JSZip();
  // mimetype must be the first entry and stored uncompressed.
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", CONTAINER);
  zip.file("OEBPS/content.opf", OPF);
  zip.file("OEBPS/chap1.xhtml", chapXhtml("Chapter One", BODY1));
  zip.file("OEBPS/chap2.xhtml", chapXhtml("Chapter Two", BODY2));
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  epubPath = join(tmpdir(), `fixture-${randomUUID()}.epub`);
  await writeFile(epubPath, buf);
});

afterAll(async () => {
  await unlink(epubPath).catch(() => {});
});

describe("EPUB parser (fixture)", () => {
  it("1.9 detects Dublin Core title/author", async () => {
    const [title, author] = await detectTitleAuthorEpub(epubPath);
    expect(title).toBe("Pride and Prejudice");
    expect(author).toBe("Jane Austen");
  });

  it("splits the spine into sections, titled from the first heading", async () => {
    const sections = await splitEpub(epubPath);
    expect(sections.length).toBe(2);
    expect(sections[0].title).toBe("Chapter One");
    expect(sections[0].text).toContain("truth universally acknowledged");
    expect(sections[1].title).toBe("Chapter Two");
    expect(sections[1].text).toContain("odd a mixture");
  });
});
