"use client"

import { useMemo, useState } from "react"
import { useInterviewStore } from "@/store/interview-store"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Play, Volume2, User, Bot } from "lucide-react"

type SortKey = "score" | "name" | "date"

export function InterviewerDashboard({ onOpenInterviewee }: { onOpenInterviewee?: () => void }) {
  // We do not keep historical candidates; show empty list and only allow
  // starting a new interview
  const lastSession = useInterviewStore((s) => s.lastSession)
  const candidates = lastSession ? [lastSession] : []
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<SortKey>("date")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const list = useMemo(() => {
    const filtered = candidates.filter(
      (c) =>
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.email.toLowerCase().includes(query.toLowerCase()),
    )
    const sorted = filtered.sort((a, b) => {
      if (sort === "score") return (b.finalScore ?? 0) - (a.finalScore ?? 0)
      if (sort === "name") return a.name.localeCompare(b.name)
      return (b.completedAt ?? 0) - (a.completedAt ?? 0)
    })
    return sorted
  }, [candidates, query, sort])

  const selected = list.find((c) => c.id === selectedId) || (candidates.length === 1 ? candidates[0] : null)

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="md:col-span-1">
        <CardHeader>
          <CardTitle>Candidates ({candidates.length})</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Input
            placeholder="Search name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={sort === "score" ? "default" : "secondary"}
              onClick={() => setSort("score")}
            >
              Score
            </Button>
            <Button
              size="sm"
              variant={sort === "name" ? "default" : "secondary"}
              onClick={() => setSort("name")}
            >
              Name
            </Button>
            <Button
              size="sm"
              variant={sort === "date" ? "default" : "secondary"}
              onClick={() => setSort("date")}
            >
              Date
            </Button>
          </div>

          <div className="grid gap-2 max-h-[60vh] overflow-auto">
            {list.map((c) => (
              <button
                key={c.id}
                className={cn(
                  "text-left border rounded-lg p-3 hover:bg-accent transition-colors",
                  selectedId === c.id ? "bg-accent border-primary" : "bg-card",
                )}
                onClick={() => setSelectedId(c.id)}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="font-medium">{c.name}</div>
                  <Badge variant={
                    c.finalScore >= 8 ? "default" :
                      c.finalScore >= 6 ? "secondary" :
                        "destructive"
                  }>
                    {c.finalScore}/10
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">{c.email}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {new Date(c.completedAt).toLocaleString()}
                </div>
              </button>
            ))}
            {list.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-8">
                No candidates found
              </div>
            )}
          </div>

          <Button variant="outline" onClick={() => onOpenInterviewee?.()}>
            Go to Interview
          </Button>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Interview Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!selected ? (
            <div className="text-center text-muted-foreground py-12">
              Select a candidate to view their interview details
            </div>
          ) : (
            <>
              {/* Candidate Profile */}
              <div className="grid md:grid-cols-3 gap-4 p-4 border rounded-lg bg-muted/30">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Name</div>
                  <div className="font-medium">{selected.name}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Email</div>
                  <div className="font-medium">{selected.email}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Phone</div>
                  <div className="font-medium">{selected.phone}</div>
                </div>
              </div>

              {/* Final Score & Summary */}
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">
                    Final Score
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-3xl font-bold">{selected.finalScore}</div>
                    <div className="text-muted-foreground">/10</div>
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-2">
                    AI Summary
                  </div>
                  <div className="p-3 border rounded-lg bg-muted/50 whitespace-pre-wrap text-sm">
                    {selected.summary || "No summary available"}
                  </div>
                </div>
              </div>

              {/* Per-Question Details */}
              <div className="space-y-3">
                <div className="text-sm font-medium">Question-by-Question Analysis</div>
                <div className="space-y-3 max-h-[50vh] overflow-y-auto">
                  {selected.questions.map((q, i) => (
                    <div key={i} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant={
                              q.difficulty === "easy" ? "default" :
                                q.difficulty === "medium" ? "secondary" :
                                  "destructive"
                            }>
                              Q{i + 1} - {q.difficulty.toUpperCase()}
                            </Badge>
                            <Badge variant="outline">
                              Score: {q.score}/10
                            </Badge>
                            {q.answerDurationSec !== undefined && (
                              <Badge variant="outline">
                                {q.answerDurationSec}s
                              </Badge>
                            )}
                          </div>
                          <p className="font-medium text-sm mb-2">{q.question}</p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">
                            Candidate Answer:
                          </div>
                          <div className="text-sm p-2 bg-muted/30 rounded">
                            {q.answer || "(No answer provided)"}
                          </div>
                        </div>

                        {q.answerAudioUrl && (
                          <div>
                            <div className="text-xs text-muted-foreground mb-1">
                              Audio Recording:
                            </div>
                            <audio
                              controls
                              className="w-full h-8"
                              preload="metadata"
                            >
                              <source src={q.answerAudioUrl} type="audio/webm" />
                              Your browser does not support audio playback.
                            </audio>
                          </div>
                        )}

                        <div>
                          <div className="text-xs text-muted-foreground mb-1">
                            AI Feedback:
                          </div>
                          <div className="text-sm p-2 bg-blue-50 dark:bg-blue-950/30 rounded border border-blue-200 dark:border-blue-900">
                            {q.feedback}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Chat Transcript */}
              <div className="space-y-3">
                <div className="text-sm font-medium">Full Transcript</div>
                <div className="border rounded-lg p-4 max-h-[40vh] overflow-y-auto space-y-2">
                  {selected.transcript.map((m, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        "flex gap-2 p-2 rounded text-sm",
                        m.role === "user"
                          ? "bg-primary/10 ml-8"
                          : m.role === "assistant"
                            ? "bg-muted mr-8"
                            : "bg-accent/50"
                      )}
                    >
                      <div className="flex-shrink-0 mt-0.5">
                        {m.role === "user" ? (
                          <User className="w-4 h-4" />
                        ) : m.role === "assistant" ? (
                          <Bot className="w-4 h-4" />
                        ) : (
                          <Volume2 className="w-4 h-4" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="text-xs font-medium text-muted-foreground mb-0.5">
                          {m.role === "user" ? "Candidate" : m.role === "assistant" ? "AI" : "System"}
                        </div>
                        <div className="whitespace-pre-wrap">{m.text}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}