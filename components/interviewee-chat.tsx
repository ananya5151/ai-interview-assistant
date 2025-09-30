"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { useInterviewStore, difficultiesSequence } from "@/store/interview-store"
import { cn } from "@/lib/utils"
import {
  Bot,
  CheckCircle,
  ChevronRight,
  Circle,
  Download,
  FileText,
  Mic,
  MicOff,
  Square,
  Upload,
  Volume2
} from "lucide-react"

type UIMessage = { role: "system" | "assistant" | "user"; text: string }

type Question = {
  text: string
  difficulty: "easy" | "medium" | "hard"
  answer?: string
  score?: number
  feedback?: string
  answerDurationSec?: number
}

// Browser SpeechRecognition typing shim
declare global {
  interface SpeechRecognition extends EventTarget {
    lang: string
    interimResults: boolean
    continuous: boolean
    start: () => void
    stop: () => void
    onresult: ((ev: SpeechRecognitionEvent) => any) | null
    onerror: ((ev: any) => any) | null
    onend: ((ev: any) => any) | null
  }
  interface SpeechRecognitionEvent extends Event {
    resultIndex: number
    results: SpeechRecognitionResultList
  }
  interface SpeechRecognitionResultList {
    readonly length: number
    [index: number]: SpeechRecognitionResult
  }
  interface SpeechRecognitionResult {
    0: SpeechRecognitionAlternative
    readonly length: number
    readonly isFinal: boolean
  }
  interface SpeechRecognitionAlternative {
    readonly transcript: string
    readonly confidence: number
  }
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition
    webkitSpeechRecognition?: new () => SpeechRecognition
  }
}

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

  utter.onstart = () => {
    onStart?.()
  }

  utter.onend = () => {
    onEnd?.()
  }

  // Improve reliability on some browsers
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
    startQuestion,
    completeQuestion,
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
  const [isSpeaking, setIsSpeaking] = useState(false) // Track if AI is speaking
  const [isRecordingAudio, setIsRecordingAudio] = useState(false)
  const [currentAudioBlob, setCurrentAudioBlob] = useState<Blob | null>(null)

  // New state variables for the updated workflow
  const [isGenerating, setIsGenerating] = useState(false)
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const [userInput, setUserInput] = useState('')
  const [hasResume, setHasResume] = useState(false)
  const [editableCandidate, setEditableCandidate] = useState({ name: "", email: "", phone: "" })
  const [speechRecognition, setSpeechRecognition] = useState<SpeechRecognition | null>(null)
  const [speechSynthesis, setSpeechSynthesis] = useState<SpeechSynthesis | null>(null)
  const [isListening, setIsListening] = useState(false)
  const [currentCaptureField, setCurrentCaptureField] = useState<"name" | "email" | "phone" | null>(null)
  const timerRef = useRef<number | null>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const answerStartedAtRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const current = questions[currentIndex]
  const isInterviewDone = status === "completed"
  const canStart = candidate.name && candidate.email && candidate.phone

  const difficultyLabel = useMemo(() => current?.difficulty?.toUpperCase(), [current])

  // Timer tick derived from startedAt + durationSec
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
      if (rem <= 0) {
        // Auto-submit current transcript on timeout
        handleStopAndSend(true)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, startedAt, durationSec, currentIndex])

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
        setCandidate({
          name: extracted?.name || "",
          email: extracted?.email || "",
          phone: extracted?.phone || "",
          resumeFileName: file.name,
        })

        // Update editable fields and mark resume captured for UI
        setEditableCandidate({
          name: extracted?.name || "",
          email: extracted?.email || "",
          phone: extracted?.phone || "",
        })
        setHasResume(true)

        // Announce extraction in chat and show extracted details inline; no TTS yet.
        const candidateName = extracted?.name || "candidate"
        pushMessage({ role: "system", text: `Resume uploaded. Extracted → Name: ${extracted?.name || "-"}, Email: ${extracted?.email || "-"}, Phone: ${extracted?.phone || "-"}.` })

        if (!extracted?.name || !extracted?.email || !extracted?.phone) {
          setStatus("collecting")
          const missingInfoMessage = "I notice some information is missing from your resume. Please provide your complete name, email, and phone number so we can begin the interview."
          pushMessage({ role: "assistant", text: missingInfoMessage })
        } else {
          setStatus("ready")
          const readyMessage = `Thanks, ${candidateName}. Your details look complete. Press Start Interview when you're ready.`
          pushMessage({ role: "assistant", text: readyMessage })
        }
      } catch (e: any) {
        setFileError("Could not process file. Please try another PDF/DOCX.")
      } finally {
        setUploading(false)
      }
    },
    [pushMessage, setCandidate, setStatus],
  )

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

    // Set all questions in the store at once
    generatedQuestions.forEach((q: any, idx: number) => {
      setQuestion(idx, { text: q.question, difficulty: q.difficulty })
    })

    console.log('All questions set in store')
    return true
  }, [setQuestion])

  const startAudioRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      const audioChunks: BlobPart[] = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data)
        }
      }

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' })
        setCurrentAudioBlob(audioBlob)
        setIsRecordingAudio(false)
        stream.getTracks().forEach(track => track.stop())
      }

      mediaRecorderRef.current = mediaRecorder
      mediaRecorder.start()
      setIsRecordingAudio(true)
      console.log('Audio recording started')
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

  const startRecognition = useCallback(() => {
    // Don't start recognition if AI is speaking
    if (isSpeaking) {
      console.log('Not starting recognition - AI is speaking')
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
    setTranscript("")
    answerStartedAtRef.current = Date.now()
    setRecording(true)

    // Start audio recording alongside speech recognition
    startAudioRecording()
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let txt = ""
      for (let i = e.resultIndex; i < e.results.length; i++) {
        txt += e.results[i][0]?.transcript || ""
      }
      setTranscript((prev) => (prev ? prev + " " + txt : txt))
    }
    rec.onerror = (event: any) => {
      console.error('Speech recognition error:', event)
      setRecording(false)
      if (event.error === 'not-allowed' || event.error === 'permission-denied') {
        pushMessage({
          role: "system",
          text: "Microphone access is required. Please enable it in browser settings.",
        })
        speak("Microphone access is required. Please enable it in browser settings.")
      } else {
        pushMessage({
          role: "system",
          text: "Sorry, I didn't catch that. Please repeat your answer.",
        })
        speak("Sorry, I didn't catch that. Please repeat your answer.")
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
  }, [pushMessage])

  const stopRecognition = useCallback(() => {
    const rec = recognitionRef.current
    if (rec) {
      try {
        rec.stop()
      } catch { }
    }
    setRecording(false)
  }, [])

  const speakCurrentQuestion = useCallback(() => {
    if (current?.text) speak(current.text)
  }, [current?.text])

  const handleStart = useCallback(async () => {
    if (!canStart) return
    const candidateName = candidate.name || "candidate"
    const startMessage = `You'll be asked 6 questions for the Full-Stack role. 2 Easy, 2 Medium, 2 Hard. Easy questions have 20 seconds, Medium have 60, and Hard have 120. When time is up, I will automatically record your answer and move to the next question.`
    pushMessage({ role: "assistant", text: startMessage })
    speak(startMessage)

    // Generate all questions at once at the start
    const success = await generateAllQuestions()
    if (!success) {
      const errorMessage = "I'm having trouble generating questions right now. Please try again in a moment."
      pushMessage({ role: "system", text: errorMessage })
      speak(errorMessage)
      return
    }
    const difficulty = difficultiesSequence[currentIndex]
    const duration = difficulty === "easy" ? 20 : difficulty === "medium" ? 60 : 120
    startQuestion(duration)

    // Add a slight delay before speaking the question to let the intro finish
    setTimeout(() => {
      speakQuestionThenListen()
    }, 1500)
  }, [canStart, candidate.name, currentIndex, generateAllQuestions, pushMessage, speakCurrentQuestion, startQuestion, startRecognition])

  // Voice-based profile capture for missing fields (UI button uses this)
  const startProfileCapture = useCallback(() => {
    if (!currentCaptureField) return
    const rec = createRecognition()
    if (!rec) {
      pushMessage({ role: "system", text: "Speech recognition is not supported in this browser." })
      return
    }
    setIsListening(true)
    setTranscript("")
    rec.continuous = false
    rec.interimResults = false
    rec.lang = 'en-US'
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let txt = ""
      for (let i = e.resultIndex; i < e.results.length; i++) {
        txt += e.results[i][0]?.transcript || ""
      }
      let value = txt.trim()
      if (currentCaptureField === 'email') value = value.replace(/\s+/g, '').toLowerCase()
      if (currentCaptureField === 'phone') value = value.replace(/[^+\d]/g, '')
      setEditableCandidate((prev) => ({ ...prev, [currentCaptureField]: value }))
      setCandidate({
        name: currentCaptureField === 'name' ? value : candidate.name,
        email: currentCaptureField === 'email' ? value : candidate.email,
        phone: currentCaptureField === 'phone' ? value : candidate.phone,
        resumeFileName: candidate.resumeFileName,
      })
      pushMessage({ role: 'user', text: value })

      const nameOk = (currentCaptureField === 'name' ? value : candidate.name)
      const emailOk = (currentCaptureField === 'email' ? value : candidate.email)
      const phoneOk = (currentCaptureField === 'phone' ? value : candidate.phone)
      const nextMissing: "name" | "email" | "phone" | null = !nameOk ? 'name' : !emailOk ? 'email' : !phoneOk ? 'phone' : null
      if (nextMissing) {
        setCurrentCaptureField(nextMissing)
        const prompt = nextMissing === 'name' ? 'Please provide your full name.' : nextMissing === 'email' ? 'Please provide your email address.' : 'Please provide your phone number.'
        pushMessage({ role: 'assistant', text: prompt })
      } else {
        setStatus('ready')
        const readyMsg = 'Thanks. Your profile is complete. You can start the interview when ready.'
        pushMessage({ role: 'assistant', text: readyMsg })
      }
    }
    rec.onerror = () => { setIsListening(false) }
    rec.onend = () => { setIsListening(false) }
    try { rec.start() } catch { setIsListening(false) }
  }, [candidate, currentCaptureField, pushMessage, setCandidate, setStatus])

  const handleStopAndSend = useCallback(
    async (auto = false) => {
      if (status !== "in_progress") return
      // Stop capturing both streams
      stopRecognition()
      stopAudioRecording()

      const q = questions[currentIndex]
      if (!q || !q.text) {
        console.error('No question available at index:', currentIndex)
        pushMessage({ role: "system", text: "Error: No question available. Please try again." })
        return
      }

      const userAnswer = auto ? transcript || "(no answer)" : transcript
      setTranscript("")

      // Add time's up message for auto-submit
      if (auto) {
        pushMessage({ role: "assistant", text: "Time's up. I've saved your answer." })
        speak("Time's up. I've saved your answer.")
      }

      // persist user message
      pushMessage({ role: "user", text: userAnswer })

      // compute time taken since question asked
      const timeTakenSec =
        typeof startedAt === "number" ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : undefined

      // evaluate
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
      let score = 0
      let feedback = "No feedback available."
      if (res.ok) {
        const data = await res.json()
        score = Math.max(0, Math.min(10, Math.round(data.score)))
        feedback = data.feedback || feedback
      }
      completeQuestion(currentIndex, {
        answer: userAnswer,
        answerAudio: currentAudioBlob || undefined,
        score,
        feedback,
        answerDurationSec: timeTakenSec,
      })

      // Clear the current audio blob
      setCurrentAudioBlob(null)

      // assistant feedback message
      const feedbackMessage = `${feedback}. You scored ${score} out of 10 on this question.`
      pushMessage({ role: "assistant", text: `Feedback: ${feedback}\nScore: ${score}/10` })
      speak(feedbackMessage)

      const nextIdx = currentIndex + 1
      if (nextIdx >= questions.length) {
        // finalize
        const finalScore = Math.round(
          questions.reduce((acc: number, it: Question, i: number) => acc + (i === currentIndex ? score : (it.score ?? 0)), 0) / questions.length,
        )
        const sumRes = await fetch("/api/summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidate,
            transcript: messages.concat([{ role: "assistant", text: `Finalized with score ${finalScore}` }]),
            perQuestion: questions.map((q: Question, i: number) => ({
              question: q.text,
              difficulty: q.difficulty,
              score: i === currentIndex ? score : (q.score ?? 0),
            })),
            finalScore,
          }),
        })
        let summary = "Candidate completed the interview."
        if (sumRes.ok) {
          const j = await sumRes.json()
          summary = j.summary || summary
        }
        await finalizeSession(finalScore, summary)
        const completionMessage = `That concludes your interview. Please hold while I calculate your results. Your final score is ${finalScore} out of 10.`
        pushMessage({
          role: "assistant",
          text: `Interview completed. Final Score: ${finalScore}/10\nSummary: ${summary}`,
        })
        speak(completionMessage)
        return
      }

      // prepare next: questions already generated, just start timer
      const nextQuestionExists = questions[nextIdx]?.text
      if (!nextQuestionExists) {
        const errorMessage = "I'm having trouble finding the next question. Let me try again."
        pushMessage({ role: "system", text: errorMessage })
        speak(errorMessage)
        return
      }

      const difficulty = difficultiesSequence[nextIdx]
      const duration = difficulty === "easy" ? 20 : difficulty === "medium" ? 60 : 120

      // Add transition message before next question
      const transitionMessage = `Thank you. Let's move to the next question.`

      speak(transitionMessage,
        () => setIsSpeaking(true),
        () => {
          setIsSpeaking(false)
          // Start the question after transition
          setTimeout(() => {
            startQuestion(duration)
            speakQuestionThenListen() // Question already exists, no need to pass text
          }, 1000)
        }
      )
    },
    [
      status,
      questions,
      currentIndex,
      transcript,
      candidate,
      messages,
      pushMessage,
      completeQuestion,
      finalizeSession,
    ],
  )

  // Enhanced speech function that manages microphone state  
  const speakQuestionThenListen = useCallback((directQuestionText?: string) => {
    const questionText = directQuestionText || questions[currentIndex]?.text

    if (!questionText) {
      console.error('No question text available at currentIndex:', currentIndex)
      return
    }

    // Stop any current recognition IMMEDIATELY
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch { }
    }
    setRecording(false)
    setIsSpeaking(true)

    // Speak the question with proper state management
    speak(questionText,
      () => {
        console.log('Starting to speak question')
        setIsSpeaking(true)
      },
      () => {
        console.log('Finished speaking question, starting to listen in 3 seconds')
        setIsSpeaking(false)
        // Wait exactly 3 seconds as per requirements before starting recording
        // Add beep indication
        setTimeout(() => {
          if (!isSpeaking) {
            console.log('Starting recognition after 3-second beep')
            // TODO: Add actual beep sound here if needed
            startRecognition()
          }
        }, 3000) // Exactly 3 seconds as specified
      }
    )
  }, [questions, currentIndex, startRecognition, isSpeaking])

  // Function to automatically start interview after resume processing
  const startInterviewAutomatically = useCallback(async (candidateName: string) => {
    const startMessage = `You'll be asked 6 questions for the Full-Stack role. 2 Easy, 2 Medium, 2 Hard. Easy questions have 20 seconds, Medium have 60, and Hard have 120. When time is up, I will automatically record your answer and move to the next question.`
    pushMessage({ role: "assistant", text: startMessage })

    // Speak with proper state management
    speak(startMessage,
      () => setIsSpeaking(true), // On start speaking
      async () => { // On finish speaking
        setIsSpeaking(false)

        // Generate all questions at once
        const success = await generateAllQuestions()
        console.log('generateAllQuestions result:', success)

        if (success) {
          const difficulty = difficultiesSequence[0]
          const duration = difficulty === "easy" ? 20 : difficulty === "medium" ? 60 : 120
          startQuestion(duration)
          setStatus("in_progress")

          // Speak the first question using existing question data
          setTimeout(() => {
            console.log('About to speak first question')
            speakQuestionThenListen()
          }, 1000) // Shorter delay since questions are pre-generated
        } else {
          console.error('Failed to generate questions')
        }
      }
    )
  }, [generateAllQuestions, pushMessage, setIsSpeaking, setStatus, speakQuestionThenListen, startQuestion])

  const disabledStart = !hasResume || !canStart || status === "in_progress" || status === "completed"
  const showCollector = status === "collecting" || (!canStart && status !== "completed")

  // Persist edits to candidate profile
  const handleCandidateChange = useCallback((field: "name" | "email" | "phone", value: string) => {
    setEditableCandidate((prev) => ({ ...prev, [field]: value }))
  }, [])

  const handleSaveProfile = useCallback(() => {
    setCandidate({
      name: editableCandidate.name.trim(),
      email: editableCandidate.email.trim(),
      phone: editableCandidate.phone.trim(),
      resumeFileName: candidate.resumeFileName,
    })
    const complete = !!(editableCandidate.name && editableCandidate.email && editableCandidate.phone)
    if (complete) {
      setStatus("ready")
      speak("Profile saved. You can start the interview when ready.")
    } else {
      setStatus("collecting")
      speak("Please complete your name, email, and phone number to continue.")
    }
  }, [candidate.resumeFileName, editableCandidate, setCandidate, setStatus])

  // New functions for the updated workflow
  const handleResumeUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setIsGenerating(true)
    setHasResume(true)

    try {
      // Extract text from resume (simplified)
      const formData = new FormData()
      formData.append('file', file)

      const extractResponse = await fetch('/api/extract', {
        method: 'POST',
        body: formData
      })

      if (extractResponse.ok) {
        const { text } = await extractResponse.json()

        // Generate questions based on resume
        const generateResponse = await fetch('/api/generate-questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resumeText: text })
        })

        if (generateResponse.ok) {
          const data = await generateResponse.json()
          if (data.questions && Array.isArray(data.questions)) {
            // Set questions individually using the store function
            data.questions.forEach((q: any, index: number) => {
              setQuestion(index, {
                text: q.text,
                difficulty: q.difficulty || 'medium'
              })
            })
          }
        }
      }
    } catch (error) {
      console.error('Error processing resume:', error)
    } finally {
      setIsGenerating(false)
    }
  }, [setQuestion])

  const completeCurrentQuestion = useCallback(() => {
    const currentQ = questions?.[currentQuestion]
    if (currentQ && !currentQ.answer) {
      completeQuestion(currentQuestion, {
        answer: userInput,
        answerAudio: currentAudioBlob || undefined
      })
      setUserInput('')
      setCurrentAudioBlob(null)
    }
  }, [currentQuestion, questions, userInput, currentAudioBlob, completeQuestion])

  const saveTranscript = useCallback(async () => {
    const transcript = (questions || [])
      .filter(q => q.answer)
      .map(q => `Q: ${q.text}\nA: ${q.answer}`)
      .join('\n\n')

    const blob = new Blob([transcript], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'interview-transcript.txt'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [questions])

  useEffect(() => {
    const initializeSpeech = () => {
      if ('speechSynthesis' in window) {
        setSpeechSynthesis(window.speechSynthesis)
      }

      if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        const recognition = new SpeechRecognition()
        recognition.continuous = false
        recognition.interimResults = false
        recognition.lang = 'en-US'

        recognition.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript
          setUserInput(prev => prev + ' ' + transcript)
          setIsListening(false)
        }

        recognition.onerror = () => {
          setIsListening(false)
        }

        recognition.onend = () => {
          setIsListening(false)
        }

        setSpeechRecognition(recognition)
      }
    }

    initializeSpeech()
  }, [])

  const startListening = useCallback(() => {
    if (speechRecognition && !isListening) {
      speechRecognition.start()
      setIsListening(true)
    }
  }, [speechRecognition, isListening])

  const stopListening = useCallback(() => {
    if (speechRecognition && isListening) {
      speechRecognition.stop()
      setIsListening(false)
    }
  }, [speechRecognition, isListening])

  const speakText = useCallback((text: string) => {
    if (speechSynthesis) {
      speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = 0.8
      utterance.pitch = 1
      speechSynthesis.speak(utterance)
    }
  }, [speechSynthesis])

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-2xl font-bold">AI Interview Assistant</CardTitle>
            <CardDescription>Practice your interview skills with AI-powered conversations</CardDescription>
          </div>
          <div className="flex items-center gap-4">
            <Badge variant={isGenerating ? "secondary" : "default"}>
              {isGenerating ? "Generating..." : `Question ${currentQuestion + 1} of ${questions?.length || 0}`}
            </Badge>
            <Button
              onClick={saveTranscript}
              variant="outline"
              size="sm"
              disabled={!questions?.some(q => q.answer)}
            >
              <Download className="w-4 h-4 mr-2" />
              Save Transcript
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {!hasResume && !isGenerating && (
            <div className="text-center p-8 border-2 border-dashed border-gray-300 rounded-lg">
              <FileText className="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Upload your resume to start</h3>
              <p className="text-gray-500 mb-4">Upload your resume to generate personalized interview questions</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.txt"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onUpload(f)
                  // Reset value so selecting the same file again retriggers onChange
                  if (fileInputRef.current) fileInputRef.current.value = ""
                }}
                className="hidden"
                aria-label="Upload resume file"
              />
              <Button type="button" className="cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                <Upload className="w-4 h-4 mr-2" />
                Upload Resume
              </Button>
            </div>
          )}

          {/* Candidate Details (visible after resume upload or when collecting) */}
          {(hasResume || showCollector) && (
            <div className="grid md:grid-cols-3 gap-4 p-4 border rounded-lg">
              <div>
                <Label htmlFor="cand-name">Full Name</Label>
                <Input id="cand-name" value={editableCandidate.name} onChange={(e) => handleCandidateChange("name", e.target.value)} placeholder="Your name" />
              </div>
              <div>
                <Label htmlFor="cand-email">Email</Label>
                <Input id="cand-email" type="email" value={editableCandidate.email} onChange={(e) => handleCandidateChange("email", e.target.value)} placeholder="you@example.com" />
              </div>
              <div>
                <Label htmlFor="cand-phone">Phone</Label>
                <Input id="cand-phone" value={editableCandidate.phone} onChange={(e) => handleCandidateChange("phone", e.target.value)} placeholder="+1 555-555-5555" />
              </div>
              <div className="md:col-span-3 flex items-center gap-2">
                <Button type="button" onClick={handleSaveProfile} disabled={uploading}>Save Details</Button>
                {candidate.resumeFileName && (
                  <Badge variant="secondary">{candidate.resumeFileName}</Badge>
                )}
              </div>
            </div>
          )}

          {/* Start & Reset controls */}
          {status !== "in_progress" && status !== "completed" && (
            <div className="flex items-center gap-2">
              <Button onClick={handleStart} disabled={disabledStart || uploading}>
                Start Interview
              </Button>
              <Button variant="outline" onClick={() => resetSession()} disabled={status as any === "in_progress"}>
                Reset
              </Button>
              {showCollector && (
                <span className="text-sm text-muted-foreground">Please provide missing profile info first.</span>
              )}
            </div>
          )}

          {/* Voice capture prompt when collecting profile details */}
          {status === 'collecting' && currentCaptureField && (
            <div className="flex items-center gap-3 p-4 border rounded-md bg-muted/30">
              <span>
                {currentCaptureField === 'name' && 'Please say your full name.'}
                {currentCaptureField === 'email' && 'Please say your email address.'}
                {currentCaptureField === 'phone' && 'Please say your phone number.'}
              </span>
              <Button type="button" onClick={startProfileCapture} variant={isListening ? 'secondary' : 'default'}>
                {isListening ? 'Listening… Click to retry' : 'Speak'}
              </Button>
            </div>
          )}

          {isGenerating && (
            <div className="text-center p-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Generating interview questions based on your resume...</p>
            </div>
          )}

          {questions && questions.length > 0 && status !== "completed" && (
            <>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                <div className="flex items-start gap-4">
                  <div className="bg-blue-600 text-white rounded-full w-8 h-8 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-blue-900 mb-2">Interview Question</h3>
                    <p className="text-blue-800">{questions[currentIndex]?.text}</p>
                    <Button
                      onClick={speakCurrentQuestion}
                      variant="ghost"
                      size="sm"
                      className="mt-2 text-blue-600 hover:text-blue-800"
                    >
                      <Volume2 className="w-4 h-4 mr-2" />
                      Read Question
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <Textarea
                  placeholder="Type your answer here or use voice input..."
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  className="min-h-[120px]"
                  disabled={!!questions[currentIndex]?.answer}
                />

                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    onClick={recording ? stopRecognition : startRecognition}
                    variant={recording ? "destructive" : "outline"}
                    size="sm"
                    disabled={!!questions[currentIndex]?.answer}
                  >
                    {recording ? <MicOff className="w-4 h-4 mr-2" /> : <Mic className="w-4 h-4 mr-2" />}
                    {recording ? 'Stop Voice Input' : 'Voice Input'}
                  </Button>

                  {currentAudioBlob && (
                    <Badge variant="secondary" className="text-xs">
                      Audio recorded ({Math.round(currentAudioBlob!.size / 1024)}KB)
                    </Badge>
                  )}

                  <Button
                    onClick={() => { setTranscript(userInput); handleStopAndSend(false); setUserInput("") }}
                    disabled={!userInput.trim() || !!questions[currentIndex]?.answer}
                    className="ml-auto"
                  >
                    Submit Answer
                  </Button>
                </div>
              </div>

              {questions[currentIndex]?.answer && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h4 className="font-medium text-green-900 mb-2">Your Answer:</h4>
                  <p className="text-green-800">{questions[currentIndex]?.answer}</p>
                  {questions[currentIndex]?.answerAudio && (
                    <div className="mt-2">
                      <audio controls className="w-full">
                        <source src={URL.createObjectURL(questions[currentIndex]!.answerAudio!)} type="audio/webm" />
                      </audio>
                    </div>
                  )}
                </div>
              )}

              {isInterviewDone && (
                <div className="text-center p-6 bg-gray-50 rounded-lg">
                  <CheckCircle className="mx-auto h-12 w-12 text-green-600 mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Interview Complete!</h3>
                  <p className="text-gray-600 mb-4">Great job! You've answered all the questions.</p>
                  <Button onClick={saveTranscript}>
                    <Download className="w-4 h-4 mr-2" />
                    Download Transcript
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}