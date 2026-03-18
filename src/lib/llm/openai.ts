export function extractOutputText(data: any): string {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  if (!Array.isArray(data?.output)) {
    return "";
  }

  const texts: string[] = [];

  for (const item of data.output) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const content of item.content) {
        if (typeof content?.text === "string" && content.text.trim()) {
          texts.push(content.text.trim());
        }
      }
    }
  }

  return texts.join("\n").trim();
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
    throw new Error("Model returned no text answer");
  }

  return answer;
}