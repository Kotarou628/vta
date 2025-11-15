// src/app/teacher/page.tsx
'use client'

import React, { useEffect, useMemo, useState } from 'react'
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
}

// 座席情報（students コレクション）
type StudentSeat = {
  id: string
  seatNumber: string
  currentProblemId?: string | null
  currentProblemTitle?: string | null
  startedAt?: Timestamp | null
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

// 同じ日付かどうか（本日かどうかの判定に使用）
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

// 経過時間（分）を計算
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

// 経過時間に応じた背景色
const seatBgClassByMinutes = (minutes: number | null): string => {
  if (minutes == null) return 'bg-white'
  if (minutes < 20) return 'bg-white'
  if (minutes < 30) return 'bg-amber-100'
  return 'bg-red-200'
}

// 座席ブロック定義（画像のレイアウト準拠）
const seatBlocks = [
  {
    id: 'left',
    cols: ['A', 'B', 'C'],
    rows: ['01', '02', '03', '04', '05', '06', '07'],
  },
  {
    id: 'midLeft',
    cols: ['D', 'E', 'F'],
    rows: ['01', '02', '03', '04', '05', '06', '07', '08'],
  },
  {
    id: 'midRight',
    cols: ['G', 'H', 'I'],
    rows: ['01', '02', '03', '04', '05', '06', '07', '08'],
  },
  {
    id: 'right',
    cols: ['J', 'K', 'L'],
    rows: ['01', '02', '03', '04', '05', '06', '07'],
  },
]

export default function TeacherPage() {
  const [tab, setTab] = useState<'chat' | 'grading'>('chat')

  // ===== 共通フィルタ状態 =====
  const [problemFilter, setProblemFilter] = useState<string>('all')
  const [questionTypeFilter, setQuestionTypeFilter] =
    useState<QuestionType | 'all'>('all')
  const [resolvedFilter, setResolvedFilter] =
    useState<'all' | 'resolved' | 'unresolved'>('all')
  const [limitCount, setLimitCount] = useState<number>(100)

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
        const list: StudentSeat[] = []
        snap.forEach((docSnap) => {
          const d = docSnap.data() as any
          if (!d.seatNumber) return
          list.push({
            id: docSnap.id,
            seatNumber: (d.seatNumber as string).toUpperCase(),
            currentProblemId: d.currentProblemId ?? null,
            currentProblemTitle: d.currentProblemTitle ?? null,
            startedAt: d.startedAt ?? null,
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

  // フィルタ適用後のチャットログ（本日分のみ）
  const filteredChatLogs = useMemo(() => {
    return chatLogs.filter((log) => {
      if (!isSameDay(log.createdAt, nowMs)) return false
      if (problemFilter !== 'all' && log.problemId !== problemFilter) return false
      if (
        questionTypeFilter !== 'all' &&
        (log.questionType ?? 'unknown') !== questionTypeFilter
      )
        return false
      if (resolvedFilter === 'resolved' && !log.resolved) return false
      if (resolvedFilter === 'unresolved' && log.resolved) return false
      return true
    })
  }, [chatLogs, problemFilter, questionTypeFilter, resolvedFilter, nowMs])

  // フィルタ適用後の submissions（本日分のみ）
  const filteredSubmissions = useMemo(() => {
    return submissions.filter((s) => {
      if (!isSameDay(s.submittedAt, nowMs)) return false
      if (problemFilter !== 'all' && s.problemId !== problemFilter) return false
      return true
    })
  }, [submissions, problemFilter, nowMs])

  // seatNumber → StudentSeat のマップ
  const studentSeatMap = useMemo(() => {
    const m = new Map<string, StudentSeat>()
    students.forEach((s) => {
      if (!s.seatNumber) return
      m.set(s.seatNumber.toUpperCase(), s)
    })
    return m
  }, [students])

  // seatNumber → 「本日分の最新チャットの問題ID/タイトル/送信時刻/送信時点の経過秒」のマップ
  const seatLatestProblemMap = useMemo(() => {
    const m = new Map<
      string,
      {
        problemId: string
        title: string
        createdAt: Timestamp | null
        durationSec?: number
      }
    >()

    // chatLogs は createdAt desc で取得しているので、最初に見つけたものが本日分の最新
    chatLogs.forEach((log) => {
      if (!log.seatNumber || !log.problemId) return
      if (!isSameDay(log.createdAt, nowMs)) return

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

  return (
    <main className="h-screen flex flex-col">
      {/* ヘッダ */}
      <header className="border-b px-4 py-2 flex items-center justify-between bg-white">
        <h1 className="font-bold text-lg">教員・TA向け 可視化画面</h1>
        <div className="text-xs text-gray-600 flex items-center gap-2">
          <span>
            表示上限:
            <select
              className="ml-1 border rounded px-1 py-0.5 text-xs"
              value={limitCount}
              onChange={(e) => setLimitCount(Number(e.target.value) || 100)}
            >
              <option value={50}>50件</option>
              <option value={100}>100件</option>
              <option value={300}>300件</option>
            </select>
          </span>
          <button
            className="text-xs border rounded px-2 py-1 hover:bg-gray-50"
            onClick={() => {
              // ★「再読み込み」は主に問題フィルタ用の候補を更新
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
        <aside className="w-64 border-r p-3 text-xs bg-gray-50 space-y-3 overflow-y-auto">
          <div>
            <div className="font-semibold mb-1 text-gray-700">タブ</div>
            <div className="flex gap-2">
              <button
                className={`flex-1 border rounded px-2 py-1 ${
                  tab === 'chat'
                    ? 'bg-blue-100 border-blue-400'
                    : 'bg-white hover:bg-gray-50'
                }`}
                onClick={() => setTab('chat')}
              >
                チャットログ
              </button>
              <button
                className={`flex-1 border rounded px-2 py-1 ${
                  tab === 'grading'
                    ? 'bg-green-100 border-green-400'
                    : 'bg-white hover:bg-gray-50'
                }`}
                onClick={() => setTab('grading')}
              >
                採点提出
              </button>
            </div>
          </div>

          <div>
            <div className="font-semibold mb-1 text-gray-700">問題フィルタ</div>
            <select
              className="w-full border rounded px-2 py-1 bg-white"
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

          {tab === 'chat' && (
            <>
              <div>
                <div className="font-semibold mb-1 text-gray-700">質問タイプ</div>
                <select
                  className="w-full border rounded px-2 py-1 bg-white"
                  value={questionTypeFilter}
                  onChange={(e) => setQuestionTypeFilter(e.target.value as any)}
                >
                  <option value="all">すべて</option>
                  <option value="error">エラー・例外</option>
                  <option value="syntax">文法・書き方</option>
                  <option value="review">コードレビュー</option>
                  <option value="algo">理論・アルゴリズム</option>
                  <option value="free">自由記述</option>
                  <option value="unknown">不明</option>
                </select>
              </div>

              <div>
                <div className="font-semibold mb-1 text-gray-700">解決状況</div>
                <select
                  className="w-full border rounded px-2 py-1 bg-white"
                  value={resolvedFilter}
                  onChange={(e) => setResolvedFilter(e.target.value as any)}
                >
                  <option value="all">すべて</option>
                  <option value="resolved">解決済み</option>
                  <option value="unresolved">未解決</option>
                </select>
              </div>
            </>
          )}
        </aside>

        {/* 右：メイン表示 */}
        <section className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 座席ビュー */}
          <section className="border rounded bg-white p-3 text-xs space-y-2">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-sm">座席ビュー</h2>
              <div className="text-[10px] text-gray-500 flex items-center gap-3">
                {studentsLoading ? <span>読み込み中...</span> : null}
                <span>色凡例（本日分・全モード共通）:</span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 border bg-white" />
                  <span>&lt; 20分</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 border bg-amber-100" />
                  <span>20分以上</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 border bg-red-200" />
                  <span>30分以上</span>
                </span>
              </div>
            </div>

            <div className="flex flex-col items-center gap-3">
              <div className="mt-1 mb-1 px-6 py-1 border text-[11px] text-center">
                教卓
              </div>

              <div className="flex flex-wrap gap-6 justify-center">
                {seatBlocks.map((block) => {
                  // A〜C, J〜L ブロックだけ 1 行分下げる
                  const offsetClass =
                    block.id === 'left' || block.id === 'right' ? 'mt-14' : ''

                  return (
                    <div
                      key={block.id}
                      className={`grid gap-px border bg-gray-200 ${offsetClass}`}
                      style={{
                        gridTemplateColumns: `repeat(${block.cols.length}, 4rem)`,
                      }}
                    >
                      {block.rows.map((row) =>
                        block.cols.map((col) => {
                          const seatId = `${col}${row}` // 例: A01

                          const seatInfo = studentSeatMap.get(seatId)
                          const latest = seatLatestProblemMap.get(seatId)

                          // 表示用の問題ID/タイトル（本日分）
                          const problemId =
                            seatInfo?.currentProblemId ?? latest?.problemId ?? null
                          const title =
                            seatInfo?.currentProblemTitle ?? latest?.title ?? ''

                          // 経過時間（分）の計算
                          // 1) students.startedAt が今日にある場合：着席〜現在の経過時間をそのまま使う
                          let minutesToday: number | null = null

                          if (
                            seatInfo?.startedAt &&
                            isSameDay(seatInfo.startedAt, nowMs)
                          ) {
                            minutesToday = diffMinutesFromNow(
                              seatInfo.startedAt,
                              nowMs
                            )
                          } else if (
                            latest?.createdAt &&
                            isSameDay(latest.createdAt, nowMs)
                          ) {
                            // 2) startedAt が無い場合
                            //    「送信した瞬間にすでに経過していた時間」＋「送信後の経過時間」
                            const baseMinAtSend =
                              typeof latest.durationSec === 'number'
                                ? Math.floor(latest.durationSec / 60)
                                : 0
                            const afterSendMin =
                              diffMinutesFromNow(latest.createdAt, nowMs) ?? 0
                            minutesToday = baseMinAtSend + afterSendMin
                          } else {
                            minutesToday = null
                          }

                          const matchesFilter =
                            problemFilter === 'all' ||
                            (problemId && problemId === problemFilter)

                          const bgClass =
                            matchesFilter && minutesToday != null
                              ? seatBgClassByMinutes(minutesToday)
                              : 'bg-white'

                          let mainLine = title
                          let subLine =
                            matchesFilter && minutesToday != null
                              ? `${minutesToday}分経過`
                              : ''

                          // フィルタで特定の問題を選んだときは、
                          // その問題以外の座席は空表示にする
                          if (problemFilter !== 'all' && !matchesFilter) {
                            mainLine = ''
                            subLine = ''
                          }

                          return (
                            <div
                              key={seatId}
                              className={`flex flex-col items-center justify-center h-14 border ${bgClass}`}
                            >
                              <div className="text-[11px] font-semibold">{seatId}</div>
                              <div className="text-[10px] text-center px-1 truncate w-full">
                                {mainLine || ''}
                              </div>
                              <div className="text-[10px] text-center text-gray-700">
                                {subLine}
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

            <div className="text-[10px] text-gray-500 mt-1">
              ・本日の履歴のみを対象としています（前日以前のデータは座席ビュー／一覧には表示されません）。<br />
              ・問題フィルタ「すべて」のとき：各座席の本日分の問題タイトルと経過時間を表示します。<br />
              ・特定の問題でフィルタしたとき：その問題に取り組んでいる座席だけを表示し、経過時間で色分けします。<br />
              ・チャット／採点／座席情報は Firestore の変更をリアルタイムで反映します。
            </div>
          </section>

          {/* チャットログ一覧（本日分） */}
          {tab === 'chat' && (
            <>
              <div className="flex items-center justify-between mb-1">
                <h2 className="font-semibold text-sm">チャットログ一覧（本日分）</h2>
                <span className="text-xs text-gray-500">
                  {chatLoading
                    ? '読み込み中...'
                    : `表示件数: ${filteredChatLogs.length} 件`}
                </span>
              </div>

              {filteredChatLogs.length === 0 && !chatLoading && (
                <div className="text-xs text-gray-500 border rounded p-3 bg-white">
                  本日分で条件に一致するチャットログがありません。
                </div>
              )}

              <div className="space-y-2">
                {filteredChatLogs.map((log) => (
                  <details
                    key={log.id}
                    className="border rounded bg-white text-xs"
                  >
                    <summary className="px-3 py-2 cursor-pointer flex items-center justify-between gap-3">
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="flex flex-wrap gap-2 items-center">
                          <span className="font-semibold truncate max-w-[18rem]">
                            {log.problemTitle || '(問題タイトル未設定)'}
                          </span>
                          {log.seatNumber && (
                            <span className="px-1.5 py-0.5 rounded border bg-gray-50">
                              座席: {log.seatNumber}
                            </span>
                          )}
                          {log.questionType && (
                            <span className="px-1.5 py-0.5 rounded border bg-blue-50">
                              種類: {log.questionType}
                            </span>
                          )}
                          <span
                            className={`px-1.5 py-0.5 rounded border ${
                              log.resolved
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                                : 'bg-amber-50 border-amber-300 text-amber-800'
                            }`}
                          >
                            {log.resolved ? '解決' : '未解決'}
                          </span>
                        </div>
                        <div className="text-[11px] text-gray-500 flex flex-wrap gap-2">
                          <span>{formatDateTime(log.createdAt)}</span>
                          {typeof log.durationSec === 'number' && (
                            <span>着席〜質問まで: {secondsToMin(log.durationSec)}</span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-700 truncate">
                          {log.userMessage.replace(/\s+/g, ' ').slice(0, 80)}
                          {log.userMessage.length > 80 && '...'}
                        </div>
                      </div>
                    </summary>
                    <div className="border-t px-3 py-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <div className="font-semibold text-gray-700">学生の質問</div>
                        <pre className="whitespace-pre-wrap text-[11px] bg-gray-50 rounded p-2 overflow-auto max-h-64">
                          {log.userMessage}
                        </pre>
                      </div>
                      <div className="space-y-1">
                        <div className="font-semibold text-gray-700">アシスタントの回答</div>
                        <pre className="whitespace-pre-wrap text-[11px] bg-gray-50 rounded p-2 overflow-auto max-h-64">
                          {log.assistantMessage}
                        </pre>
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            </>
          )}

          {/* 採点提出一覧（本日分） */}
          {tab === 'grading' && (
            <>
              <div className="flex items-center justify-between mb-1">
                <h2 className="font-semibold text-sm">採点提出一覧（本日分）</h2>
                <span className="text-xs text-gray-500">
                  {subLoading
                    ? '読み込み中...'
                    : `表示件数: ${filteredSubmissions.length} 件`}
                </span>
              </div>

              {filteredSubmissions.length === 0 && !subLoading && (
                <div className="text-xs text-gray-500 border rounded p-3 bg-white">
                  本日分で条件に一致する採点提出がありません。
                </div>
              )}

              <div className="space-y-2 text-xs">
                {filteredSubmissions.map((s) => (
                  <details key={s.id} className="border rounded bg-white">
                    <summary className="px-3 py-2 cursor-pointer flex items-center justify-between gap-3">
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold truncate max-w-[18rem]">
                            {s.problemTitle || '(問題タイトル未設定)'}
                          </span>
                          {s.seatNumber && (
                            <span className="px-1.5 py-0.5 rounded border bg-gray-50">
                              座席: {s.seatNumber}
                            </span>
                          )}
                          <span className="px-1.5 py-0.5 rounded border bg-emerald-50">
                            モード: {s.inputMode ?? s.mode}
                          </span>
                        </div>
                        <div className="text-[11px] text-gray-500 flex flex-wrap gap-2">
                          <span>{formatDateTime(s.submittedAt)}</span>
                          {typeof s.durationSec === 'number' && (
                            <span>着席〜提出まで: {secondsToMin(s.durationSec)}</span>
                          )}
                          <span>ファイル数: {s.files?.length ?? 0}</span>
                        </div>
                      </div>
                    </summary>
                    <div className="border-t px-3 py-2 space-y-2">
                      {s.files && s.files.length > 0 ? (
                        <ul className="list-disc pl-5 space-y-1">
                          {s.files.map((f, i) => (
                            <li key={i}>
                              <span className="mr-2">{f.name}</span>
                              <span className="mr-2 text-gray-500">{f.size}B</span>
                              {f.downloadURL && (
                                <a
                                  href={f.downloadURL}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-blue-600 underline"
                                >
                                  開く
                                </a>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="text-[11px] text-gray-500">
                          ファイル情報が記録されていません。
                        </div>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  )
}
