"use client"

import { useMemo, useState } from "react"
import { useInterviewStore } from "@/store/interview-store"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type SortKey = "score" | "name" | "date"

export function InterviewerDashboard({ onOpenInterviewee }: { onOpenInterviewee?: () => void }) {
  const candidates = useInterviewStore((s) => s.candidates)
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<SortKey>("score")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const list = useMemo(() => {
    const filtered = candidates.filter(
      (c) => c.name.toLowerCase().includes(query.toLowerCase()) || c.email.toLowerCase().includes(query.toLowerCase()),
    )
    const sorted = filtered.sort((a, b) => {
      if (sort === "score") return (b.finalScore ?? 0) - (a.finalScore ?? 0)
      if (sort === "name") return a.name.localeCompare(b.name)
      return (b.completedAt ?? 0) - (a.completedAt ?? 0)
    })
    return sorted
  }, [candidates, query, sort])

  const selected = list.find((c) => c.id === selectedId) || null

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="md:col-span-1">
        <CardHeader>
          <CardTitle>Candidates</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex items-center gap-2">
            <Input placeholder="Search name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant={sort === "score" ? "default" : "secondary"} onClick={() => setSort("score")}>
              Sort by Score
            </Button>
            <Button size="sm" variant={sort === "name" ? "default" : "secondary"} onClick={() => setSort("name")}>
              Name
            </Button>
            <Button size="sm" variant={sort === "date" ? "default" : "secondary"} onClick={() => setSort("date")}>
              Date
            </Button>
          </div>
          <div className="grid gap-2 max-h-[60vh] overflow-auto">
            {list.map((c) => (
              <button
                key={c.id}
                className={cn(
                  "text-left border rounded p-2 hover:bg-accent",
                  selectedId === c.id ? "bg-accent" : "bg-card",
                )}
                onClick={() => setSelectedId(c.id)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.email}</div>
                  </div>
                  <div className="font-mono">{c.finalScore ?? "-"}/10</div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(c.completedAt || Date.now()).toLocaleString()}
                </div>
              </button>
            ))}
            {list.length === 0 ? <div className="text-sm text-muted-foreground">No candidates yet.</div> : null}
          </div>
          <Button variant="secondary" onClick={() => onOpenInterviewee?.()}>
            Go to Interview
          </Button>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {!selected ? (
            <div className="text-muted-foreground">Select a candidate to view details.</div>
          ) : (
            <div className="grid gap-3">
              <div className="grid md:grid-cols-3 gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">Name</div>
                  <div className="font-medium">{selected.name}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Email</div>
                  <div className="font-medium">{selected.email}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Phone</div>
                  <div className="font-medium">{selected.phone}</div>
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground">Final Score</div>
                <div className="text-xl font-semibold">{selected.finalScore}/10</div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground">Summary</div>
                <div className="whitespace-pre-wrap">{selected.summary || "—"}</div>
              </div>

              <div className="grid gap-2">
                <div className="text-sm font-medium">Per-Question Scores</div>
                <div className="grid gap-2">
                  {selected.questions.map((q, i) => (
                    <div key={i} className="border rounded p-2">
                      <div className="text-xs text-muted-foreground">
                        Q{i + 1} — {q.difficulty?.toUpperCase()}
                      </div>
                      <div className="font-medium">{q.question}</div>
                      <div className="text-sm">Answer: {q.answer}</div>
                      <div className="text-sm">Score: {q.score}/10</div>
                      {q.answerDurationSec !== undefined ? (
                        <div className="text-sm">Time to answer: {Math.round(q.answerDurationSec)}s</div>
                      ) : null}
                      <div className="text-sm text-muted-foreground">Feedback: {q.feedback}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-2">
                <div className="text-sm font-medium">Chat Transcript</div>
                <div className="border rounded p-2 max-h-[40vh] overflow-auto">
                  {selected.transcript.map((m, idx) => (
                    <div key={idx} className="text-sm whitespace-pre-wrap">
                      <strong>{m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "System"}: </strong>
                      {m.text}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
