/**
 * The canonical "(part N of M)" title-suffix pattern, ported from parser.py
 * PART_RE. Kept in its own module (no Node-only deps) so both the server parser
 * and client-side section utilities can share one definition.
 *
 * Group 1 = base title, group 2 = part number, group 3 = total parts.
 */
export const PART_RE = /^(.*) \(part (\d+) of (\d+)\)$/;
