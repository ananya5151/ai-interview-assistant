"use client"

import { useState, useEffect } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { IntervieweeChat } from "@/components/interviewee-chat"
import { InterviewerDashboard } from "@/components/interviewer-dashboard"
import { useInterviewStore } from "@/store/interview-store"

export default function HomePage() {
  const [tab, setTab] = useState<"interviewee" | "interviewer">("interviewee")
  const status = useInterviewStore((s) => s.status)
  const hasUnfinished = false

  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto p-4 max-w-7xl">
        <header className="mb-6">
          <h1 className="text-3xl md:text-4xl font-bold mb-2">
            Crisp AI Interview Assistant
          </h1>
          <p className="text-muted-foreground">
            Conduct voice-powered technical interviews with real-time AI evaluation
          </p>
        </header>

        {/* Welcome back modal removed - no resume prompts */}

        <Card className="shadow-lg">
          <CardHeader className="p-0 border-b">
            <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="w-full">
              <TabsList className="grid grid-cols-2 w-full rounded-none">
                <TabsTrigger value="interviewee" className="data-[state=active]:bg-background">
                  Interviewee
                </TabsTrigger>
                <TabsTrigger value="interviewer" className="data-[state=active]:bg-background">
                  Interviewer Dashboard
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent className="p-0">
            <Tabs value={tab}>
              <TabsContent value="interviewee" className="p-6 m-0">
                <IntervieweeChat />
              </TabsContent>
              <TabsContent value="interviewer" className="p-6 m-0">
                <InterviewerDashboard onOpenInterviewee={() => setTab("interviewee")} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}