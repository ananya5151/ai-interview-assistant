"use client"

import { useEffect, useState } from "react"
import { useInterviewStore } from "@/store/interview-store"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export function WelcomeBackModal() {
  const status = useInterviewStore((s) => s.status)
  const candidate = useInterviewStore((s) => s.candidate)
  const currentIndex = useInterviewStore((s) => s.currentIndex)
  const resetSession = useInterviewStore((s) => s.resetSession)
  const setStatus = useInterviewStore((s) => s.setStatus)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (status === "collecting" || status === "in_progress") {
      setOpen(true)
    }
  }, [status])

  if (!open) return null

  const candidateName = candidate.name || "candidate"
  const questionNumber = currentIndex + 1

  return (
    <div
      className="fixed inset-0 bg-foreground/20 backdrop-blur-sm flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome back"
    >
      <Card className="w-full max-w-md">
        <CardContent className="p-4 grid gap-3">
          <h2 className="text-lg font-semibold">Welcome Back</h2>
          <p className="text-sm text-muted-foreground">
            Welcome back, {candidateName}. You left at Question {questionNumber}. Would you like to resume?
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                resetSession()
                setOpen(false)
              }}
            >
              Start Over
            </Button>
            <Button
              onClick={() => {
                setStatus(status)
                setOpen(false)
              }}
            >
              Resume Interview
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
