// src/app/teacher/page.tsx
'use client'
export const dynamic = 'force-dynamic';

import React, { useEffect, useMemo, useState, useRef } from 'react'
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  Timestamp,
  onSnapshot,
  where,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'

type QuestionType =
  | 'task'
  | 'writing'
  | 'error'
  | 'review'
  | 'algo'
  | 'free'
  | 'basic'
  | 'unknown'

type ChatLog = {
  id: string
  userMessage: string
  assistantMessage: string
  resolved: boolean
  seatNumber: string | null
  problemTitle: string
  problemId: string
  userId: string | null
  userEmail: string | null
  createdAt: Timestamp | null
  durationSec?: number
  userMode?: 'normal' | 'grading'
  answerMode?: 'normal' | 'grading'
  questionType?: QuestionType
  classId?: string | null
}

type Submission = {
  id: string
  mode: string
  problemId: string
  problemTitle: string
  userId: string | null
  userEmail: string | null
  seatNumber: string | null
  submittedAt: Timestamp | null
  durationSec?: number
  files: { name: string; size: number; downloadURL?: string }[]
  inputMode?: 'files' | 'paste'
  gradingResult?: string
  classId?: string | null
}

type StudentSeat = {
  id: string
  seatNumber: string
  currentProblemId?: string | null
  currentProblemTitle?: string | null
  timerStartedAt?: Timestamp | null
  startedAt?: Timestamp | null
  taRequested?: boolean
  taRequestedAt?: Timestamp | null
  timerBaseSec?: number
  timerResumedAt?: Timestamp | null
  timerRunning?: boolean
  updatedAt?: Timestamp | null
  classId?: string | null
}

const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  task: '課題の読み解き・進め方',
  writing: '書き方の相談',
  error: 'エラー・例外の相談',
  review: 'コードレビュー・バグの相談',
  algo: 'アルゴリズム・理論の相談',
  free: '自由記述の相談',
  basic: '初歩的な質問',
  unknown: '（種類未入力）',
}

// ★ 固定のクラスリスト
const ALLOWED_CLASSES = [
  'ABクラス',
  'CDクラス',
  'EFクラス',
  'JKL1クラス',
  'JKL2クラス',
]

const normalizeQuestionType = (raw: any): QuestionType => {
  const v = (raw ?? '').toString().trim().toLowerCase()
  if (!v) return 'unknown'

  if (
    v === 'task' ||
    v === 'assignment' ||
    v === 'homework' ||
    v === 'problem' ||
    v === 'reading' ||
    v === 'read' ||
    v === 'progress' ||
    v === 'advance' ||
    v === 'plan' ||
    v === 'understand' ||
    v === 'interpretation' ||
    v === 'workflow'
  ) {
    return 'task'
  }

  if (
    v === 'writing' ||
    v === 'syntax' ||
    v === 'howto' ||
    v === 'how_to' ||
    v === 'format' ||
    v === 'style'
  ) {
    return 'writing'
  }

  if (v === 'error' || v === 'exception' || v === 'runtime' || v === 'bug') {
    return 'error'
  }

  if (
    v === 'review' ||
    v === 'code_review' ||
    v === 'refactor' ||
    v === 'debug' ||
    v === 'logic'
  ) {
    return 'review'
  }

  if (
    v === 'algo' ||
    v === 'algorithm' ||
    v === 'theory' ||
    v === 'complexity' ||
    v === 'math'
  ) {
    return 'algo'
  }

  if (v === 'free' || v === 'other' || v === 'misc') {
    return 'free'
  }

  if (
    v === 'basic' ||
    v === 'beginner' ||
    v === 'elementary' ||
    v === 'introductory' ||
    v === 'fundamental'
  ) {
    return 'basic'
  }

  return 'unknown'
}

const getStartOfTodayLocal = (): Date => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

const dateMsFromYMDLocalNoon = (ymd: string): number | null => {
  if (!ymd) return null
  const [y, m, d] = ymd.split('-').map((v) => Number(v))
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d, 12, 0, 0, 0).getTime()
}

const getTodayYMDLocal = (): string => {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const formatDateTime = (ts: Timestamp | null | undefined) => {
  if (!ts) return ''
  const d = ts.toDate()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}/${m}/${day} ${hh}:${mm}`
}

const secondsToMin = (sec?: number) => {
  if (!sec || sec <= 0) return '-'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}分${s}秒`
}

const isSameDay = (ts: Timestamp | null | undefined, nowMs: number) => {
  if (!ts) return false
  const d1 = ts.toDate()
  const d2 = new Date(nowMs)
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  )
}

const diffMinutesFromNow = (
  startedAt: Timestamp | null | undefined,
  nowMs: number
) => {
  if (!startedAt) return null
  const startMs = startedAt.toDate().getTime()
  const diff = nowMs - startMs
  if (diff <= 0) return 0
  return Math.floor(diff / 60000)
}

const seatBgClassByMinutes = (minutes: number | null): string => {
  if (minutes == null) return 'bg-white dark:bg-gray-950'
  if (minutes < 20) return 'bg-white dark:bg-gray-950'
  if (minutes < 30) return 'bg-amber-100 dark:bg-amber-900/30'
  return 'bg-red-200 dark:bg-red-900/30'
}

const getDayRangeTimestamps = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  const start = new Date(y, m - 1, d, 0, 0, 0, 0)
  const end = new Date(y, m - 1, d, 23, 59, 59, 999)
  return {
    start: Timestamp.fromDate(start),
    end: Timestamp.fromDate(end)
  }
}

const seatBlocks = [
  {
    id: 'left',
    cols: ['A', 'B', 'C'],
    rows: ['02', '03', '04', '05', '06', '07'],
  },
  {
    id: 'midLeft',
    cols: ['D', 'E', 'F'],
    rows: ['01', '02', '03', '04', '05', '06', '07'],
  },
  {
    id: 'midCenter',
    cols: ['G', 'H', 'I'],
    rows: ['01', '02', '03', '04', '05', '06', '07'],
  },
  {
    id: 'midRight',
    cols: ['J', 'K', 'L'],
    rows: ['01', '02', '03', '04', '05', '06', '07'],
  },
  {
    id: 'farRight',
    cols: ['M', 'N', 'O'],
    rows: ['02', '03', '04', '05', '06', '07'],
  },
]

type UnifiedEntry =
  | ({ kind: 'chat' } & ChatLog)
  | ({ kind: 'grading'; createdAt: Timestamp | null } & Submission)

export default function TeacherPage() {
  const [problemFilter, setProblemFilter] = useState<string>('all')
  const [questionTypeFilter, setQuestionTypeFilter] = useState<QuestionType | 'all'>('all')
  const [resolvedFilter, setResolvedFilter] = useState<'all' | 'resolved' | 'unresolved'>('all')
  const [limitCount, setLimitCount] = useState<number>(100)

  const [assignedClass, setAssignedClass] = useState<string>('')
  const [logClassFilters, setLogClassFilters] = useState<string[]>([])

  const [logDateYMD, setLogDateYMD] = useState<string>(getTodayYMDLocal())
  const [debugSeatId, setDebugSeatId] = useState<string | null>(null)
  const [selectedSeatForHistory, setSelectedSeatForHistory] = useState<string | null>(null)
  const [seatRotated, setSeatRotated] = useState(false)
  const [problemOptions, setProblemOptions] = useState<{ id: string; title: string }[]>([])

  const [chatLogs, setChatLogs] = useState<ChatLog[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [subLoading, setSubLoading] = useState(false)
  const [students, setStudents] = useState<StudentSeat[]>([])
  const [studentsLoading, setStudentsLoading] = useState(false)

  const [nowMs, setNowMs] = useState<number>(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const seatOuterRef = useRef<HTMLDivElement | null>(null)
  const seatInnerRef = useRef<HTMLDivElement | null>(null)
  const [seatScale, setSeatScale] = useState(1)

  const selectedDayMs = useMemo(() => {
    const ms = dateMsFromYMDLocalNoon(logDateYMD)
    return ms ?? nowMs
  }, [logDateYMD, nowMs])

  const seatToClassMap = useMemo(() => {
    const m = new Map<string, string>()
    students.forEach((s) => {
      const cId = s.classId || (s as any).class
      if (s.seatNumber && cId) {
        m.set(s.seatNumber.toUpperCase(), cId)
      }
    })
    return m
  }, [students])

  useEffect(() => {
    const fetchProblems = async () => {
      try {
        const q = query(
          collection(db, 'problem'),
          where('visibleInChat', '==', true) 
        )
        
        const snap = await getDocs(q)
        const list = snap.docs.map((doc) => {
          const d = doc.data()
          return {
            id: doc.id,
            title: d.title || '(タイトルなし)',
          }
        })
        
        // タイトル順などで並び替えると使いやすくなります
        list.sort((a, b) => a.title.localeCompare(b.title))
        
        setProblemOptions(list)
      } catch (e) {
        console.error('[teacher] fetchProblems failed:', e)
      }
    }
    fetchProblems()
  }, [])

  useEffect(() => {
    setChatLoading(true)
    const { start, end } = getDayRangeTimestamps(logDateYMD)

    // クエリ自体で日付を絞り込む（limitは削除）
    const qBase = query(
      collection(db, 'chatLogs'),
      where('createdAt', '>=', start),
      where('createdAt', '<=', end),
      orderBy('createdAt', 'desc')
    )

    const unsub = onSnapshot(
      qBase,
      (snap) => {
        const list: ChatLog[] = []
        snap.forEach((docSnap) => {
          const d = docSnap.data() as any
          list.push({
            id: docSnap.id,
            userMessage: d.userMessage ?? '',
            assistantMessage: d.assistantMessage ?? '',
            resolved: !!d.resolved,
            seatNumber: d.seatNumber ?? null,
            problemTitle: d.problemTitle ?? '',
            problemId: d.problemId ?? '',
            userId: d.userId ?? null,
            userEmail: d.userEmail ?? null,
            createdAt: d.createdAt ?? null,
            durationSec: d.durationSec,
            userMode: d.userMode,
            answerMode: d.answerMode,
            questionType: normalizeQuestionType(d.questionType),
            classId: d.classId ?? null,
          })
        })
        setChatLogs(list)
        setChatLoading(false)
      },
      (error) => {
        console.error('[teacher] onSnapshot chatLogs failed:', error)
        setChatLoading(false)
      }
    )

    return () => unsub()
  }, [logDateYMD]) // 依存配列から limitCount を除外し、日付変更をトリガーにする

  useEffect(() => {
    setSubLoading(true)
    const { start, end } = getDayRangeTimestamps(logDateYMD)

    const qBase = query(
      collection(db, 'submissions'),
      where('submittedAt', '>=', start),
      where('submittedAt', '<=', end),
      orderBy('submittedAt', 'desc')
    )

    const unsub = onSnapshot(
      qBase,
      (snap) => {
        const list: Submission[] = []
        snap.forEach((docSnap) => {
          const d = docSnap.data() as any
          list.push({
            id: docSnap.id,
            mode: d.mode ?? '',
            problemId: d.problemId ?? '',
            problemTitle: d.problemTitle ?? '',
            userId: d.userId ?? null,
            userEmail: d.userEmail ?? null,
            seatNumber: d.seatNumber ?? null,
            submittedAt: d.submittedAt ?? null,
            durationSec: d.durationSec,
            files: Array.isArray(d.files) ? d.files : [],
            inputMode: d.inputMode,
            gradingResult: d.gradingResult ?? '',
            classId: d.classId ?? null,
          })
        })
        setSubmissions(list)
        setSubLoading(false)
      },
      (error) => {
        console.error('[teacher] onSnapshot submissions failed:', error)
        setSubLoading(false)
      }
    )

    return () => unsub()
  }, [logDateYMD])

  useEffect(() => {
    setStudentsLoading(true)
    const unsub = onSnapshot(
      collection(db, 'students'),
      (snap) => {
        const todayStart = getStartOfTodayLocal()

        const list: StudentSeat[] = []
        snap.forEach((docSnap) => {
          const d = docSnap.data() as any
          if (!d.seatNumber) return

          const updatedAt: Timestamp | null = d.updatedAt ?? null
          if (!updatedAt || updatedAt.toDate() < todayStart) {
            return
          }

          list.push({
            id: docSnap.id,
            seatNumber: (d.seatNumber as string).toUpperCase(),
            currentProblemId: d.currentProblemId ?? null,
            currentProblemTitle: d.currentProblemTitle ?? null,
            timerStartedAt: d.timerStartedAt ?? d.startedAt ?? null,
            startedAt: d.startedAt ?? null,
            taRequested: !!d.taRequested,
            taRequestedAt: d.taRequestedAt ?? null,
            timerBaseSec: typeof d.timerBaseSec === 'number' ? d.timerBaseSec : 0,
            timerResumedAt: d.timerResumedAt ?? null,
            timerRunning: !!d.timerRunning,
            updatedAt,
            classId: d.classId ?? d.class ?? null,
          })
        })
        setStudents(list)
        setStudentsLoading(false)
      },
      (error) => {
        console.error('[teacher] onSnapshot students failed:', error)
        setStudentsLoading(false)
      }
    )

    return () => unsub()
  }, [])

  useEffect(() => {
    const outer = seatOuterRef.current
    const inner = seatInnerRef.current
    if (!outer || !inner) return

    const updateScale = () => {
      if (!seatOuterRef.current || !seatInnerRef.current) return
      const outerWidth = seatOuterRef.current.clientWidth
      if (outerWidth <= 0) {
        setSeatScale(1)
        return
      }
      seatInnerRef.current.style.transform = 'scale(1)'
      const innerWidth = seatInnerRef.current.scrollWidth
      if (innerWidth <= 0) {
        setSeatScale(1)
        return
      }
      const ratio = outerWidth / innerWidth
      const nextScale = ratio < 1 ? ratio : 1
      setSeatScale(nextScale)
    }

    updateScale()

    const ro = new ResizeObserver(() => {
      updateScale()
    })
    ro.observe(outer)

    return () => {
      ro.disconnect()
    }
  }, [students.length, problemFilter, assignedClass])

  useEffect(() => {
    if (assignedClass) {
      setLogClassFilters([assignedClass])
    } else {
      setLogClassFilters([])
    }
  }, [assignedClass])

  const studentSeatMap = useMemo(() => {
    const m = new Map<string, StudentSeat>()
    if (!assignedClass) return m

    students.forEach((s) => {
      if (!s.seatNumber) return
      const cId = s.classId || (s as any).class
      if (cId !== assignedClass) return
      m.set(s.seatNumber.toUpperCase(), s)
    })
    return m
  }, [students, assignedClass])

  const filteredChatLogs = useMemo(() => {
    return chatLogs.filter((log) => {
      if (!assignedClass) return false
      if (logClassFilters.length === 0) return false

      // クエリですでに日付は絞られているので、日付判定は不要（削除済み）
      if (problemFilter !== 'all' && log.problemId !== problemFilter) return false
      
      // クラスIDの取得（データにある classId 優先、なければ座席からの逆引き）
      const logClassId = log.classId || (log.seatNumber ? seatToClassMap.get(log.seatNumber.toUpperCase()) : null)
      
      // --- 【修正ここから】 ---
      // 「全クラス表示」がONなら全件出す
      if (logClassFilters.includes('all')) {
        // 全表示
      } else {
        // 保存されたclassId、または逆引きしたIDが選択中のフィルタに含まれているか
        if (!logClassId || !logClassFilters.includes(logClassId)) {
          return false;
        }
      }

      // ... (質問タイプ、解決状況、座席フィルタはそのまま維持)
      const qt = normalizeQuestionType(log.questionType)
      if (questionTypeFilter !== 'all' && qt !== questionTypeFilter) return false
      if (resolvedFilter === 'resolved' && !log.resolved) return false
      if (resolvedFilter === 'unresolved' && log.resolved) return false
      if (selectedSeatForHistory) {
        const seat = (log.seatNumber ?? '').toUpperCase()
        if (seat !== selectedSeatForHistory) return false
      }
      return true
    })
  }, [chatLogs, problemFilter, questionTypeFilter, resolvedFilter, selectedDayMs, selectedSeatForHistory, logClassFilters, seatToClassMap, assignedClass])

  const filteredSubmissions = useMemo(() => {
    return submissions.filter((s) => {
      if (!assignedClass) return false
      if (problemFilter !== 'all' && s.problemId !== problemFilter) return false
      const subClassId = s.classId || (s.seatNumber ? seatToClassMap.get(s.seatNumber.toUpperCase()) : null)
      if (!logClassFilters.includes('all')) {
        if (!subClassId || !logClassFilters.includes(subClassId)) {
          return false
        }
      }

      if (selectedSeatForHistory) {
        const seat = (s.seatNumber ?? '').toUpperCase()
        if (seat !== selectedSeatForHistory) return false
      }
      return true
    })
  }, [submissions, problemFilter, selectedDayMs, selectedSeatForHistory, logClassFilters, seatToClassMap, assignedClass])

  const unifiedEntries: UnifiedEntry[] = useMemo(() => {
    const chats: UnifiedEntry[] = filteredChatLogs.map((c) => ({
      kind: 'chat',
      ...c,
    }))
    const grads: UnifiedEntry[] = filteredSubmissions.map((s) => ({
      kind: 'grading',
      ...s,
      createdAt: s.submittedAt ?? null,
    }))

    const all = [...chats, ...grads]
    all.sort((a, b) => {
      const ta = a.createdAt?.toDate().getTime() ?? 0
      const tb = b.createdAt?.toDate().getTime() ?? 0
      return tb - ta
    })
    return all
  }, [filteredChatLogs, filteredSubmissions])

  const seatLatestAnyProblemMap = useMemo(() => {
    const m = new Map<string, { problemId: string; title: string; createdAt: Timestamp | null; durationSec?: number }>()
    if (!assignedClass) return m

    chatLogs.forEach((log) => {
      if (!log.seatNumber || !log.problemId) return
      if (!isSameDay(log.createdAt, nowMs)) return
      
      const logClassId = log.classId || seatToClassMap.get(log.seatNumber.toUpperCase())
      if (logClassId !== assignedClass) return

      const key = log.seatNumber.toUpperCase()
      if (!m.has(key)) {
        m.set(key, {
          problemId: log.problemId,
          title: log.problemTitle ?? '',
          createdAt: log.createdAt ?? null,
          durationSec: typeof log.durationSec === 'number' ? log.durationSec : undefined,
        })
      }
    })

    return m
  }, [chatLogs, nowMs, assignedClass, seatToClassMap])

  const seatProblemLatestMap = useMemo(() => {
    const m = new Map<string, { problemId: string; title: string; createdAt: Timestamp | null; durationSec?: number }>()
    if (!assignedClass) return m

    chatLogs.forEach((log) => {
      if (!log.seatNumber || !log.problemId) return
      if (!isSameDay(log.createdAt, nowMs)) return

      const logClassId = log.classId || seatToClassMap.get(log.seatNumber.toUpperCase())
      if (logClassId !== assignedClass) return

      const seatId = log.seatNumber.toUpperCase()
      const key = `${seatId}__${log.problemId}`
      if (!m.has(key)) {
        m.set(key, {
          problemId: log.problemId,
          title: log.problemTitle ?? '',
          createdAt: log.createdAt ?? null,
          durationSec: typeof log.durationSec === 'number' ? log.durationSec : undefined,
        })
      }
    })

    return m
  }, [chatLogs, nowMs, assignedClass, seatToClassMap])

  const anyLoading = chatLoading || subLoading

  return (
    <main className="h-screen flex flex-col bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <header className="border-b px-4 py-2 flex items-center justify-between bg-white dark:bg-gray-950 border-gray-200 dark:border-gray-800">
        <h1 className="font-bold text-lg text-gray-900 dark:text-gray-100">
          教員・TA向け 可視化画面
        </h1>
        <div className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-2">
          <span>
            表示上限:
            <select
              className="ml-1 border rounded px-1 py-0.5 text-xs bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100"
              value={limitCount}
              onChange={(e) => setLimitCount(Number(e.target.value) || 100)}
            >
              <option value={50}>50件</option>
              <option value={100}>100件</option>
              <option value={300}>300件</option>
            </select>
          </span>
          <button
            className="text-xs border rounded px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-900 bg-white dark:bg-gray-950 border-gray-200 dark:border-gray-800"
            onClick={() => {
              setNowMs(Date.now())
              ;(async () => {
                try {
                  const q = query(
                    collection(db, 'problem'),
                    where('visibleInChat', '==', true)
                  )
                  const snap = await getDocs(q)
                  const list = snap.docs.map((doc) => ({
                    id: doc.id,
                    title: doc.data().title || '(タイトルなし)',
                  }))
                  list.sort((a, b) => a.title.localeCompare(b.title))
                  setProblemOptions(list)
                } catch (e) {
                  console.error('[teacher] reload fetchProblems failed:', e)
                }
              })()
            }}
          >
            再読み込み
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 border-r p-3 text-xs bg-gray-50 dark:bg-gray-900 space-y-3 overflow-y-auto border-gray-200 dark:border-gray-800">
          
          <div className="p-2 -mx-2 bg-blue-50 dark:bg-blue-900/30 border-y border-blue-200 dark:border-blue-800 mb-2">
            <div className="font-bold text-blue-900 dark:text-blue-200 mb-1 text-[11px]">
              👨‍🏫 担当クラス (座席ビュー固定)
            </div>
            <select
              className="w-full border rounded px-2 py-1 bg-white dark:bg-gray-950 border-blue-300 dark:border-blue-700 text-blue-900 dark:text-blue-100 font-semibold"
              value={assignedClass}
              onChange={(e) => setAssignedClass(e.target.value)}
            >
              <option value="" disabled>最初に選択してください</option>
              {ALLOWED_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <div className="text-[9px] text-blue-700 dark:text-blue-300 mt-1">
              ※選択したクラスの学生のみが座席に表示されます。
            </div>
          </div>

          <div>
            <div className="font-semibold mb-1 text-gray-700 dark:text-gray-200">
              日付フィルタ（ログ一覧）
            </div>

            <input
              type="date"
              className="
                w-full border rounded px-2 py-1
                bg-white dark:bg-gray-950
                border-gray-200 dark:border-gray-800
                text-gray-900 dark:text-gray-100
                dark:[color-scheme:dark]
              "
              value={logDateYMD}
              onChange={(e) => setLogDateYMD(e.target.value)}
            />

            <div className="mt-1 flex gap-1">
              <button
                className="border rounded px-2 py-0.5 text-[10px]
                          bg-white dark:bg-gray-950
                          hover:bg-gray-50 dark:hover:bg-gray-900
                          border-gray-200 dark:border-gray-800"
                onClick={() => setLogDateYMD(getTodayYMDLocal())}
              >
                今日へ戻す
              </button>
            </div>

            <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
              ※座席ビューは本日固定です。ここで切り替わるのは下のログ一覧だけです。
            </div>
          </div>

          <div>
            <div className="font-semibold mb-1 text-gray-700 dark:text-gray-200">
              問題フィルタ
            </div>
            <select
              className="w-full border rounded px-2 py-1 bg-white dark:bg-gray-950 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100"
              value={problemFilter}
              onChange={(e) => setProblemFilter(e.target.value)}
            >
              <option value="all">すべての問題</option>
              {problemOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="font-semibold mb-1 text-gray-700 dark:text-gray-200">
              質問タイプ
            </div>
            <select
              className="w-full border rounded px-2 py-1 bg-white dark:bg-gray-950 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100"
              value={questionTypeFilter}
              onChange={(e) => setQuestionTypeFilter(e.target.value as any)}
            >
              <option value="all">すべて</option>
              <option value="task">課題の読み解き・進め方</option>
              <option value="writing">書き方の相談</option>
              <option value="error">エラー・例外の相談</option>
              <option value="review">コードレビュー・バグの相談</option>
              <option value="algo">アルゴリズム・理論の相談</option>
              <option value="free">自由記述の相談</option>
              <option value="basic">初歩的な質問</option>
              <option value="unknown">（種類未入力）</option>
            </select>
          </div>

          <div>
            <div className="font-semibold mb-1 text-gray-700 dark:text-gray-200">
              解決状況
            </div>
            <select
              className="w-full border rounded px-2 py-1 bg-white dark:bg-gray-950 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100"
              value={resolvedFilter}
              onChange={(e) => setResolvedFilter(e.target.value as any)}
            >
              <option value="all">すべて</option>
              <option value="resolved">解決済み</option>
              <option value="unresolved">未解決</option>
            </select>
          </div>

          <div className="text-[10px] text-gray-500 dark:text-gray-400">
            ※質問タイプ/解決状況フィルタはチャットログのみ対象です。採点提出は問題フィルタのみ適用されます。
          </div>
        </aside>

        <section className="flex-1 overflow-y-auto p-4 space-y-4 bg-white dark:bg-gray-950">
          <section className="border rounded bg-white dark:bg-gray-950 p-3 text-xs space-y-2 border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                座席ビュー（本日固定）
              </h2>

              <div className="flex items-center gap-3">
                <button
                  className="text-xs border rounded px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-900
                              bg-white dark:bg-gray-950 border-gray-200 dark:border-gray-800"
                  onClick={() => setSeatRotated((v) => !v)}
                >
                  {seatRotated ? '通常表示に戻す' : '教卓側表示（180°回転）'}
                </button>

                <div className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-3">
                  {studentsLoading ? <span>読み込み中...</span> : null}
                  <span>色凡例（本日分・全モード共通）:</span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 border bg-white dark:bg-gray-950 border-gray-200 dark:border-gray-800" />
                    <span>&lt; 20分</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 border bg-amber-100 dark:bg-amber-900/30 border-gray-200 dark:border-gray-800" />
                    <span>20分以上</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 border bg-red-200 dark:bg-red-900/30 border-gray-200 dark:border-gray-800" />
                    <span>30分以上</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span>👋TA呼び出し中</span>
                  </span>
                </div>
              </div>
            </div>

            {!assignedClass ? (
              <div className="py-20 text-center text-gray-500 dark:text-gray-400">
                <p className="text-sm font-semibold mb-2">担当クラスが選択されていません</p>
                <p className="text-xs">左のメニューから「担当クラス」を選択すると、そのクラスの座席表が表示されます。</p>
              </div>
            ) : (
              <div
                ref={seatOuterRef}
                className="w-full flex justify-center overflow-hidden"
              >
                <div
                  ref={seatInnerRef}
                  className="flex flex-col items-center gap-3 origin-top"
                  style={{ transform: `scale(${seatScale})` }}
                >
                  <div
                    className="transform"
                    style={{
                      transform: seatRotated ? 'rotate(180deg)' : 'rotate(0deg)',
                      transformOrigin: 'center',
                    }}
                  >
                    <div
                      className={`mt-1 mb-1 px-6 py-1 border text-[11px] text-center bg-white dark:bg-gray-950 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100 ${
                        seatRotated ? 'transform rotate-180' : ''
                      }`}
                    >
                      教卓
                    </div>

                    <div className="flex flex-wrap gap-6 justify-center">
                      {seatBlocks.map((block) => {
                        const offsetClass =
                          block.id === 'left' || block.id === 'farRight'
                            ? 'mt-14'
                            : ''

                        return (
                          <div
                            key={block.id}
                            className={`grid gap-px border bg-gray-200 dark:bg-gray-800 ${offsetClass}`}
                            style={{
                              gridTemplateColumns: `repeat(${block.cols.length}, 4.5rem)`,
                            }}
                          >
                            {block.rows.map((row) =>
                              block.cols.map((col) => {
                                const seatId = `${col}${row}`

                                const seatInfo = studentSeatMap.get(seatId)
                                const latestAny = seatLatestAnyProblemMap.get(seatId)

                                const currentProblemId =
                                  seatInfo?.currentProblemId ??
                                  latestAny?.problemId ??
                                  null

                                const latestForCurrent =
                                  currentProblemId != null
                                    ? seatProblemLatestMap.get(
                                        `${seatId}__${currentProblemId}`
                                      )
                                    : undefined

                                const problemId = currentProblemId
                                const title =
                                  seatInfo?.currentProblemTitle ??
                                  latestForCurrent?.title ??
                                  latestAny?.title ??
                                  ''

                                let minutesToday: number | null = null

                                const startedTs =
                                  seatInfo?.timerStartedAt ??
                                  seatInfo?.startedAt ??
                                  seatInfo?.updatedAt ??
                                  null

                                let elapsedSecByTimer: number | null = null
                                const baseSec =
                                  typeof seatInfo?.timerBaseSec === 'number'
                                    ? seatInfo.timerBaseSec
                                    : 0

                                if (baseSec > 0 || seatInfo?.timerRunning) {
                                  let sec = baseSec
                                  if (
                                    seatInfo?.timerRunning &&
                                    seatInfo.timerResumedAt
                                  ) {
                                    const resumedMs =
                                      seatInfo.timerResumedAt.toDate().getTime()
                                    const diffSec = Math.max(
                                      0,
                                      Math.floor((nowMs - resumedMs) / 1000)
                                    )
                                    sec += diffSec
                                  }
                                  elapsedSecByTimer = sec
                                }

                                const isTodayByTimer =
                                  (startedTs && isSameDay(startedTs, nowMs)) ||
                                  (seatInfo?.timerResumedAt &&
                                    isSameDay(seatInfo.timerResumedAt, nowMs))

                                if (elapsedSecByTimer != null && isTodayByTimer) {
                                  minutesToday = Math.floor(elapsedSecByTimer / 60)
                                }

                                if (minutesToday == null) {
                                  if (
                                    latestForCurrent?.createdAt &&
                                    isSameDay(latestForCurrent.createdAt, nowMs) &&
                                    typeof latestForCurrent.durationSec === 'number'
                                  ) {
                                    minutesToday = Math.floor(
                                      latestForCurrent.durationSec / 60
                                    )
                                  }
                                }

                                if (minutesToday == null && startedTs) {
                                  if (isSameDay(startedTs, nowMs)) {
                                    minutesToday = diffMinutesFromNow(
                                      startedTs,
                                      nowMs
                                    )
                                  }
                                }

                                const matchesFilter =
                                  problemFilter === 'all' ||
                                  (problemId && problemId === problemFilter)

                                let bgClass =
                                  matchesFilter && minutesToday != null
                                    ? seatBgClassByMinutes(minutesToday)
                                    : 'bg-white dark:bg-gray-950'

                                let mainLine = title
                                let subLine =
                                  matchesFilter && minutesToday != null
                                    ? `${minutesToday}分経過`
                                    : ''

                                let taLine = seatInfo?.taRequested
                                  ? 'TA呼び出し中'
                                  : ''

                                let isTodaySeat = false
                                if (isTodayByTimer) {
                                  isTodaySeat = true
                                } else if (
                                  latestForCurrent?.createdAt &&
                                  isSameDay(latestForCurrent.createdAt, nowMs)
                                ) {
                                  isTodaySeat = true
                                } else if (
                                  latestAny?.createdAt &&
                                  isSameDay(latestAny?.createdAt, nowMs)
                                ) {
                                  isTodaySeat = true
                                } else if (
                                  seatInfo?.updatedAt &&
                                  isSameDay(seatInfo.updatedAt, nowMs)
                                ) {
                                  isTodaySeat = true
                                }

                                if (!isTodaySeat) {
                                  mainLine = ''
                                  subLine = ''
                                  taLine = ''
                                  minutesToday = null
                                  bgClass = 'bg-white dark:bg-gray-950'
                                }

                                if (problemFilter !== 'all' && !matchesFilter) {
                                  mainLine = ''
                                  subLine = ''
                                  taLine = ''
                                }

                                if (seatInfo?.taRequested && isTodaySeat) {
                                  bgClass =
                                    'bg-rose-200 dark:bg-rose-900/35 border-rose-500 dark:border-rose-500'
                                }

                                const isSelectedSeat =
                                  selectedSeatForHistory === seatId

                                return (
                                  <div
                                    key={seatId}
                                    className={`flex flex-col items-center justify-center h-14 border ${bgClass} border-gray-200 dark:border-gray-800 ${
                                      isSelectedSeat
                                        ? 'ring-2 ring-blue-400 ring-offset-1 dark:ring-offset-gray-950'
                                        : ''
                                    } cursor-pointer hover:ring-1 hover:ring-blue-300`}
                                    onClick={() => {
                                      if (selectedSeatForHistory === seatId) {
                                        setSelectedSeatForHistory(null)
                                      } else {
                                        setSelectedSeatForHistory(seatId)
                                        setLogDateYMD(getTodayYMDLocal())
                                      }
                                      setDebugSeatId(seatId)
                                    }}
                                  >
                                    <div
                                      className={`w-full flex flex-col items-center ${
                                        seatRotated ? 'transform rotate-180' : ''
                                      }`}
                                    >
                                      <div className="text-[11px] font-semibold flex items-center gap-1 text-gray-900 dark:text-gray-100">
                                        <span>{seatId}</span>
                                        {seatInfo?.taRequested && isTodaySeat && (
                                          <span>👋</span>
                                        )}
                                      </div>

                                      <div className="text-[10px] text-center px-1 truncate w-full text-gray-900 dark:text-gray-100">
                                        {mainLine || ''}
                                      </div>

                                      <div className="text-[10px] text-center text-gray-700 dark:text-gray-300">
                                        {subLine}
                                      </div>

                                      {taLine && (
                                        <div className="text-[10px] text-center text-rose-700 dark:text-rose-300 font-semibold">
                                          {taLine}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )
                              })
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
              ・本日の履歴のみを対象としています（前日以前のデータは座席ビューには表示されません）。<br />
              ・問題フィルタ「すべて」のとき：各座席の本日分の問題タイトルと経過時間を表示します。<br />
              ・特定の問題でフィルタしたとき：その問題に取り組んでいる座席だけを表示し、経過時間で色分けします。<br />
              ・チャット／採点／座席情報は Firestore の変更をリアルタイムで反映します。<br />
              ・座席をクリックすると、その座席のログだけが下の「ログ一覧」に表示されます（もう一度クリックすると全体表示に戻ります）。
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-1">
              <h2 className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                ログ一覧（選択日: {logDateYMD}）
              </h2>
              <div className="flex flex-col items-start md:items-end gap-1 text-xs text-gray-500 dark:text-gray-400">
                <span>
                  {anyLoading
                    ? '読み込み中...'
                    : `合計: ${unifiedEntries.length} 件（チャット ${filteredChatLogs.length} / 採点 ${filteredSubmissions.length}）`}
                </span>
              </div>
            </div>

            {assignedClass && (
              <div className="flex flex-wrap gap-2 pb-2 border-b border-gray-100 dark:border-gray-800">
                {/* --- 全クラスボタン --- */}
                <button
                  // 配列に 'all' だけを入れる
                  onClick={() => setLogClassFilters(['all'])}
                  className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all ${
                    // 配列に 'all' が含まれているか判定
                    logClassFilters.includes('all')
                      ? 'bg-gray-800 text-white border-gray-800 shadow-sm'
                      : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  全クラス表示
                </button>

                {/* --- 各クラスボタン --- */}
                {ALLOWED_CLASSES.map((c) => {
                  const isSelected = logClassFilters.includes(c);
                  return (
                    <button
                      key={c}
                      onClick={() => {
                        setLogClassFilters((prev) => {
                          // 「全クラス」選択中に個別クラスを押した場合は「全クラス」を解除してそのクラスだけにする
                          const base = prev.filter(f => f !== 'all');
                          if (isSelected) {
                            // すでに選択済みなら削除（デフォルトのクラスもこれで消せます）
                            return base.filter((item) => item !== c);
                          } else {
                            // 未選択なら追加
                            return [...base, c];
                          }
                        });
                      }}
                      className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all ${
                        isSelected
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-100'
                      }`}
                    >
                      {c === assignedClass ? `👨‍🏫 ${c}` : c}
                      {isSelected && <span className="ml-1 opacity-70">×</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {selectedSeatForHistory && (
              <div className="mb-2 flex items-center justify-between border rounded bg-blue-50 dark:bg-blue-950/40 px-3 py-1 text-[11px] text-blue-900 dark:text-blue-200 border-blue-200 dark:border-blue-900">
                <span>
                  座席{' '}
                  <span className="font-semibold">{selectedSeatForHistory}</span>{' '}
                  のログのみ表示しています。もう一度座席をクリックすると全体表示に戻ります。
                </span>
                <button
                  className="border border-blue-400 dark:border-blue-700 rounded px-2 py-0.5 bg-white dark:bg-gray-950 text-blue-700 dark:text-blue-200 hover:bg-blue-50 dark:hover:bg-blue-950/60"
                  onClick={() => setSelectedSeatForHistory(null)}
                >
                  フィルタ解除
                </button>
              </div>
            )}

            {unifiedEntries.length === 0 && !anyLoading && (
              <div className="text-xs text-gray-500 dark:text-gray-400 border rounded p-3 bg-white dark:bg-gray-950 border-gray-200 dark:border-gray-800">
                選択日で条件に一致するログがありません。
              </div>
            )}

            <div className="space-y-2">
              {unifiedEntries.map((e) => {
                if (e.kind === 'chat') {
                  const log = e
                  const qt = normalizeQuestionType(log.questionType)
                  const qtLabel = QUESTION_TYPE_LABEL[qt] ?? QUESTION_TYPE_LABEL.unknown
                  
                  const cId = log.classId || (log.seatNumber ? seatToClassMap.get(log.seatNumber.toUpperCase()) : null)

                  return (
                    <details
                      key={`chat-${log.id}`}
                      className="border rounded bg-white dark:bg-gray-950 text-xs border-gray-200 dark:border-gray-800"
                    >
                      <summary className="px-3 py-2 cursor-pointer flex items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-gray-900">
                        <div className="flex flex-col gap-1 min-w-0">
                          <div className="flex flex-wrap gap-2 items-center">
                            <span className="font-semibold truncate max-w-[18rem] text-gray-900 dark:text-gray-100">
                              {log.problemTitle || '(問題タイトル未設定)'}
                            </span>
                            <span className="px-1.5 py-0.5 rounded border bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900 text-gray-900 dark:text-gray-100">
                              チャット
                            </span>
                            {log.seatNumber && (
                              <span className="px-1.5 py-0.5 rounded border bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100">
                                座席: {log.seatNumber}
                              </span>
                            )}
                            {cId && (
                              <span className="px-1.5 py-0.5 rounded border bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-900 text-gray-900 dark:text-gray-100">
                                クラス: {cId}
                              </span>
                            )}
                            <span className="px-1.5 py-0.5 rounded border bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900 text-gray-900 dark:text-gray-100">
                              種類: {qtLabel}
                            </span>

                            <span
                              className={`px-1.5 py-0.5 rounded border ${
                                log.resolved
                                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-900 text-emerald-700 dark:text-emerald-200'
                                  : 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-900 text-amber-800 dark:text-amber-200'
                              }`}
                            >
                              {log.resolved ? '解決' : '未解決'}
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-500 dark:text-gray-400 flex flex-wrap gap-2">
                            <span>{formatDateTime(log.createdAt)}</span>
                            {typeof log.durationSec === 'number' && (
                              <span>着席〜質問まで: {secondsToMin(log.durationSec)}</span>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-700 dark:text-gray-300 truncate">
                            {log.userMessage.replace(/\s+/g, ' ').slice(0, 80)}
                            {log.userMessage.length > 80 && '...'}
                          </div>
                        </div>
                      </summary>
                      <div className="border-t px-3 py-2 grid grid-cols-1 md:grid-cols-2 gap-3 border-gray-200 dark:border-gray-800">
                        <div className="space-y-1">
                          <div className="font-semibold text-gray-700 dark:text-gray-200">
                            学生の質問
                          </div>
                          <pre className="whitespace-pre-wrap text-[11px] bg-gray-50 dark:bg-gray-900 rounded p-2 overflow-auto max-h-64 text-gray-900 dark:text-gray-100">
                            {log.userMessage}
                          </pre>
                        </div>
                        <div className="space-y-1">
                          <div className="font-semibold text-gray-700 dark:text-gray-200">
                            アシスタントの回答
                          </div>
                          <pre className="whitespace-pre-wrap text-[11px] bg-gray-50 dark:bg-gray-900 rounded p-2 overflow-auto max-h-64 text-gray-900 dark:text-gray-100">
                            {log.assistantMessage}
                          </pre>
                        </div>
                      </div>
                    </details>
                  )
                }

                const s = e
                const cId = s.classId || (s.seatNumber ? seatToClassMap.get(s.seatNumber.toUpperCase()) : null)

                return (
                  <details
                    key={`grading-${s.id}`}
                    className="border rounded bg-white dark:bg-gray-950 text-xs border-gray-200 dark:border-gray-800"
                  >
                    <summary className="px-3 py-2 cursor-pointer flex items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-gray-900">
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold truncate max-w-[18rem] text-gray-900 dark:text-gray-100">
                            {s.problemTitle || '(問題タイトル未設定)'}
                          </span>
                          <span className="px-1.5 py-0.5 rounded border bg-green-50 dark:bg-green-950/40 border-green-300 dark:border-green-900 text-green-700 dark:text-green-200">
                            採点提出
                          </span>
                          {s.seatNumber && (
                            <span className="px-1.5 py-0.5 rounded border bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100">
                              座席: {s.seatNumber}
                            </span>
                          )}
                          {cId && (
                            <span className="px-1.5 py-0.5 rounded border bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-900 text-gray-900 dark:text-gray-100">
                              クラス: {cId}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 flex flex-wrap gap-2">
                          <span>{formatDateTime(s.submittedAt)}</span>
                          {typeof s.durationSec === 'number' && (
                            <span>着席〜提出まで: {secondsToMin(s.durationSec)}</span>
                          )}
                          <span>ファイル数: {s.files?.length ?? 0}</span>
                        </div>
                        {s.gradingResult && (
                          <div className="text-[11px] text-gray-700 dark:text-gray-300 truncate">
                            {s.gradingResult.replace(/\s+/g, ' ').slice(0, 80)}
                            {s.gradingResult.length > 80 && '...'}
                          </div>
                        )}
                      </div>
                    </summary>

                    <div className="border-t px-3 py-2 space-y-2 border-gray-200 dark:border-gray-800">
                      {s.gradingResult ? (
                        <div className="space-y-1">
                          <div className="font-semibold text-gray-700 dark:text-gray-200">
                            生成AIの採点結果
                          </div>
                          <pre className="whitespace-pre-wrap text-[11px] bg-gray-50 dark:bg-gray-900 rounded p-2 overflow-auto max-h-64 text-gray-900 dark:text-gray-100">
                            {s.gradingResult}
                          </pre>
                        </div>
                      ) : (
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">
                          採点結果（gradingResult）が記録されていません。
                        </div>
                      )}

                      {s.files && s.files.length > 0 ? (
                        <div className="space-y-1">
                          <div className="font-semibold text-gray-700 dark:text-gray-200">
                            提出ファイル
                          </div>
                          <ul className="list-disc pl-5 space-y-1">
                            {s.files.map((f, i) => (
                              <li key={i} className="text-gray-900 dark:text-gray-100">
                                <span className="mr-2">{f.name}</span>
                                <span className="mr-2 text-gray-500 dark:text-gray-400">
                                  {f.size}B
                                </span>
                                {f.downloadURL && (
                                  <a
                                    href={f.downloadURL}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-blue-600 dark:text-blue-300 underline"
                                  >
                                    開く
                                  </a>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">
                          ファイル情報が記録されていません。
                        </div>
                      )}
                    </div>
                  </details>
                )
              })}
            </div>
          </section>
        </section>
      </div>
    </main>
  )
}