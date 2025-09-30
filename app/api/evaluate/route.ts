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
      // Allow empty answers but return a default low score
      return Response.json({
        score: 0,
        feedback: "No answer provided. Please try speaking your answer clearly."
      })
    }

    const { text } = await generateText({
      model: google("models/gemini-2.5-flash"),
      prompt: `
You are an expert technical interviewer evaluating a Full Stack Developer interview answer.

Question: ${question}
Candidate Answer: ${answer}
Difficulty: ${difficulty}
Time Taken: ${timeTakenSec || 'N/A'} seconds

Evaluate this answer and respond with ONLY a JSON object in this exact format:
{
  "score": 7,
  "feedback": "Good understanding of React hooks with practical examples. Could have mentioned useEffect dependencies for completeness."
}

Scoring Guidelines:
- 0-3: Incorrect, missing key concepts, or no answer
- 4-6: Partially correct, basic understanding shown
- 7-8: Good answer, demonstrates solid knowledge
- 9-10: Excellent, comprehensive answer with insights

Keep feedback to 1-2 sentences, focused and constructive.
`,
      maxOutputTokens: 300,
      temperature: 0.3,
    })

    let evaluation
    try {
      evaluation = JSON.parse(text.trim())
    } catch (parseError) {
      // Fallback: extract JSON from text if it's wrapped in other content
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        evaluation = JSON.parse(jsonMatch[0])
      } else {
        throw new Error("Invalid JSON response from Gemini")
      }
    }

    // Validate the structure
    if (typeof evaluation.score !== 'number' || !evaluation.feedback) {
      throw new Error("Invalid evaluation structure")
    }

    // Ensure score is within bounds
    evaluation.score = Math.max(0, Math.min(10, evaluation.score))

    console.log('Evaluation completed:', evaluation)
    return Response.json(evaluation)
  } catch (e: any) {
    console.error('Evaluate API error:', e);
    return new Response(JSON.stringify({ error: "Failed to evaluate", details: e.message }), { status: 500 })
  }
}
