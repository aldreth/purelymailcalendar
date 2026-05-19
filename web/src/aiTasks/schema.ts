/** JSON schema passed as the `responseConstraint` to the Prompt API so the
 * model is forced to return parseable structured output. Gemini Nano is
 * small and prone to free-form drift; the schema bounds the search space
 * enough that we can `JSON.parse` the response with confidence.
 *
 * The schema is intentionally tight: bounded array length, bounded title
 * length, both `due` and `owner` optional and only filled when the model
 * is confident. We surface those without further validation, but pin the
 * top-level shape to {has_tasks, tasks}. */
export const TASK_EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    has_tasks: { type: "boolean" },
    tasks: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200 },
          due: { type: "string", description: "ISO datetime if mentioned in the email; else omit." },
          owner: { type: "string", description: "Person responsible if explicit; else omit." },
        },
      },
    },
  },
  required: ["has_tasks", "tasks"],
} as const;


export type ExtractedTask = {
  title: string;
  due?: string;
  owner?: string;
};

export type ExtractionResult = {
  has_tasks: boolean;
  tasks: ExtractedTask[];
};


/** System prompt: kept short to leave room for the email body. */
export const EXTRACT_SYSTEM_PROMPT = `You read one email and extract action items the recipient needs to do. Ignore newsletters, marketing, receipts, social notifications, and FYI-only messages. If the email asks for nothing concrete, return has_tasks=false and an empty list. Be conservative. Only fill 'due' if the email mentions a specific date or time; never guess.`;
