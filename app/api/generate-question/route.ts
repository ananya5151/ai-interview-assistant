// DEPRECATED: this route is no longer used. Use /api/generate-questions instead.
// Keeping as a 410 stub to avoid accidental usage.

export const maxDuration = 30; // Changed from 0 to 30

export async function POST() {
  return new Response(
    JSON.stringify({
      error: "Deprecated endpoint",
      message: "Use /api/generate-questions instead. This route returns 410 Gone.",
    }),
    {
      status: 410,
      headers: { "Content-Type": "application/json" },
    }
  );
}