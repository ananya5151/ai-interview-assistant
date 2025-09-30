"use client"

import { useState } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { IntervieweeChat } from "@/components/interviewee-chat"
import { InterviewerDashboard } from "@/components/interviewer-dashboard"
import { WelcomeBackModal } from "@/components/welcome-back-modal"
import { useInterviewStore } from "@/store/interview-store"

export default function HomePage() {
  const [tab, setTab] = useState<"interviewee" | "interviewer">("interviewee")
  const status = useInterviewStore((s) => s.status)
  const hasUnfinished = status === "collecting" || status === "in_progress"

  return (
    <main className="container mx-auto p-4">
      <header className="mb-4">
        <h1 className="text-2xl md:text-3xl font-semibold text-balance">Crisp — AI Interview Assistant</h1>
        <p className="text-muted-foreground">Run timed interviews, evaluate answers, and review candidates.</p>
      </header>

      {hasUnfinished ? <WelcomeBackModal /> : null}

      <Card>
        <CardHeader className="p-0 border-b">
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="w-full">
            <TabsList className="grid grid-cols-2">
              <TabsTrigger value="interviewee">Interviewee</TabsTrigger>
              <TabsTrigger value="interviewer">Interviewer</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="p-0">
          <Tabs value={tab}>
            <TabsContent value="interviewee" className="p-4">
              <IntervieweeChat />
            </TabsContent>
            <TabsContent value="interviewer" className="p-4">
              <InterviewerDashboard onOpenInterviewee={() => setTab("interviewee")} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </main>
  )
}
