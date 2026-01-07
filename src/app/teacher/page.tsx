// src/app/teacher/page.tsx
'use client'

import React, { useEffect, useMemo, useState, useRef } from 'react'
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  Timestamp,
  onSnapshot,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'

type QuestionType = 'error' | 'syntax' | 'review' | 'algo' | 'free' | 'unknown'

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
  gradingResult?: string // ★ 生成AIの採点/評価出力
}

// 座席情報（students コレクション）
type StudentSeat = {
  id: string
  seatNumber: string
  currentProblemId?: string | null
  currentProblemTitle?: string | null
  // 問題を選択した瞬間の時刻（タイマー開始）
  timerStartedAt?: Timestamp | null
  // 将来 startedAt に移行しても動くように一応残しておく
  startedAt?: Timestamp | null
  taRequested?: boolean
  taRequestedAt?: Timestamp | null

  // タイマー系（chat 画面と同じ設計）
  timerBaseSec?: number
  timerResumedAt?: Timestamp | null
  timerRunning?: boolean

  // 本日分だけを座席ビューに出すための更新時刻
  updatedAt?: Timestamp | null
}

// ★ 質問タイプ → 日本語ラベル
const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  error: 'エラー・例外の相談',
  syntax: '書き方の相談',
  review: 'コードレビュー・バグの相談',
  algo: 'アルゴリズム・理論の相談',
  free: '自由記述の相談',
  unknown: '（種類未入力）',
}

const getStartOfTodayLocal = (): Date => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

// ★ YYYY-MM-DD の文字列 → その日の local Date（正午に寄せて DST 事故を避ける）
const dateMsFromYMDLocalNoon = (ymd: string): number | null => {
  if (!ymd) return null
  const [y, m, d] = ymd.split('-').map((v) => Number(v))
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d, 12, 0, 0, 0).getTime()
}

// ★ 今日の YYYY-MM-DD（local）
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

// 同じ日付かどうか（「選択日の履歴」判定にも使用）
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

// 経過時間（分）の fallback 計算
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

// 経過時間に応じた背景色（ダーク対応）
const seatBgClassByMinutes = (minutes: number | null): string => {
  if (minutes == null) return 'bg-white dark:bg-gray-950'
  if (minutes < 20) return 'bg-white dark:bg-gray-950'
  if (minutes < 30) return 'bg-amber-100 dark:bg-amber-900/30'
  return 'bg-red-200 dark:bg-red-900/30'
}

// 座席ブロック定義（画像のレイアウト準拠）
const seatBlocks = [
  // 左ブロック：A/B/C の 02〜07
  {
    id: 'left',
    cols: ['A', 'B', 'C'],
    rows: ['02', '03', '04', '05', '06', '07'],
  },
  // 中央左：D/E/F の 01〜07
  {
    id: 'midLeft',
    cols: ['D', 'E', 'F'],
    rows: ['01', '02', '03', '04', '05', '06', '07'],
  },
  // 中央：G/H/I の 01〜07
  {
    id: 'midCenter',
    cols: ['G', 'H', 'I'],
    rows: ['01', '02', '03', '04', '05', '06', '07'],
  },
  // 中央右：J/K/L の 01〜07
  {
    id: 'midRight',
    cols: ['J', 'K', 'L'],
    rows: ['01', '02', '03', '04', '05', '06', '07'],
  },
  // 一番右：M/L/N の 02〜07
  {
    id: 'farRight',
    cols: ['M', 'N', 'O'], // 左から M, L, N の順で表示
    rows: ['02', '03', '04', '05', '06', '07'],
  },
]

type UnifiedEntry =
  | ({ kind: 'chat' } & ChatLog)
  | ({ kind: 'grading'; createdAt: Timestamp | null } & Submission)

export default function TeacherPage() {
  // ===== 共通フィルタ状態 =====
  const [problemFilter, setProblemFilter] = useState<string>('all')
  const [questionTypeFilter, setQuestionTypeFilter] =
    useState<QuestionType | 'all'>('all')
  const [resolvedFilter, setResolvedFilter] =
    useState<'all' | 'resolved' | 'unresolved'>('all')
  const [limitCount, setLimitCount] = useState<number>(100)

  // ★ 追加：ログ用の日付フィルタ（座席表には影響しない）
  const [logDateYMD, setLogDateYMD] = useState<string>(getTodayYMDLocal())

  // ★ デバッグ用: クリックされた座席ID
  const [debugSeatId, setDebugSeatId] = useState<string | null>(null)

  // ★ 座席履歴表示用: クリックされた座席のログだけを絞り込むフィルタ
  const [selectedSeatForHistory, setSelectedSeatForHistory] = useState<
    string | null
  >(null)

  // ★ 追加：座席ビュー表示の回転（教卓側表示）
  const [seatRotated, setSeatRotated] = useState(false)

  // 問題タイトル一覧（フィルタ用）
  const [problemOptions, setProblemOptions] = useState<
    { id: string; title: string }[]
  >([])

  // ===== チャットログ =====
  const [chatLogs, setChatLogs] = useState<ChatLog[]>([])
  const [chatLoading, setChatLoading] = useState(false)

  // ===== 採点提出 =====
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [subLoading, setSubLoading] = useState(false)

  // ===== 座席情報（students）=====
  const [students, setStudents] = useState<StudentSeat[]>([])
  const [studentsLoading, setStudentsLoading] = useState(false)

  // 「今」の時刻（座席ビュー＆当日判定用）
  const [nowMs, setNowMs] = useState<number>(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000) // 1分ごとに更新
    return () => clearInterval(id)
  }, [])

  // ★ 座席ビューのスケール制御用
  const seatOuterRef = useRef<HTMLDivElement | null>(null)
  const seatInnerRef = useRef<HTMLDivElement | null>(null)
  const [seatScale, setSeatScale] = useState(1)

  // ★ 選択日（ログ一覧用）の ms
  const selectedDayMs = useMemo(() => {
    const ms = dateMsFromYMDLocalNoon(logDateYMD)
    return ms ?? nowMs
  }, [logDateYMD, nowMs])

  // ---- 問題リスト取得（chatLogs から一度だけ。必要なら「再読み込み」で更新）----
  useEffect(() => {
    const fetchProblems = async () => {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'chatLogs'),
            orderBy('createdAt', 'desc'),
            limit(300)
          )
        )
        const map = new Map<string, string>()
        snap.forEach((doc) => {
          const d = doc.data() as any
          if (d.problemId && d.problemTitle) {
            if (!map.has(d.problemId)) {
              map.set(d.problemId, d.problemTitle)
            }
          }
        })
        const list = Array.from(map.entries()).map(([id, title]) => ({
          id,
          title,
        }))
        setProblemOptions(list)
      } catch (e) {
        console.error('[teacher] fetchProblems failed:', e)
      }
    }
    fetchProblems()
  }, [])

  // ---- チャットログのリアルタイム購読 ----
  useEffect(() => {
    setChatLoading(true)
    const qBase = query(
      collection(db, 'chatLogs'),
      orderBy('createdAt', 'desc'),
      limit(limitCount)
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
            questionType: d.questionType ?? 'unknown',
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
  }, [limitCount])

  // ---- 採点提出のリアルタイム購読 ----
  useEffect(() => {
    setSubLoading(true)
    const qBase = query(
      collection(db, 'submissions'),
      orderBy('submittedAt', 'desc'),
      limit(limitCount)
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
            gradingResult: d.gradingResult ?? '', // ★ 追加
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
  }, [limitCount])

  // ---- students（座席情報）のリアルタイム購読 ----
  useEffect(() => {
    setStudentsLoading(true)
    const unsub = onSnapshot(
      collection(db, 'students'),
      (snap) => {
        const todayStart = getStartOfTodayLocal() // 今日の 0:00

        const list: StudentSeat[] = []
        snap.forEach((docSnap) => {
          const d = docSnap.data() as any
          if (!d.seatNumber) return

          const updatedAt: Timestamp | null = d.updatedAt ?? null
          // updatedAt がない or 今日より前であれば「前回授業の残り」なので座席ビューから除外
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
            timerBaseSec:
              typeof d.timerBaseSec === 'number' ? d.timerBaseSec : 0,
            timerResumedAt: d.timerResumedAt ?? null,
            timerRunning: !!d.timerRunning,
            updatedAt,
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

  // ★ 座席ビューのスケール計算（画面幅に合わせて縮小）
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
      // 一旦スケール1に戻して本来の幅を測る
      seatInnerRef.current.style.transform = 'scale(1)'
      const innerWidth = seatInnerRef.current.scrollWidth
      if (innerWidth <= 0) {
        setSeatScale(1)
        return
      }
      const ratio = outerWidth / innerWidth
      const nextScale = ratio < 1 ? ratio : 1 // 縮小のみ。拡大はしない
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
  }, [students.length, problemFilter])

  // フィルタ適用後のチャットログ（★選択日分のみ＋座席フィルタ）
  const filteredChatLogs = useMemo(() => {
    return chatLogs.filter((log) => {
      if (!isSameDay(log.createdAt, selectedDayMs)) return false
      if (problemFilter !== 'all' && log.problemId !== problemFilter) return false
      if (
        questionTypeFilter !== 'all' &&
        (log.questionType ?? 'unknown') !== questionTypeFilter
      )
        return false
      if (resolvedFilter === 'resolved' && !log.resolved) return false
      if (resolvedFilter === 'unresolved' && log.resolved) return false

      // ★ 座席フィルタ（履歴表示用）
      if (selectedSeatForHistory) {
        const seat = (log.seatNumber ?? '').toUpperCase()
        if (seat !== selectedSeatForHistory) return false
      }

      return true
    })
  }, [
    chatLogs,
    problemFilter,
    questionTypeFilter,
    resolvedFilter,
    selectedDayMs,
    selectedSeatForHistory,
  ])

  // フィルタ適用後の submissions（★選択日分のみ＋座席フィルタ）
  const filteredSubmissions = useMemo(() => {
    return submissions.filter((s) => {
      if (!isSameDay(s.submittedAt, selectedDayMs)) return false
      if (problemFilter !== 'all' && s.problemId !== problemFilter) return false

      // ★ 座席フィルタ（履歴表示用）
      if (selectedSeatForHistory) {
        const seat = (s.seatNumber ?? '').toUpperCase()
        if (seat !== selectedSeatForHistory) return false
      }

      return true
    })
  }, [submissions, problemFilter, selectedDayMs, selectedSeatForHistory])

  // ★ チャット + 採点提出 を 1つの時系列ログに統合（★選択日）
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

  // seatNumber → StudentSeat のマップ
  const studentSeatMap = useMemo(() => {
    const m = new Map<string, StudentSeat>()
    students.forEach((s) => {
      if (!s.seatNumber) return
      m.set(s.seatNumber.toUpperCase(), s)
    })
    return m
  }, [students])

  // seatNumber → 「本日分の最新チャット（問題問わず）」のマップ
  const seatLatestAnyProblemMap = useMemo(() => {
    const m = new Map<
      string,
      {
        problemId: string
        title: string
        createdAt: Timestamp | null
        durationSec?: number
      }
    >()

    chatLogs.forEach((log) => {
      if (!log.seatNumber || !log.problemId) return
      if (!isSameDay(log.createdAt, nowMs)) return // ★座席表は本日固定

      const key = log.seatNumber.toUpperCase()
      if (!m.has(key)) {
        m.set(key, {
          problemId: log.problemId,
          title: log.problemTitle ?? '',
          createdAt: log.createdAt ?? null,
          durationSec:
            typeof log.durationSec === 'number' ? log.durationSec : undefined,
        })
      }
    })

    return m
  }, [chatLogs, nowMs])

  // seatNumber + problemId → 「その問題の本日分の最新チャット」のマップ
  const seatProblemLatestMap = useMemo(() => {
    const m = new Map<
      string,
      {
        problemId: string
        title: string
        createdAt: Timestamp | null
        durationSec?: number
      }
    >()

    chatLogs.forEach((log) => {
      if (!log.seatNumber || !log.problemId) return
      if (!isSameDay(log.createdAt, nowMs)) return // ★座席表は本日固定

      const seatId = log.seatNumber.toUpperCase()
      const key = `${seatId}__${log.problemId}`
      if (!m.has(key)) {
        m.set(key, {
          problemId: log.problemId,
          title: log.problemTitle ?? '',
          createdAt: log.createdAt ?? null,
          durationSec:
            typeof log.durationSec === 'number' ? log.durationSec : undefined,
        })
      }
    })

    return m
  }, [chatLogs, nowMs])

  // ★ デバッグ用: 選択中座席の情報まとめ（UI 側はコメントアウト）
  const debugSeatInfo = debugSeatId ? studentSeatMap.get(debugSeatId) : undefined
  const debugLatestAny = debugSeatId
    ? seatLatestAnyProblemMap.get(debugSeatId)
    : undefined

  const debugCurrentProblemId =
    debugSeatInfo?.currentProblemId ?? debugLatestAny?.problemId ?? null

  const debugLatestForCurrent =
    debugSeatId && debugCurrentProblemId
      ? seatProblemLatestMap.get(`${debugSeatId}__${debugCurrentProblemId}`)
      : undefined

  const anyLoading = chatLoading || subLoading

  return (
    <main className="h-screen flex flex-col bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      {/* ヘッダ */}
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
              // 「再読み込み」は主に問題フィルタ用の候補を更新
              setNowMs(Date.now())
              ;(async () => {
                try {
                  const snap = await getDocs(
                    query(
                      collection(db, 'chatLogs'),
                      orderBy('createdAt', 'desc'),
                      limit(300)
                    )
                  )
                  const map = new Map<string, string>()
                  snap.forEach((doc) => {
                    const d = doc.data() as any
                    if (d.problemId && d.problemTitle) {
                      if (!map.has(d.problemId)) {
                        map.set(d.problemId, d.problemTitle)
                      }
                    }
                  })
                  const list = Array.from(map.entries()).map(([id, title]) => ({
                    id,
                    title,
                  }))
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

      {/* コンテンツ */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左：フィルタ */}
        <aside className="w-64 border-r p-3 text-xs bg-gray-50 dark:bg-gray-900 space-y-3 overflow-y-auto border-gray-200 dark:border-gray-800">
          {/* ★ 追加：日付フィルタ（ログ一覧のみ切替） */}
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

          {/* 既存フィルタは残す（チャットにのみ効く） */}
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
              <option value="error">エラー・例外の相談</option>
              <option value="syntax">書き方の相談</option>
              <option value="review">コードレビュー・バグの相談</option>
              <option value="algo">アルゴリズム・理論の相談</option>
              <option value="free">自由記述の相談</option>
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

        {/* 右：メイン表示 */}
        <section className="flex-1 overflow-y-auto p-4 space-y-4 bg-white dark:bg-gray-950">
          {/* 座席ビュー */}
          <section className="border rounded bg-white dark:bg-gray-950 p-3 text-xs space-y-2 border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                座席ビュー（本日固定）
              </h2>

              <div className="flex items-center gap-3">
                {/* ★ 追加：表示切り替えボタン */}
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

            {/* ★ 座席ビュー全体をスケールさせるラッパー */}
            <div
              ref={seatOuterRef}
              className="w-full flex justify-center overflow-hidden"
            >
              <div
                ref={seatInnerRef}
                className="flex flex-col items-center gap-3 origin-top"
                style={{ transform: `scale(${seatScale})` }}
              >
                {/* ★ 追加：回転ラッパー（座席配置を180°回転） */}
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
                            gridTemplateColumns: `repeat(${block.cols.length}, 4rem)`,
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

                              let taLine = seatInfo?.taRequested ? 'TA呼び出し中' : ''

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
                                  }`}
                                  onClick={() => {
                                    // ★ 同じ座席をもう一度クリック → フィルタ解除
                                    if (selectedSeatForHistory === seatId) {
                                      setSelectedSeatForHistory(null)
                                    } else {
                                      // ★ クリックした座席の履歴だけを下のログ一覧に表示
                                      setSelectedSeatForHistory(seatId)
                                      // ★ ログ一覧の日付は「今日」に合わせる（座席ビューは本日固定のため）
                                      setLogDateYMD(getTodayYMDLocal())
                                    }
                                    // ★ デバッグ用 ID は残しておくが、UI 側はコメントアウト済み
                                    setDebugSeatId(seatId)
                                  }}
                                >
                                  {/* ★ 追加：回転時だけ、セル内の文字を逆回転して読みやすくする */}
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

            <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
              ・本日の履歴のみを対象としています（前日以前のデータは座席ビューには表示されません）。<br />
              ・問題フィルタ「すべて」のとき：各座席の本日分の問題タイトルと経過時間を表示します。<br />
              ・特定の問題でフィルタしたとき：その問題に取り組んでいる座席だけを表示し、経過時間で色分けします。<br />
              ・チャット／採点／座席情報は Firestore の変更をリアルタイムで反映します。<br />
              ・座席をクリックすると、その座席のログだけが下の「ログ一覧」に表示されます（もう一度クリックすると全体表示に戻ります）。
            </div>

            {/* ★ デバッグパネル（一般利用では非表示。必要なときだけコメントアウトを外す） */}
            {/*
            {debugSeatId && (
              <div className="mt-2 border-t pt-2 text-[10px] text-gray-700">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-semibold">
                    デバッグ情報（座席 {debugSeatId} をクリック中）
                  </div>
                  <button
                    className="border rounded px-2 py-0.5 text-[10px] bg-white hover:bg-gray-50"
                    onClick={() => setDebugSeatId(null)}
                  >
                    閉じる
                  </button>
                </div>

                <pre className="bg-gray-50 rounded p-2 overflow-auto max-h-48">
{JSON.stringify(
  {
    now: new Date(nowMs).toISOString(),
    seatInfo: debugSeatInfo ?? null,
    latestAnyChat: debugLatestAny ?? null,
    latestForCurrent: debugLatestForCurrent ?? null,
  },
  null,
  2
)}
                </pre>
                <div className="mt-1 text-[10px] text-gray-500">
                  ※座席をクリックすると、その座席に対応する students ドキュメントと、<br />
                  本日分の最新のチャット情報が JSON として表示されます。
                </div>
              </div>
            )}
            */}
          </section>

          {/* ★ 統合ログ一覧（選択日分） */}
          <section className="space-y-2">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-1">
              <h2 className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                ログ一覧（選択日: {logDateYMD}・チャット＋採点提出）
              </h2>
              <div className="flex flex-col items-start md:items-end gap-1 text-xs text-gray-500 dark:text-gray-400">
                <span>
                  {anyLoading
                    ? '読み込み中...'
                    : `合計: ${unifiedEntries.length} 件（チャット ${filteredChatLogs.length} / 採点 ${filteredSubmissions.length}）`}
                </span>
              </div>
            </div>

            {/* ★ 座席フィルタ中の目立つバー＋解除ボタン */}
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
                  const qtLabel = QUESTION_TYPE_LABEL[log.questionType ?? 'unknown']

                  return (
                    <details
                      key={`chat-${log.id}`}
                      className="border rounded bg-white dark:bg-gray-950 text-xs border-gray-200 dark:border-gray-800"
                    >
                      <summary className="px-3 py-2 cursor-pointer flex items-center justify-between gap-3">
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
                            {log.questionType && (
                              <span className="px-1.5 py-0.5 rounded border bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900 text-gray-900 dark:text-gray-100">
                                種類: {qtLabel}
                              </span>
                            )}
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

                // grading
                const s = e
                return (
                  <details
                    key={`grading-${s.id}`}
                    className="border rounded bg-white dark:bg-gray-950 text-xs border-gray-200 dark:border-gray-800"
                  >
                    <summary className="px-3 py-2 cursor-pointer flex items-center justify-between gap-3">
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
                          {/* 種別・入力方法のタグは表示しない（内部的には保持） */}
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
                      {/* ★ 生成AIの出力内容 */}
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

                      {/* ファイル一覧 */}
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
