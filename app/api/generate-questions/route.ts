import { generateObject } from "ai"
import { google } from "@ai-sdk/google"
import { z } from "zod"

export const maxDuration = 30

const QuestionsSchema = z.object({
    questions: z
        .array(
            z.object({
                difficulty: z.enum(["easy", "medium", "hard"]),
                question: z.string().min(8),
            })
        )
        .length(6),
})

const BodySchema = z
    .object({
        role: z.string().min(1).default("Software Engineer"),
        candidate: z
            .object({
                name: z.string().optional(),
                email: z.string().optional(),
            })
            .optional(),
    })
    .default({ role: "Software Engineer" })

export async function POST(req: Request) {
    try {
        if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
            console.error("Missing GOOGLE_GENERATIVE_AI_API_KEY environment variable")
            return new Response(
                JSON.stringify({
                    error: "API key not configured",
                    details: "Missing GOOGLE_GENERATIVE_AI_API_KEY",
                }),
                { status: 500 }
            )
        }

        // Parse and validate body with safe defaults
        const raw = await req.json().catch(() => ({}))
        const body = BodySchema.parse(raw)
        const role = body.role || "Software Engineer"
        const candidateName = body.candidate?.name?.trim()

        const prompt = `You are an expert interviewer for a ${role} role.
Generate exactly six questions to assess practical skills: 2 easy, 2 medium, 2 hard.
Constraints:
- Do not include answers.
- Keep each question concise (one sentence when possible).
- Output ONLY structured JSON that matches the provided schema.`

        // Helper to call a specific model with a tight token budget to avoid reasoning overrun
        const callModel = async (modelId: string, temperature = 0.4) => {
            const content: { type: "text"; text: string }[] = [
                { type: "text", text: prompt },
                {
                    type: "text",
                    text:
                        "Return a JSON object: { questions: [{ difficulty: 'easy'|'medium'|'hard', question: string }] } with exactly 6 items: 2 easy, 2 medium, 2 hard.",
                },
                { type: "text", text: "No extra text. JSON only." },
            ]

            if (candidateName) {
                content.splice(2, 0, {
                    type: "text",
                    text: `You may include ${candidateName}'s name in the question context if natural, but it's optional.`,
                })
            }

            return generateObject({
                model: google(modelId),
                schema: QuestionsSchema,
                messages: [
                    {
                        role: "user",
                        content,
                    },
                ],
                temperature,
                maxOutputTokens: 256,
            })
        }

        // Attempt 1: smaller flash model to reduce reasoning token usage
        try {
            const { object } = await callModel("models/gemini-1.5-flash-8b-latest", 0.3)
            console.log("Generated 6 questions (gemini-1.5-flash-8b-latest)")
            return Response.json({ questions: object.questions })
        } catch (err1) {
            console.warn("Retrying with gemini-1.5-flash-latest due to:", err1)
            // Attempt 2: standard flash model, even tighter temperature
            try {
                const { object } = await callModel("models/gemini-1.5-flash-latest", 0.2)
                console.log("Generated 6 questions (gemini-1.5-flash-latest)")
                return Response.json({ questions: object.questions })
            } catch (err2) {
                console.warn("Retrying with gemini-1.5-pro-latest due to:", err2)
                // Attempt 3: pro model as a final AI attempt
                try {
                    const { object } = await callModel("models/gemini-1.5-pro-latest", 0.2)
                    console.log("Generated 6 questions (gemini-1.5-pro-latest)")
                    return Response.json({ questions: object.questions })
                } catch (err3) {
                    console.error("All AI attempts failed, falling back to static questions", err3)
                    // Final fallback: deterministic static questions tailored by role label only
                    const fallback: z.infer<typeof QuestionsSchema> = {
                        questions: [
                            { difficulty: "easy", question: `Explain the primary responsibilities of a ${role}.` },
                            { difficulty: "easy", question: `What tools or technologies are commonly used by a ${role}?` },
                            { difficulty: "medium", question: `Describe a challenging problem you solved recently related to ${role} work.` },
                            { difficulty: "medium", question: `How do you approach debugging or troubleshooting in ${role} tasks?` },
                            { difficulty: "hard", question: `Walk through designing a scalable solution for a core ${role} scenario.` },
                            { difficulty: "hard", question: `Discuss trade-offs between two architectures or approaches relevant to a ${role}.` },
                        ],
                    }
                    return Response.json(fallback)
                }
            }
        }
    } catch (error) {
        console.error("Generate questions error:", error)
        return new Response(
            JSON.stringify({
                error: "Failed to generate questions",
                details: error instanceof Error ? error.message : String(error),
            }),
            { status: 500 }
        )
    }
}