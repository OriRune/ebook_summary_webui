/**
 * Extract the first valid JSON object from a model response.
 *
 * Ported from llm_client.py _extract_json. Cloud models (Claude) usually return
 * clean JSON; local models often wrap it in prose, code fences, or trailing
 * commentary, so this tries several strategies in sequence.
 */

/** Thrown when no valid JSON object can be recovered (Python: json.JSONDecodeError). */
export class JsonExtractionError extends Error {
  constructor(message = "No valid JSON object found in model response") {
    super(message);
    this.name = "JsonExtractionError";
  }
}

function tryParse(s: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function extractJson(raw: string): Record<string, unknown> {
  let text = raw.trim();

  // 0. Strip <think>...</think> reasoning blocks (Qwen3 and similar models).
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  // 1. Direct parse — the happy path (Claude's typical output).
  const direct = tryParse(text);
  if (direct !== undefined) return direct;

  // 2. Code fence — ```json ... ``` or ``` ... ``` anywhere in the text.
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(text);
  if (fence) {
    const parsed = tryParse(fence[1].trim());
    if (parsed !== undefined) return parsed;
  }

  // 3. Greedy {...} block — catches "Here is the JSON: {...}" patterns.
  const greedy = /\{[\s\S]*\}/.exec(text);
  if (greedy) {
    const parsed = tryParse(greedy[0]);
    if (parsed !== undefined) return parsed;
  }

  // 4. Balanced-brace scan — last resort for responses where the model mixed
  //    in a stray '}' after the real object, breaking the greedy regex above.
  const start = text.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (ch === "{") {
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const parsed = tryParse(text.slice(start, i + 1));
          if (parsed !== undefined) return parsed;
          break; // Not valid JSON even at the balanced close.
        }
      }
    }
  }

  throw new JsonExtractionError();
}
