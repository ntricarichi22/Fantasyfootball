function collectStringsFromUnknown(value: unknown, bucket: string[]) {
  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed) {
      bucket.push(trimmed);
    }

    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringsFromUnknown(item, bucket);
    }

    return;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;

    for (const nestedValue of Object.values(record)) {
      collectStringsFromUnknown(nestedValue, bucket);
    }
  }
}

export function extractOutputText(data: any): string {
  const directTexts: string[] = [];

  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    directTexts.push(data.output_text.trim());
  }

  if (Array.isArray(data?.output)) {
    for (const item of data.output) {
      if (Array.isArray(item?.content)) {
        for (const content of item.content) {
          if (typeof content?.text === "string" && content.text.trim()) {
            directTexts.push(content.text.trim());
          }

          if (
            typeof content?.output_text === "string" &&
            content.output_text.trim()
          ) {
            directTexts.push(content.output_text.trim());
          }

          if (
            typeof content?.text?.value === "string" &&
            content.text.value.trim()
          ) {
            directTexts.push(content.text.value.trim());
          }
        }
      }

      if (typeof item?.text === "string" && item.text.trim()) {
        directTexts.push(item.text.trim());
      }

      if (
        typeof item?.output_text === "string" &&
        item.output_text.trim()
      ) {
        directTexts.push(item.output_text.trim());
      }
    }
  }

  const joinedDirect = directTexts.join("\n").trim();

  if (joinedDirect) {
    return joinedDirect;
  }

  const fallbackTexts: string[] = [];
  collectStringsFromUnknown(data?.output, fallbackTexts);

  const joinedFallback = fallbackTexts.join("\n").trim();

  if (joinedFallback) {
    return joinedFallback;
  }

  return "";
}

export async function askOpenAi(prompt: string): Promise<string> {
  const openAiKey = process.env.OPENAI_API_KEY;

  if (!openAiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-5-nano",
      store: false,
      reasoning: {
        effort: "minimal",
      },
      max_output_tokens: 250,
      input: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(
      typeof json?.error?.message === "string"
        ? json.error.message
        : "OpenAI request failed"
    );
  }

  const answer = extractOutputText(json);

  if (!answer) {
    throw new Error(
      `Model returned no text answer. Raw response: ${JSON.stringify(json)}`
    );
  }

  return answer;
}
