import { generateText } from "ai"
import { google } from "@ai-sdk/google"

export const maxDuration = 30

export async function POST(req: Request) {
  try {
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      console.error('Missing GOOGLE_GENERATIVE_AI_API_KEY environment variable');
      return new Response(JSON.stringify({ error: "API key not configured", details: "Missing GOOGLE_GENERATIVE_AI_API_KEY" }), { status: 500 })
    }

    const body = await req.json()
    console.log('Evaluate API request body:', body)

    const { question, answer, difficulty, timeTakenSec } = body

    if (!question || question.trim() === "") {
      console.error('Missing or empty question in request:', { question, answer, difficulty })
      return new Response(JSON.stringify({ error: "Missing question", details: "Question is required for evaluation" }), { status: 400 })
    }

    if (!answer || answer.trim() === "") {
      console.log('Warning: Empty answer provided for evaluation')
      return Response.json({
        score: 0,
        feedback: "No answer was provided."
      })
    }

    let text: string = ''
    try {
      const result = await generateText({
        model: google("models/gemini-2.5-flash"),
        prompt: `You are an expert technical interviewer evaluating a Full Stack Developer interview answer.\n\nQuestion: ${question}\nCandidate Answer: ${answer}\nDifficulty: ${difficulty}\nTime Taken: ${timeTakenSec || 'N/A'} seconds\n\nRespond ONLY with JSON: {\n  \"score\": <0-10>,\n  \"feedback\": \"<short feedback>\"\n}`,
        maxOutputTokens: 300,
        temperature: 0.3,
      })
      text = result.text
    } catch (modelErr: any) {
      // Detect rate limit from provider-utils error shape
      if (modelErr?.statusCode === 429 || /quota/i.test(modelErr?.message || '')) {
        return new Response(JSON.stringify({
          score: 0,
          feedback: "Rate limit reached. Your answer was recorded but not evaluated.",
          rateLimited: true
        }), { status: 429 })
      }
      console.warn('Model call failed, returning fallback evaluation', modelErr)
      return Response.json({
        score: 5,
        feedback: "Automatic fallback: partial evaluation due to service issue."
      })
    }

    let evaluation: any
    try {
      evaluation = JSON.parse(text.trim())
    } catch (parseError) {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try { evaluation = JSON.parse(jsonMatch[0]) } catch { }
      }
    }

    // If model didn't return valid JSON, attempt a simple heuristic fallback
    if (!evaluation || typeof evaluation.score !== 'number' || typeof evaluation.feedback !== 'string') {
      // Basic heuristic: score by answer length and keyword overlap with question
      const qWords: string[] = (question || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
      const aWords: string[] = (answer || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
      const overlap = qWords.filter((w: string) => aWords.includes(w)).length
      const lengthScore = Math.min(1, aWords.length / 50) // up to 1.0
      const overlapScore = Math.min(1, overlap / Math.max(1, qWords.length))
      const heuristicScore = Math.round(((lengthScore * 0.4) + (overlapScore * 0.6)) * 10)
      evaluation = { score: heuristicScore || 3, feedback: 'Fallback heuristic evaluation (partial confidence).' }
    }

    // Normalize score to integer 0-10
    evaluation.score = Math.max(0, Math.min(10, Math.round(Number(evaluation.score) || 0)))

    console.log('Evaluation completed:', evaluation)
    return Response.json(evaluation)
  } catch (e: any) {
    console.error('Evaluate API error:', e);
    return new Response(JSON.stringify({ error: "Failed to evaluate", details: e.message || 'Unknown error' }), { status: 500 })
  }
}
