import { z } from 'zod';
import type { JsonOutputFormat } from './claude-client';

type JsonSchema = Record<string, unknown>;

/** Keywords structured outputs enforce; kept as they are. */
const ENFORCED_KEYWORDS = new Set([
  'type',
  'description',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
]);
/** Limits the API doesn't support: they move into the description, where the model reads them. */
const DESCRIBED_KEYWORDS = new Set(['minLength', 'maxLength', 'minItems', 'maxItems']);

/**
 * Turns zod's JSON Schema into one structured outputs accept, the way the SDK's
 * `betaZodOutputFormat` does, except that `enum` stays a constraint: the SDK (0.131) moves it into
 * the description too, so the grammar wouldn't hold enums to their values. Any other keyword
 * throws here, at module load, instead of silently going unenforced.
 */
function toOutputSchema(node: JsonSchema): JsonSchema {
  const result: JsonSchema = {};
  const limits: string[] = [];

  for (const [keyword, value] of Object.entries(node)) {
    if (keyword === 'properties') {
      const properties = Object.entries(value as Record<string, JsonSchema>);
      result.properties = Object.fromEntries(
        properties.map(([name, property]) => [name, toOutputSchema(property)]),
      );
    } else if (keyword === 'items') {
      result.items = toOutputSchema(value as JsonSchema);
    } else if (ENFORCED_KEYWORDS.has(keyword)) {
      result[keyword] = value;
    } else if (DESCRIBED_KEYWORDS.has(keyword)) {
      limits.push(`${keyword}: ${JSON.stringify(value)}`);
    } else if (keyword !== '$schema') {
      throw new Error(`An output schema uses "${keyword}", which structured outputs don't take`);
    }
  }

  if (limits.length > 0) {
    const description = typeof result.description === 'string' ? `${result.description}\n\n` : '';
    result.description = `${description}{${limits.join(', ')}}`;
  }
  return result;
}

/**
 * A zod schema as structured outputs take it. Build it once per schema, at module load, so it is
 * byte-stable (the API caches a compiled schema for 24 hours). It is `type` and `schema` only,
 * with no `parse`: given one, the SDK would parse every text block on its own, which breaks on
 * refusals, truncated answers and answers continued by a fallback model. Callers parse the joined
 * text themselves.
 *
 * `reused: 'inline'` keeps every field in place; by default zod moves children of `.describe()`d
 * or `.max()`ed schemas into `$defs`, and the model would see references instead of fields.
 */
export function toJsonOutputFormat(schema: z.ZodType): JsonOutputFormat {
  return {
    type: 'json_schema',
    schema: toOutputSchema(z.toJSONSchema(schema, { reused: 'inline' })),
  };
}
