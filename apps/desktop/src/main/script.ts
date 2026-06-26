import { chatCompletion } from "./story/llm";

export async function generateScript({
  providerId,
  topic,
  lengthHint,
}: {
  providerId: string;
  topic: string;
  lengthHint?: string;
}): Promise<string> {
  const response = await chatCompletion({
    providerId,
    temperature: 0.75,
    messages: [
      {
        role: "system",
        content: [
          "You write tight narration scripts for short-form videos.",
          "Return only the script text, without markdown fences, scene directions, title labels, or bullets.",
          "Use short sentences, concrete nouns, and a strong opening hook.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          `Topic: ${topic.trim() || "AI Video Studio product overview"}`,
          `Length: ${lengthHint?.trim() || "45-60 seconds"}`,
          "Write a voiceover script suitable for captions and fast desktop video rendering.",
        ].join("\n"),
      },
    ],
  });
  return response.replace(/^```(?:text)?/i, "").replace(/```$/i, "").trim();
}
