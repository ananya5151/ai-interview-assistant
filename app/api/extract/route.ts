import { generateObject } from "ai"
import { google } from "@ai-sdk/google"
import { z } from "zod"

const extractSchema = z.object({
  name: z.string().describe("Full name of the candidate").optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
})

export const maxDuration = 30

export async function POST(req: Request) {
  try {
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      console.error('Missing GOOGLE_GENERATIVE_AI_API_KEY environment variable');
      return new Response(JSON.stringify({ error: "API key not configured" }), { status: 500 })
    }

    const contentType = req.headers.get('content-type') || ''
    let base64Data = ""
    let mediaType = "application/pdf"
    let filename = "resume.pdf"

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      const file = form.get('file') as File | null
      if (!file) {
        return new Response(JSON.stringify({ error: "Missing file in form-data" }), { status: 400 })
      }
      const buf = Buffer.from(await file.arrayBuffer())
      base64Data = buf.toString('base64')
      mediaType = file.type || mediaType
      filename = (file as any).name || filename
    } else {
      // JSON body with { file: { data, mediaType, filename } }
      const body = await req.json().catch(() => null)
      const file = body?.file
      if (!file?.data) {
        return new Response(JSON.stringify({ error: "Missing file" }), { status: 400 })
      }
      base64Data = file.data
      mediaType = file.mediaType || mediaType
      filename = file.filename || filename
    }

    // Optional size guard (limit ~7MB raw)
    try {
      const rawSize = Buffer.from(base64Data, 'base64').length
      if (rawSize > 7 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: "File too large", details: "Please upload a file up to 7MB." }), { status: 413 })
      }
    } catch { }

    const { object } = await generateObject({
      model: google("models/gemini-2.5-flash"),
      schema: extractSchema,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Extract Name, Email, and Phone from this resume file." },
            {
              type: "file",
              data: base64Data,
              mediaType,
              filename,
            },
          ],
        },
      ],
    })

    return Response.json({ extracted: object })
  } catch (e: any) {
    console.error('Extract API error:', e);
    return new Response(JSON.stringify({ error: "Failed to extract", details: e.message ?? String(e) }), { status: 500 })
  }
}
