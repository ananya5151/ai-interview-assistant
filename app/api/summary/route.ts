import { generateText } from "ai"
import { google } from "@ai-sdk/google"

export const maxDuration = 30

export async function POST(req: Request) {
  try {
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      console.error('Missing GOOGLE_GENERATIVE_AI_API_KEY environment variable')
      return new Response(JSON.stringify({ error: "API key not configured", details: "Missing GOOGLE_GENERATIVE_AI_API_KEY" }), { status: 500 })
    }

    const { candidate, perQuestion, finalScore } = await req.json()
    const prompt = `
Create a concise (3-5 sentences) hiring summary for a Full-Stack (React/Node) interview.
Include:
- Strengths demonstrated
- Notable gaps
- Overall recommendation (clear hire / lean hire / neutral / lean no / no hire)
Keep tone professional and objective.

Candidate: ${candidate?.name || "N/A"} (${candidate?.email || "N/A"})
Final Score: ${finalScore}/10
Per Question Scores:
${(perQuestion || []).map((q: any, i: number) => `Q${i + 1} [${q.difficulty}]: ${q.score}/10`).join("\n")}
`

    const { text } = await generateText({
      model: google("models/gemini-2.5-flash"),
      prompt,
      maxOutputTokens: 300,
      temperature: 0.5,
    })

    return Response.json({ summary: text.trim() })
  } catch (error) {
    console.error('Summary generation error:', error)
    return new Response(JSON.stringify({ error: "Failed to summarize", details: error instanceof Error ? error.message : String(error) }), { status: 500 })
  }
}
