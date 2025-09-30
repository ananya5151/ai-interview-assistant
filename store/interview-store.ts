"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"
import { nanoid } from "nanoid"

export type Difficulty = "easy" | "medium" | "hard"
export const difficultiesSequence: Difficulty[] = ["easy", "easy", "medium", "medium", "hard", "hard"]

type Message = { role: "system" | "assistant" | "user"; text: string }

export type Question = {
  text: string
  difficulty: Difficulty
  answer?: string
  answerAudio?: Blob // Audio recording of candidate's answer
  score?: number
  feedback?: string
  answerDurationSec?: number // measured seconds from question asked to answer submission
}

type CandidateProfile = {
  name: string
  email: string
  phone: string
  resumeFileName?: string
}

type CandidateCompleted = {
  id: string
  name: string
  email: string
  phone: string
  finalScore: number
  summary: string
  questions: Array<{
    question: string
    difficulty: Difficulty
    answer: string
    answerAudio?: Blob
    score: number
    feedback: string
    answerDurationSec?: number
  }>
  transcript: Message[]
  completedAt: number
}

type Status = "idle" | "collecting" | "ready" | "in_progress" | "completed"

type Store = {
  candidate: CandidateProfile
  status: Status
  messages: Message[]
  questions: Question[]
  currentIndex: number
  startedAt: number | null
  durationSec: number | null

  candidates: CandidateCompleted[]

  setCandidate: (profile: Partial<CandidateProfile>) => void
  setStatus: (s: Status) => void
  pushMessage: (m: Message) => void

  setQuestion: (idx: number, q: Pick<Question, "text" | "difficulty">) => void
  startQuestion: (durationSec: number) => void
  completeQuestion: (idx: number, patch: Pick<Question, "answer" | "answerAudio" | "score" | "feedback" | "answerDurationSec">) => void

  resetSession: () => void
  finalizeSession: (finalScore: number, summary: string) => Promise<void>
}

export const useInterviewStore = create<Store>()(
  persist(
    (set, get) => ({
      candidate: { name: "", email: "", phone: "" },
      status: "idle",
      messages: [{ role: "assistant", text: "Welcome to the AI Interview Assistant. Please upload your resume in PDF or DOCX format." }],
      questions: new Array(6).fill(null).map(() => ({ text: "", difficulty: "easy" as Difficulty })),
      currentIndex: 0,
      startedAt: null,
      durationSec: null,
      candidates: [],

      setCandidate: (profile) => set((s) => ({ candidate: { ...s.candidate, ...profile } })),
      setStatus: (s2) => set(() => ({ status: s2 })),
      pushMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),

      setQuestion: (idx, q) =>
        set((s) => {
          const arr = s.questions.slice()
          arr[idx] = { ...arr[idx], ...q }
          return { questions: arr }
        }),
      startQuestion: (duration) =>
        set((s) => ({ status: "in_progress", startedAt: Date.now(), durationSec: duration })),
      completeQuestion: (idx, patch) =>
        set((s) => {
          const arr = s.questions.slice()
          arr[idx] = { ...arr[idx], ...patch }
          const nextIndex = idx + 1
          return {
            questions: arr,
            currentIndex: nextIndex,
            startedAt: null,
            durationSec: null,
            // status will be updated by caller (either continue or finalize)
            status: nextIndex >= arr.length ? "completed" : "in_progress",
          }
        }),

      resetSession: () =>
        set({
          candidate: { name: "", email: "", phone: "" },
          status: "idle",
          messages: [],
          questions: new Array(6).fill(null).map(() => ({ text: "", difficulty: "easy" as Difficulty })),
          currentIndex: 0,
          startedAt: null,
          durationSec: null,
        }),

      finalizeSession: async (finalScore, summary) => {
        const s = get()
        const completed: CandidateCompleted = {
          id: nanoid(),
          name: s.candidate.name,
          email: s.candidate.email,
          phone: s.candidate.phone,
          finalScore,
          summary,
          questions: s.questions.map((q) => ({
            question: q.text,
            difficulty: q.difficulty,
            answer: q.answer || "",
            score: q.score || 0,
            feedback: q.feedback || "",
            answerDurationSec: q.answerDurationSec, // keep time taken
          })),
          transcript: s.messages,
          completedAt: Date.now(),
        }
        set((state) => ({
          candidates: [completed, ...state.candidates],
          status: "completed",
          startedAt: null,
          durationSec: null,
        }))
      },
    }),
    {
      name: "crisp-interview-store",
      version: 1,
      // Using localStorage for simplicity; can be swapped to IndexedDB/localForage if needed.
    },
  ),
)
