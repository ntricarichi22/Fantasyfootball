/** One model setting for every CFC AI surface. Unsupported configured models
 * fail closed in the metering price lookup before any provider call. */
export const CFC_AI_MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5";
