/**
 * Client-side section operations (rename, merge, "(part N of M)" renumbering),
 * ported from main.py. Pure functions over plain arrays/records — no Node deps,
 * safe to import into client components.
 */
import type { Section, SectionResult } from "@/types";
import { PART_RE } from "@/lib/partRe";

export interface RunState {
  sections: Section[];
  checked: boolean[];
  results: Record<number, SectionResult>;
}

/** Decide the merged section's title and any sibling-renumber follow-up. */
function mergedTitleFor(
  a: Section,
  b: Section
): [string, string | null, number | null] {
  const ma = PART_RE.exec(a.title);
  const mb = PART_RE.exec(b.title);
  if (ma && mb && ma[1] === mb[1] && ma[3] === mb[3]) {
    const base = ma[1];
    const oldTotal = parseInt(ma[3], 10);
    const newTotal = oldTotal - 1;
    const title = newTotal <= 1 ? base : `${base} (part 1 of ${newTotal})`;
    return [title, base, oldTotal];
  }
  return [a.title, null, null];
}

/** Relabel the surviving "(part X of Y)" siblings of a chapter as 1..newTotal. */
function renumberSiblingParts(
  sections: Section[],
  baseTitle: string,
  newTotal: number
): Section[] {
  const out = [...sections];
  const matches: number[] = [];
  out.forEach((sec, i) => {
    const m = PART_RE.exec(sec.title);
    if ((m && m[1] === baseTitle) || sec.title === baseTitle) {
      matches.push(i);
    }
  });
  let seq = 1;
  for (const i of matches) {
    const newTitle =
      newTotal <= 1 ? baseTitle : `${baseTitle} (part ${seq} of ${newTotal})`;
    if (newTitle !== out[i].title) {
      out[i] = { title: newTitle, text: out[i].text };
    }
    seq += 1;
  }
  return out;
}

/** The merged title preview shown in a confirmation prompt. */
export function previewMergedTitle(
  sections: Section[],
  idx: number,
  direction: "previous" | "next"
): string | null {
  const [a, b] = neighborPair(sections, idx, direction);
  if (a === null) return null;
  return mergedTitleFor(sections[a], sections[b])[0];
}

function neighborPair(
  sections: Section[],
  idx: number,
  direction: "previous" | "next"
): [number, number] | [null, null] {
  if (direction === "previous") {
    if (idx === 0) return [null, null];
    return [idx - 1, idx];
  }
  if (idx === sections.length - 1) return [null, null];
  return [idx, idx + 1];
}

/** Merge a section with its previous/next neighbor. Returns null if at an edge. */
export function mergeSections(
  state: RunState,
  idx: number,
  direction: "previous" | "next"
): (RunState & { selected: number }) | null {
  const { sections, checked, results } = state;
  const [a, b] = neighborPair(sections, idx, direction);
  if (a === null) return null;

  const secA = sections[a];
  const secB = sections[b];
  const [mergedTitle, siblingBase, siblingTotal] = mergedTitleFor(secA, secB);

  const merged: Section = {
    title: mergedTitle,
    text: secA.text.replace(/\s+$/, "") + "\n\n" + secB.text.replace(/^\s+/, ""),
  };

  const oldCount = sections.length;
  let newSections = [...sections.slice(0, a), merged, ...sections.slice(b + 1)];

  const newChecked: boolean[] = new Array(newSections.length).fill(true);
  const newResults: Record<number, SectionResult> = {};
  for (let oldIdx = 0; oldIdx < oldCount; oldIdx++) {
    if (oldIdx === a || oldIdx === b) continue;
    const newIdx = oldIdx < a ? oldIdx : oldIdx - 1;
    newChecked[newIdx] = checked[oldIdx] ?? true;
    if (results[oldIdx]) newResults[newIdx] = results[oldIdx];
  }
  newChecked[a] = (checked[a] ?? true) || (checked[b] ?? true);

  if (siblingBase !== null && siblingTotal !== null) {
    newSections = renumberSiblingParts(newSections, siblingBase, siblingTotal - 1);
  }

  return { sections: newSections, checked: newChecked, results: newResults, selected: a };
}

/** Rename a single section (no renumbering of siblings). */
export function renameSection(
  sections: Section[],
  idx: number,
  newTitle: string
): Section[] {
  const out = [...sections];
  out[idx] = { title: newTitle, text: out[idx].text };
  return out;
}

/** The "(part N of M)" siblings of the section at idx (including itself), or []. */
export function chapterSiblings(sections: Section[], idx: number): number[] {
  const m = PART_RE.exec(sections[idx].title);
  if (!m) return [];
  const base = m[1];
  const total = m[3];
  const siblings: number[] = [];
  sections.forEach((s, i) => {
    const mm = PART_RE.exec(s.title);
    if (mm && mm[1] === base && mm[3] === total) siblings.push(i);
  });
  return siblings;
}

/** Retitle every sibling part of a chapter, preserving each part's number. */
export function renameChapterParts(
  sections: Section[],
  siblingIndices: number[],
  newBase: string
): Section[] {
  const out = [...sections];
  for (const i of siblingIndices) {
    const mm = PART_RE.exec(out[i].title);
    if (!mm) continue;
    out[i] = { title: `${newBase} (part ${mm[2]} of ${mm[3]})`, text: out[i].text };
  }
  return out;
}
