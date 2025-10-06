"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { useInterviewStore, difficultiesSequence } from "@/store/interview-store"
import { cn } from "@/lib/utils"
import {
  Bot,
  CheckCircle,
  Download,
  FileText,
  Mic,
  MicOff,
  Upload,
  Volume2,
  User
} from "lucide-react"

// Minimal Window typing for SpeechRecognition constructors to avoid
// redeclaring DOM SpeechRecognition interfaces that may already exist.
declare global {
  interface Window {
    SpeechRecognition?: any
    webkitSpeechRecognition?: any
  }
}

// Minimal types used in this module to avoid colliding with DOM lib declarations
type SpeechRecognition = any
type SpeechRecognitionEvent = any

function createRecognition(): SpeechRecognition | null {
  if (typeof window === "undefined") return null
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Ctor) return null
  const rec = new Ctor()
  rec.lang = "en-US"
  rec.interimResults = true
  rec.continuous = true
  return rec
}

function speak(text: string, onStart?: () => void, onEnd?: () => void) {
  if (typeof window === "undefined") return
  const utter = new SpeechSynthesisUtterance(text)
  utter.rate = 1
  utter.pitch = 1
  utter.volume = 1

  utter.onstart = () => onStart?.()
  utter.onend = () => onEnd?.()

  try { window.speechSynthesis.cancel() } catch { }
  try { window.speechSynthesis.resume() } catch { }
  window.speechSynthesis.speak(utter)
}

function toBase64(bytes: Uint8Array) {
  let binary = ""
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function IntervieweeChat() {
  const {
    candidate,
    setCandidate,
    status,
    setStatus,
    messages,
    pushMessage,
    currentIndex,
    questions,
    setQuestion,
    setQuestionsBulk,
    startQuestion,
    completeQuestion,
    updateQuestionResult,
    resetSession,
    finalizeSession,
    startedAt,
    durationSec,
  } = useInterviewStore()

  const [fileError, setFileError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [recording, setRecording] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isRecordingAudio, setIsRecordingAudio] = useState(false)
  const [currentAudioBlob, setCurrentAudioBlob] = useState<Blob | null>(null)
  const [editableCandidate, setEditableCandidate] = useState({ name: "", email: "", phone: "" })
  const [missingField, setMissingField] = useState<"name" | "email" | "phone" | null>(null)
  const [evaluatingFlag, setEvaluatingFlag] = useState(false)

  const timerRef = useRef<number | null>(null)
  const submitFnRef = useRef<((auto?: boolean) => void) | null>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const hasSubmittedRef = useRef(false)
  const isEvaluatingRef = useRef(false)
  const spokenQuestionIndexRef = useRef<number | null>(null)

  const current = questions[currentIndex]
  const isInterviewDone = status === "completed"
  const canStart = candidate.name && candidate.email && candidate.phone
  const generatedQuestionsRef = useRef(false)

  // Timer tick
  useEffect(() => {
    if (status !== "in_progress" || !startedAt || !durationSec) {
      if (timerRef.current) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
      setRemaining(null)
      return
    }
    const tick = () => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      const rem = Math.max(0, durationSec - elapsed)
      setRemaining(rem)
      // Guard: only auto-submit once per question when timer hits 0
      if (rem <= 0) {
        const q = questions[currentIndex]
        const alreadyAnswered = !!q?.answer || hasSubmittedRef.current || isEvaluatingRef.current
        if (!alreadyAnswered) {
          submitFnRef.current?.(true)
        }
      }
    }
    tick()
    timerRef.current = window.setInterval(tick, 250)
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [status, startedAt, durationSec, currentIndex, questions])

  // Resume upload and extraction
  const onUpload = useCallback(
    async (file: File) => {
      setFileError(null)
      if (!file) return
      const lower = file.name.toLowerCase()
      const isPdf = file.type === "application/pdf" || lower.endsWith(".pdf")
      const isDocx = lower.endsWith(".docx")
      const isDoc = lower.endsWith(".doc")
      const isTxt = file.type === "text/plain" || lower.endsWith(".txt")
      if (!isPdf && !isDocx && !isDoc && !isTxt) {
        setFileError("Invalid file type. Please upload PDF, DOC, DOCX, or TXT.")
        speak("Invalid file type. Please upload PDF, DOC, DOCX, or TXT.")
        return
      }
      setUploading(true)
      try {
        const arrayBuffer = await file.arrayBuffer()
        const bytes = new Uint8Array(arrayBuffer)
        const base64 = toBase64(bytes)
        const mediaType = isPdf
          ? "application/pdf"
          : isDocx
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : isDoc
              ? "application/msword"
              : "text/plain"

        const res = await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file: { data: base64, mediaType, filename: file.name },
          }),
        })
        if (!res.ok) throw new Error("Extraction failed")
        const { extracted } = await res.json()

        const newCandidate = {
          name: extracted?.name || "",
          email: extracted?.email || "",
          phone: extracted?.phone || "",
          resumeFileName: file.name,
        }

        setCandidate(newCandidate)
        setEditableCandidate({
          name: extracted?.name || "",
          email: extracted?.email || "",
          phone: extracted?.phone || "",
        })

        pushMessage({
          role: "system",
          text: `Resume uploaded successfully: ${file.name}`
        })

        // Check for missing fields and handle voice capture
        const missing = !extracted?.name ? "name" : !extracted?.email ? "email" : !extracted?.phone ? "phone" : null

        if (missing) {
          setStatus("collecting")
          setMissingField(missing)
          const prompt = `I couldn't find your ${missing} in the resume. Please say your ${missing} now.`
          pushMessage({ role: "assistant", text: prompt })
          speak(prompt, () => setIsSpeaking(true), () => {
            setIsSpeaking(false)
            // Start listening after AI finishes speaking
            setTimeout(() => startVoiceCapture(missing), 500)
          })
        } else {
          // All fields present, ready to start
          setStatus("ready")
          const readyMessage = `Thanks, ${extracted.name}. Your details are complete. Click Start Interview when you're ready.`
          pushMessage({ role: "assistant", text: readyMessage })
          speak(readyMessage)
        }
      } catch (e: any) {
        setFileError("Could not process file. Please try another PDF/DOCX.")
        speak("Could not process file. Please try another PDF or DOCX.")
      } finally {
        setUploading(false)
      }
    },
    [pushMessage, setCandidate, setStatus],
  )

  // Voice capture for missing profile fields
  const startVoiceCapture = useCallback((field: "name" | "email" | "phone") => {
    if (isSpeaking) return

    const rec = createRecognition()
    if (!rec) {
      pushMessage({ role: "system", text: "Speech recognition not supported. Please type manually." })
      return
    }

    recognitionRef.current = rec
    rec.continuous = false
    rec.interimResults = false

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let txt = ""
      for (let i = e.resultIndex; i < e.results.length; i++) {
        txt += e.results[i][0]?.transcript || ""
      }
      let value = txt.trim()

      // Format based on field type
      if (field === 'email') value = value.replace(/\s+/g, '').toLowerCase()
      if (field === 'phone') value = value.replace(/[^+\d]/g, '')

      // Update state
      setEditableCandidate(prev => ({ ...prev, [field]: value }))
      setCandidate({
        ...candidate,
        [field]: value,
      })

      pushMessage({ role: "user", text: value })

      // Check next missing field
      const updatedCandidate = { ...candidate, [field]: value }
      const nextMissing = !updatedCandidate.name ? "name" : !updatedCandidate.email ? "email" : !updatedCandidate.phone ? "phone" : null

      if (nextMissing) {
        setMissingField(nextMissing)
        const prompt = `Please provide your ${nextMissing}.`
        pushMessage({ role: "assistant", text: prompt })
        speak(prompt, () => setIsSpeaking(true), () => {
          setIsSpeaking(false)
          setTimeout(() => startVoiceCapture(nextMissing), 500)
        })
      } else {
        // All fields collected
        setMissingField(null)
        setStatus("ready")
        const readyMsg = `Thanks! Your profile is complete. Click Start Interview when you're ready.`
        pushMessage({ role: "assistant", text: readyMsg })
        speak(readyMsg)
      }
    }

    rec.onerror = (event: any) => {
      console.error('Voice capture error:', event)
      setMissingField(null)
    }

    rec.onend = () => {
      setMissingField(null)
    }

    try {
      rec.start()
      setMissingField(field)
    } catch {
      setMissingField(null)
    }
  }, [candidate, isSpeaking, pushMessage, setCandidate, setStatus])

  // Generate all 6 questions at once
  const generateAllQuestions = useCallback(async () => {
    console.log('Generating all 6 questions at once')

    const res = await fetch("/api/generate-questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "Full-Stack (React/Node)",
        candidate: { name: candidate.name, email: candidate.email },
      }),
    })

    if (!res.ok) {
      console.error('Failed to generate questions:', res.status, res.statusText)
      return false
    }

    const { questions: generatedQuestions } = await res.json()
    console.log('Generated all questions:', generatedQuestions)

    // Map generated structure to the store shape and set atomically to avoid
    // intermediate renders where question text may be empty (race).
    const mapped = generatedQuestions.map((q: any, i: number) => ({
      text: q.question || "",
      difficulty: q.difficulty || difficultiesSequence[i],
    }))

    setQuestionsBulk(mapped)

    console.log('All questions set in store (bulk)')
    return mapped
  }, [candidate.name, candidate.email, setQuestion, setQuestionsBulk])

  // Audio recording
  // Start audio recording, reusing a cached MediaStream if available to reduce
  // permission prompts / getUserMedia latency between questions.
  const startAudioRecording = useCallback(async () => {
    try {
      let stream = mediaStreamRef.current
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        mediaStreamRef.current = stream
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      const audioChunks: BlobPart[] = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunks.push(event.data)
      }

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' })
        setCurrentAudioBlob(audioBlob)
        setIsRecordingAudio(false)
        // keep the stream open for reuse; do not stop tracks here
      }

      mediaRecorderRef.current = mediaRecorder
      mediaRecorder.start()
      setIsRecordingAudio(true)
      console.log('Audio recording started (reusing stream)')
    } catch (error) {
      console.error('Failed to start audio recording:', error)
      setIsRecordingAudio(false)
    }
  }, [])

  const stopAudioRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecordingAudio) {
      mediaRecorderRef.current.stop()
      console.log('Audio recording stopped')
    }
  }, [isRecordingAudio])

  // Speech recognition for answers
  const startRecognition = useCallback(async () => {
    if (isSpeaking) {
      console.log('Not starting recognition - AI is speaking')
      return
    }

    if (recording) {
      console.log('Recognition already active; skipping duplicate start')
      return
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch { }
    }

    const rec = createRecognition()
    recognitionRef.current = rec
    if (!rec) {
      pushMessage({
        role: "system",
        text: "Microphone access is required. Please enable it in browser settings.",
      })
      speak("Microphone access is required. Please enable it in browser settings.")
      return
    }


    // We'll throttle interim updates to avoid rapid repeated appends and use
    // a lastTranscript snapshot to diff. Throttling reduces UI churn.
    let lastTranscript = ""
    let lastUpdateAt = 0
    const INTERIM_THROTTLE_MS = 250
    setTranscript("")
    setRecording(true)
    await startAudioRecording()

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let combined = ""
      for (let i = e.resultIndex; i < e.results.length; i++) combined += e.results[i][0]?.transcript || ""

      // Diff against lastTranscript to only append new trailing part
      let newPart = combined
      if (combined.startsWith(lastTranscript)) newPart = combined.slice(lastTranscript.length).trim()

      const isFinal = e.results[e.results.length - 1].isFinal
      const now = Date.now()
      if (isFinal) {
        setTranscript((prev) => (prev ? prev + " " + combined : combined))
        lastTranscript = combined
        lastUpdateAt = now
      } else {
        // Throttle interim updates to INTERIM_THROTTLE_MS
        if (now - lastUpdateAt > INTERIM_THROTTLE_MS && newPart) {
          setTranscript((prev) => (prev ? prev + " " + newPart : newPart))
          lastTranscript = combined
          lastUpdateAt = now
        }
      }
    }

    rec.onerror = (event: any) => {
      console.error('Speech recognition error:', event)
      setRecording(false)
      if (event.error === 'not-allowed' || event.error === 'permission-denied') {
        pushMessage({
          role: "system",
          text: "Microphone access denied. Please enable it in browser settings.",
        })
        speak("Microphone access denied. Please enable it in browser settings.")
      }
    }

    rec.onend = () => {
      setRecording(false)
    }

    try {
      rec.start()
    } catch {
      setRecording(false)
    }
  }, [isSpeaking, recording, pushMessage, startAudioRecording])

  const stopRecognition = useCallback(() => {
    const rec = recognitionRef.current
    if (rec) {
      try {
        rec.stop()
      } catch { }
    }
    setRecording(false)
  }, [])

  // Start interview with automatic flow
  const handleStart = useCallback(async () => {
    if (!canStart) return

    const startMessage = `You'll be asked 6 questions for the Full-Stack role: 2 Easy with 20 seconds each, 2 Medium with 60 seconds, and 2 Hard with 120 seconds. When time is up, your answer will be automatically recorded and I'll move to the next question. Let's begin!`

    pushMessage({ role: "assistant", text: startMessage })

    speak(startMessage,
      () => setIsSpeaking(true),
      async () => {
        setIsSpeaking(false)

        // Generate all questions only once
        let firstQuestionText: string | undefined
        if (!generatedQuestionsRef.current && !questions[0]?.text) {
          const mapped = await generateAllQuestions()
          if (!mapped || !Array.isArray(mapped)) {
            const errorMessage = "I'm having trouble generating questions. Please try again."
            pushMessage({ role: "system", text: errorMessage })
            speak(errorMessage)
            return
          }
          generatedQuestionsRef.current = true
          // Reset spoken guard so the first question can be spoken
          spokenQuestionIndexRef.current = null
          firstQuestionText = mapped[0]?.text
        }

        // Start first question
        const difficulty = difficultiesSequence[0]
        const duration = difficulty === "easy" ? 20 : difficulty === "medium" ? 60 : 120
        startQuestion(duration)
        setStatus("in_progress")

        // Speak first question after brief pause; pass index/text explicitly to avoid race
        setTimeout(() => {
          const firstQ = firstQuestionText ?? questions[0]?.text
          speakQuestionThenListen(0, firstQ)
        }, 1000)
      }
    )
  }, [canStart, generateAllQuestions, pushMessage, setStatus, startQuestion])

  // Speak question then start listening with 3-second delay
  // Speak a question (by index) and then start listening after a 3s delay.
  // Accept explicit index and text to avoid races with store hydration.
  const speakQuestionThenListen = useCallback((indexArg?: number, textArg?: string) => {
    // Use live store state to avoid stale closure where questions/currentIndex may not be populated yet
    let attempts = 0
    const maxAttempts = 30
    const trySpeak = () => {
      const { questions: liveQuestions, currentIndex: liveIndex } = useInterviewStore.getState()
      const idx = typeof indexArg === 'number' ? indexArg : liveIndex
      const questionText = typeof textArg === 'string' && textArg.trim() ? textArg : liveQuestions?.[idx]?.text
      const explicitCall = typeof indexArg === 'number' || typeof textArg === 'string'
      if (!questionText || !questionText.trim()) {
        if (!explicitCall) {
          // If the caller didn't provide the question explicitly, it's likely a
          // stale/early invocation (component mount/hot-reload). No-op instead of
          // running the retry loop which produces noisy errors.
          return
        }

        attempts++
        if (attempts < maxAttempts) {
          setTimeout(trySpeak, 200)
        } else {
          console.error('No question text available after retries at index:', idx)
        }
        return
      }
      // Prevent speaking the same question multiple times
      if (spokenQuestionIndexRef.current === idx) {
        return
      }
      spokenQuestionIndexRef.current = idx
      if (recognitionRef.current) {
        try { recognitionRef.current.stop() } catch { }
      }
      setRecording(false)
      setIsSpeaking(true)
      pushMessage({ role: "assistant", text: `Question ${idx + 1}: ${questionText}` })
      speak(questionText,
        () => {
          console.log('Starting to speak question')
          setIsSpeaking(true)
        },
        () => {
          console.log('Finished speaking question, will start listening in 3 seconds')
          setIsSpeaking(false)
          setTimeout(() => {
            if (!isSpeaking) {
              console.log('Starting recognition after 3-second delay')
              startRecognition()
            }
          }, 3000)
        }
      )
    }
    trySpeak()
  }, [startRecognition, pushMessage, isSpeaking])

  // Handle answer submission (auto or manual)
  const handleStopAndSend = useCallback(
    async (auto = false) => {
      if (status !== "in_progress") return
      if (hasSubmittedRef.current || isEvaluatingRef.current) return
      hasSubmittedRef.current = true
      isEvaluatingRef.current = true
      setEvaluatingFlag(true)

      stopRecognition()
      stopAudioRecording()

      const q = questions[currentIndex]
      if (!q || !q.text) {
        console.error('No question available at index:', currentIndex)
        isEvaluatingRef.current = false
        hasSubmittedRef.current = false
        return
      }

      const userAnswer = auto ? (transcript || "(no answer)") : (transcript.trim() || "(no answer)")
      setTranscript("")

      if (auto) {
        const timeUpMsg = "Time's up! I've recorded your answer."
        pushMessage({ role: "assistant", text: timeUpMsg })
        speak(timeUpMsg, () => setIsSpeaking(true), () => setIsSpeaking(false))
      }

      pushMessage({ role: "user", text: userAnswer })

      const timeTakenSec = typeof startedAt === "number" ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : undefined

      // Provide an immediate provisional heuristic evaluation so the UI feels
      // responsive. Then run a background authoritative evaluation and patch
      // the question when the model result arrives via updateQuestionResult.
      const localEvaluate = (questionText: string, answerText: string, difficulty: string | undefined, timeSec?: number) => {
        const ans = (answerText || "").toLowerCase()
        const qtxt = (questionText || "").toLowerCase()
        const qWords = qtxt.split(/\W+/).filter(Boolean)
        const aWords = ans.split(/\W+/).filter(Boolean)
        const common = qWords.filter(w => aWords.includes(w)).length
        const overlapScore = qWords.length ? (common / qWords.length) : 0

        // length factor (short answers get penalized)
        const len = Math.min(200, ans.length)
        const lenScore = Math.min(1, len / 100)

        // difficulty bias
        const diffBias = difficulty === 'hard' ? 1.1 : difficulty === 'medium' ? 1.0 : 0.9

        let raw = (overlapScore * 0.6 + lenScore * 0.4) * diffBias
        raw = Math.max(0, Math.min(1.0, raw))
        const scaled = Math.round(raw * 10)

        let feedbackText = "Good attempt."
        if (!answerText || answerText === "(no answer)") feedbackText = "No answer was provided."
        else if (scaled <= 3) feedbackText = "Answer was too brief or missed key points."
        else if (scaled <= 6) feedbackText = "Solid attempt with room for more detail."
        else feedbackText = "Strong answer with relevant details."

        return { score: scaled, feedback: feedbackText }
      }

      let { score, feedback } = localEvaluate(q.text, userAnswer, q.difficulty, timeTakenSec)

      // Commit provisional result immediately so the UI can progress
      completeQuestion(currentIndex, {
        answer: userAnswer,
        answerAudio: currentAudioBlob || undefined,
        score,
        feedback,
        answerDurationSec: timeTakenSec,
      })

        // Fire-and-forget authoritative evaluation: call the server and patch
        // the question when/if a better final score is available.
        ; (async () => {
          try {
            const res = await fetch("/api/evaluate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                question: q.text,
                answer: userAnswer,
                difficulty: q.difficulty,
                timeTakenSec,
              }),
            })

            if (!res.ok) {
              console.warn('Background evaluation failed', res.status)
              return
            }

            const data = await res.json().catch(() => null)
            if (data && typeof data.score === 'number') {
              const finalScore = Math.max(0, Math.min(10, Math.round(data.score)))
              const finalFeedback = data.feedback || feedback
              // Patch the question with authoritative result
              try {
                updateQuestionResult(currentIndex, { score: finalScore, feedback: finalFeedback })
              } catch (e) {
                console.warn('Failed to update question result in store', e)
              }
            }
          } catch (e) {
            console.warn('Background evaluation error', e)
          }
        })()

      setCurrentAudioBlob(null)

      const feedbackMessage = `${feedback}. Your score: ${score} out of 10.`
      pushMessage({ role: "assistant", text: `Feedback: ${feedback}\nScore: ${score}/10` })

      const nextIdx = currentIndex + 1

      if (nextIdx >= questions.length) {
        const finalScore = Math.round(
          questions.reduce((acc, it, i) => acc + (i === currentIndex ? score : (it.score ?? 0)), 0) / questions.length
        )

        try {
          const sumRes = await fetch("/api/summary", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              candidate,
              perQuestion: questions.map((q, i) => ({
                question: q.text,
                difficulty: q.difficulty,
                score: i === currentIndex ? score : (q.score ?? 0),
              })),
              finalScore,
            }),
          })
          let summary = "Interview completed."
          if (sumRes.ok) {
            const j = await sumRes.json().catch(() => null)
            summary = j?.summary || summary
          }
          await finalizeSession(finalScore, summary)
          const completionMessage = `That concludes your interview. Your final score is ${finalScore} out of 10. ${summary}`
          pushMessage({ role: "assistant", text: `Interview Complete!\n\nFinal Score: ${finalScore}/10\n\nSummary: ${summary}` })
          speak(completionMessage)
        } finally {
          isEvaluatingRef.current = false
          setEvaluatingFlag(false)
        }
        return
      }

      speak(feedbackMessage,
        () => setIsSpeaking(true),
        () => {
          setIsSpeaking(false)
          const transitionMsg = "Let's move to the next question."
          speak(transitionMsg,
            () => setIsSpeaking(true),
            () => {
              setIsSpeaking(false)
              setTimeout(() => {
                const difficulty = difficultiesSequence[nextIdx]
                const duration = difficulty === "easy" ? 20 : difficulty === "medium" ? 60 : 120
                startQuestion(duration)
                hasSubmittedRef.current = false
                isEvaluatingRef.current = false
                setEvaluatingFlag(false)
                setTimeout(() => {
                  const nextText = questions[nextIdx]?.text
                  speakQuestionThenListen(nextIdx, nextText)
                }, 1000)
              }, 1000)
            }
          )
        }
      )
    }, [status, questions, currentIndex, transcript, candidate, startedAt, currentAudioBlob, pushMessage, completeQuestion, finalizeSession, stopRecognition, stopAudioRecording, startQuestion, speakQuestionThenListen])

  // Keep latest handleStopAndSend in ref for timer effect without dependency issues
  useEffect(() => {
    submitFnRef.current = handleStopAndSend
  }, [handleStopAndSend])

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* File Upload Section */}
      {status === "idle" && (
        <Card>
          <CardHeader>
            <CardTitle>Upload Your Resume</CardTitle>
            <CardDescription>Upload your resume to begin the AI interview</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center p-8 border-2 border-dashed rounded-lg">
              <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-sm text-muted-foreground mb-4">
                Supported formats: PDF, DOC, DOCX, TXT
              </p>
              <input
                ref={fileInputRef}
                id="resume-upload"
                type="file"
                accept=".pdf,.doc,.docx,.txt"
                aria-label="Upload resume file (PDF, DOC, DOCX, or TXT)"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) { onUpload(f) }
                  if (fileInputRef.current) { fileInputRef.current.value = "" }
                }}
                className="hidden"
              />
              {/* Visually hidden label for accessibility */}
              <label htmlFor="resume-upload" className="sr-only">Upload Resume</label>
              <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} aria-describedby="resume-upload">
                <Upload className="w-4 h-4 mr-2" />
                {uploading ? "Uploading..." : "Upload Resume"}
              </Button>
              {fileError && <p className="text-sm text-destructive mt-2">{fileError}</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Candidate Profile (Collecting or Ready) */}
      {(status === "collecting" || status === "ready") && (
        <Card>
          <CardHeader>
            <CardTitle>Candidate Information</CardTitle>
            <CardDescription>Your extracted details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={editableCandidate.name}
                  onChange={(e) => {
                    setEditableCandidate(prev => ({ ...prev, name: e.target.value }))
                    setCandidate({ ...candidate, name: e.target.value })
                  }}
                  placeholder="Your name"
                />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={editableCandidate.email}
                  onChange={(e) => {
                    setEditableCandidate(prev => ({ ...prev, email: e.target.value }))
                    setCandidate({ ...candidate, email: e.target.value })
                  }}
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={editableCandidate.phone}
                  onChange={(e) => {
                    setEditableCandidate(prev => ({ ...prev, phone: e.target.value }))
                    setCandidate({ ...candidate, phone: e.target.value })
                  }}
                  placeholder="+1 555-555-5555"
                />
              </div>
            </div>

            {status === "collecting" && missingField && (
              <div className="p-4 border rounded-lg bg-muted/30">
                <p className="text-sm font-medium mb-2">
                  <Mic className="inline w-4 h-4 mr-2" />
                  Voice capture active for: <strong>{missingField}</strong>
                </p>
                <p className="text-xs text-muted-foreground">
                  Please speak your {missingField} clearly, or type it above.
                </p>
              </div>
            )}

            {status === "ready" && (
              <div className="flex items-center gap-2">
                <Button onClick={handleStart} disabled={!canStart}>
                  Start Interview
                </Button>
                <Button variant="outline" onClick={resetSession}>
                  Reset
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Interview In Progress */}
      {status === "in_progress" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Question {currentIndex + 1} of 6</CardTitle>
                <CardDescription>
                  <Badge variant={
                    current?.difficulty === "easy" ? "default" :
                      current?.difficulty === "medium" ? "secondary" :
                        "destructive"
                  }>
                    {current?.difficulty?.toUpperCase()}
                  </Badge>
                  <span className="ml-2">
                    {remaining !== null ? `${remaining}s remaining` : ""}
                  </span>
                </CardDescription>
              </div>
              <div className="flex gap-2">
                {recording && (
                  <Badge variant="destructive" className="animate-pulse">
                    <Mic className="w-3 h-3 mr-1" />
                    Recording
                  </Badge>
                )}
                {evaluatingFlag && (
                  <Badge variant="outline" className="animate-pulse">
                    Evaluating...
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Current transcript */}
            {transcript && (
              <div className="p-4 border rounded-lg bg-muted/30">
                <p className="text-sm text-muted-foreground mb-1">Your answer:</p>
                <p>{transcript}</p>
              </div>
            )}

            {/* Manual controls (optional) */}
            <div className="flex items-center gap-2">
              <Button
                onClick={() => handleStopAndSend(false)}
                disabled={hasSubmittedRef.current || isEvaluatingRef.current}
                variant="default"
              >
                Submit Answer Early
              </Button>
              <Button
                variant="secondary"
                onClick={() => handleStopAndSend(true)}
                disabled={hasSubmittedRef.current || isEvaluatingRef.current}
              >
                Skip / No Answer
              </Button>
              {!recording && (
                <span className="text-xs text-muted-foreground">
                  Recording will start automatically after AI speaks
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Interview Complete */}
      {isInterviewDone && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="w-6 h-6 text-green-600" />
              Interview Complete!
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              Congratulations! You've completed the interview. Your responses have been recorded and evaluated.
            </p>
            <div className="flex items-center gap-2">
              <Button onClick={resetSession}>
                Start New Interview
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chat Messages */}
      <Card>
        <CardHeader>
          <CardTitle>Interview Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={cn(
                  "flex gap-3 p-3 rounded-lg",
                  msg.role === "user"
                    ? "bg-primary/10 ml-8"
                    : msg.role === "assistant"
                      ? "bg-muted mr-8"
                      : "bg-accent/50"
                )}
              >
                <div className="flex-shrink-0">
                  {msg.role === "user" ? (
                    <User className="w-5 h-5" />
                  ) : msg.role === "assistant" ? (
                    <Bot className="w-5 h-5" />
                  ) : (
                    <Volume2 className="w-5 h-5" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium mb-1 text-muted-foreground">
                    {msg.role === "user" ? "You" : msg.role === "assistant" ? "AI Interviewer" : "System"}
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}