"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { nanoid } from "nanoid"

export type Difficulty = "easy" | "medium" | "hard"
export const difficultiesSequence: Difficulty[] = ["easy", "easy", "medium", "medium", "hard", "hard"]

type Message = { role: "system" | "assistant" | "user"; text: string }

export type Question = {
  text: string
  difficulty: Difficulty
  answer?: string
  answerAudioUrl?: string // Store as data URL for persistence
  score?: number
  feedback?: string
  answerDurationSec?: number
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
    answerAudioUrl?: string
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
  // Transient last session (not persisted) to surface the most recent interview to the interviewer dashboard
  lastSession?: CandidateCompleted | null

  setCandidate: (profile: Partial<CandidateProfile>) => void
  setStatus: (s: Status) => void
  pushMessage: (m: Message) => void

  setQuestion: (idx: number, q: Pick<Question, "text" | "difficulty">) => void
  setQuestionsBulk: (qs: Array<{ text: string; difficulty: Difficulty }>) => void
  // Update result fields for a specific question without changing currentIndex
  updateQuestionResult: (idx: number, patch: Partial<Pick<Question, "answer" | "score" | "feedback" | "answerAudioUrl" | "answerDurationSec">>) => void
  startQuestion: (durationSec: number) => void
  completeQuestion: (idx: number, patch: {
    answer: string
    answerAudio?: Blob
    score: number
    feedback: string
    answerDurationSec?: number
  }) => Promise<void>

  resetSession: () => void
  finalizeSession: (finalScore: number, summary: string) => Promise<void>
}

// Helper to convert Blob to data URL for storage
async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export const useInterviewStore = create<Store>()(
  persist(
    (set, get) => ({
      candidate: { name: "", email: "", phone: "" },
      status: "idle",
      messages: [],
      questions: new Array(6).fill(null).map((_, i) => ({
        text: "",
        difficulty: difficultiesSequence[i]
      })),
      currentIndex: 0,
      startedAt: null,
      durationSec: null,
      // candidates intentionally omitted

      setCandidate: (profile) =>
        set((s) => ({ candidate: { ...s.candidate, ...profile } })),

      setStatus: (s2) =>
        set(() => ({ status: s2 })),

      pushMessage: (m) =>
        set((s) => ({ messages: [...s.messages, m] })),

      setQuestion: (idx, q) =>
        set((s) => {
          const arr = s.questions.slice()
          arr[idx] = { ...arr[idx], ...q }
          return { questions: arr }
        }),

      // Set all questions at once to avoid intermediate race conditions
      setQuestionsBulk: (qs: Array<{ text: string; difficulty: Difficulty }>) =>
        set((s) => {
          const arr = qs.map((q, i) => ({
            text: q.text || s.questions[i]?.text || "",
            difficulty: q.difficulty || s.questions[i]?.difficulty,
          }))
          return { questions: arr }
        }),

      updateQuestionResult: (idx, patch) =>
        set((s) => {
          const arr = s.questions.slice()
          arr[idx] = { ...arr[idx], ...patch }
          return { questions: arr }
        }),

      startQuestion: (duration) =>
        set(() => ({
          status: "in_progress",
          startedAt: Date.now(),
          durationSec: duration
        })),

      completeQuestion: async (idx, patch) => {
        const { answerAudio, ...rest } = patch
        let answerAudioUrl: string | undefined

        // Convert Blob to data URL if present
        if (answerAudio) {
          try {
            answerAudioUrl = await blobToDataUrl(answerAudio)
          } catch (e) {
            console.error('Failed to convert audio blob:', e)
          }
        }

        set((s) => {
          const arr = s.questions.slice()
          arr[idx] = {
            ...arr[idx],
            ...rest,
            answerAudioUrl
          }
          const nextIndex = idx + 1

          return {
            questions: arr,
            currentIndex: nextIndex,
            startedAt: null,
            durationSec: null,
            status: nextIndex >= arr.length ? "completed" : "in_progress",
          }
        })
      },

      resetSession: () =>
        set({
          candidate: { name: "", email: "", phone: "" },
          status: "idle",
          messages: [],
          questions: new Array(6).fill(null).map((_, i) => ({
            text: "",
            difficulty: difficultiesSequence[i]
          })),
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
            answerAudioUrl: q.answerAudioUrl,
            score: q.score || 0,
            feedback: q.feedback || "",
            answerDurationSec: q.answerDurationSec,
          })),
          transcript: s.messages,
          completedAt: Date.now(),
        }

        // Store transiently in-memory (not persisted) so interviewer dashboard can show the completed interview
        set(() => ({
          lastSession: completed,
          status: "completed",
          startedAt: null,
          durationSec: null,
        }))
      },
    }),
    {
      name: "crisp-interview-store",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        candidate: state.candidate,
        status: state.status,
        messages: state.messages,
        questions: state.questions,
        currentIndex: state.currentIndex,
        startedAt: state.startedAt,
        durationSec: state.durationSec,
      }),
    },
  ),
)