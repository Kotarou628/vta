// C:\Users\Admin\vta\src\app\chat\page.tsx
'use client'

import React, {
  useEffect, useMemo, useRef, useState, ReactNode,
  forwardRef, useImperativeHandle,
} from 'react'
import Link from 'next/link'

/* ================== 入力欄ユーティリティ ================== */
type AutoGrowProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { maxVh?: number }
const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, AutoGrowProps>(function AutoGrowTextarea(
  { maxVh = 70, className = '', value, onInput, ...rest }, ref
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null)
  const fit = () => {
    const el = innerRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxPx = Math.round(window.innerHeight * (maxVh / 100))
    el.style.height = Math.min(el.scrollHeight, maxPx) + 'px'
  }
  useEffect(() => { fit() }, [value])
  useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement, [])
  return (
    <textarea
      ref={innerRef}
      value={value as string}
      onInput={(e) => { fit(); onInput?.(e) }}
      className={[
        'w-full border rounded font-mono leading-6 shadow-inner',
        'min-h-[10rem] resize-y overflow-auto',
        'focus:outline-none focus:ring-2 focus:ring-blue-400',
        className,
      ].join(' ')}
      {...rest}
    />
  )
})

/* ================== 教員プロンプト群（既存） ================== */
const BASE_TEACHER_PROMPT = (lang: string) => String.raw`
[役割] プログラミングを正しく教えられる教員。  
学習者が「いま質問した箇所だけ」を対象に説明し、それ以外の部分は出力しない。  
目的は、学習者が自分のコードの“どの位置に何を書くか”を理解すること。

[出力範囲の制限（最重要）]
- 学習者が質問した箇所以外の要素を出さない。
- 「全体像」や「次に書く部分」を先回りして出さない。

[最優先禁止ルール]
- 完成コードの提示禁止（位置だけ示す）。

[抽象度の基準]
- 型は抽象語、識別子は問題/模範コード準拠、具体リテラル非使用。
+ - **記法は模範コードに合わせる**（例：配列は \`{...}\` リテラルのみ。\`new String[]{...}\` にしない）。

[コード出力ルール]
- \`\`\`${lang}\`\`\` で、該当範囲のみ骨組みを出す。

[出力形式]
アドバイス: 3〜5文。  
質問: 1つだけ（?で終える）。  
コード例: 上記の抽象度/記法で。
`.trim()

const outputRule = (lang: string) => String.raw`
【出力形式(再確認)】
アドバイスは最大5文。具体リテラル禁止。
質問は「この時点では○○を書かなくてよい」系を1つ。
コード例は \`\`\`${lang} から。識別子追加や別記法の導入は禁止。
`.trim()

const GRADING_PROMPT = String.raw`
[役割] 採点・助言。完成度・未達・次の一手のみを簡潔に。
[禁止] 模範コード全文や具体リテラルを含む完成コードの提示。
`.trim()

type Message = { role: 'user' | 'assistant'; content: string }
type Problem = { id: string; title: string; description: string; solution_code?: string }

/* ===== 問題文ハイライト ===== */
const KW_H = /(重要|ポイント|要件|仕様|条件|制約|注意|入力|出力|手順|実装手順|目的|ヒント|制限|例|例外|評価|採点)/
const LINE_L = /^(入力|出力|条件|制約|注意|目的|手順|実装手順|ポイント|重要)[:：]/
const normalize = (t: string) => (t || '').replace(/\r\n?/g, '\n')
function highlightInline(line: string): ReactNode[] {
  if (!line) return ['']
  const out: ReactNode[] = []; let last = 0; const g = new RegExp(KW_H.source, 'g'); let m: RegExpExecArray | null
  while ((m = g.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index))
    out.push(<mark key={`${m.index}-${m[0]}`} className="bg-transparent text-rose-600 font-semibold">{m[0]}</mark>)
    last = m.index + m[0].length
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}
function renderHighlightedDescription(desc: string) {
  const lines = normalize(desc).split('\n')
  type Block = { type: 'p'; text: string } | { type: 'ul'; items: string[] } | { type: 'ol'; items: string[] }
  const blocks: Block[] = []; let current: Block | null = null
  const push = () => { if (current) blocks.push(current); current = null }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) { push(); blocks.push({ type: 'p', text: '' }); continue }
    const step = line.match(/^(\d+)[\.\)\}]?[ 　、．)](.*)$/)
    if (step) { const body = (step[2] || '').trim(); if (!current || current.type !== 'ol') { push(); current = { type: 'ol', items: [] } } ; current.items.push(body); continue }
    if (/^[-–—*・※]\s+/.test(line)) { const body = line.replace(/^[-–—*・※]\s+/, ''); if (!current || current.type !== 'ul') { push(); current = { type: 'ul', items: [] } } ; current.items.push(body); continue }
    push(); blocks.push({ type: 'p', text: line })
  }
  push()
  return (
    <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
      {blocks.map((b, i) =>
        b.type === 'ul' ? (
          <ul key={`ul-${i}`} className="list-disc pl-5 my-1 space-y-0.5">{b.items.map((it, j) => <li key={j}>{highlightInline(it)}</li>)}</ul>
        ) : b.type === 'ol' ? (
          <ol key={`ol-${i}`} className="list-decimal pl-5 my-1 space-y-0.5">{b.items.map((it, j) => <li key={j}>{highlightInline(it)}</li>)}</ol>
        ) : (
          <p key={`p-${i}`} className={KW_H.test(b.text) || LINE_L.test(b.text) ? 'py-0.5 pl-2 border-l-4 border-rose-300/70 text-gray-900' : 'py-0.5'}>
            {highlightInline(b.text)}
          </p>
        )
      )}
    </div>
  )
}

/* ===== メッセージ整形 ===== */
function parseAdviceQuestion(raw: string) {
  const lines = normalize(raw).split('\n').map((l) => l.trim())
  const adviceLine = lines.find((l) => /^アドバイス[:：]/.test(l)) || null
  const questionLine = lines.find((l) => /^質問[:：]/.test(l)) || null
  const codeLineIdx = lines.findIndex((l) => /^コード例[:：]/.test(l) || /^```/.test(l))
  const advice = adviceLine ? adviceLine.replace(/^アドバイス[:：]\s*/, '') : null
  const question = questionLine ? questionLine.replace(/^質問[:：]\s*/, '') : null
  let codeBlock = ''; if (codeLineIdx !== -1) codeBlock = lines.slice(codeLineIdx).join('\n').replace(/^コード例[:：]\s*/, '')
  const rest = lines.filter((l, i) => !(adviceLine && l === adviceLine) && !(questionLine && l === questionLine) && !(i >= codeLineIdx && codeLineIdx !== -1)).join('\n')
  return { advice, question, codeBlock, rest }
}
const EMP = /(重要|最優先|まず|次に|初期化|確認|修正|原因|手順|注意|ポイント|必ず|だけ|正しく)/
const emphasizeInline = (text: string): ReactNode[] => {
  if (!text) return ['']; const out: ReactNode[] = []; let last = 0; const g = new RegExp(EMP.source, 'g'); let m: RegExpExecArray | null
  while ((m = g.exec(text))) { if (m.index > last) out.push(text.slice(last, m.index)); out.push(<strong key={`${m.index}-${m[0]}`} className="font-semibold">{m[0]}</strong>); last = m.index + m[0].length }
  if (last < text.length) out.push(text.slice(last)); return out
}

/* ===== コード整形 ===== */
function prettyCodeAuto(code: string): string {
  let s = code.replace(/\t/g, '  ').trim()
  const semicolons = (s.match(/;/g) || []).length
  const newlines = (s.match(/\n/g) || []).length
  if (semicolons >= 2 && newlines <= 1) { s = s.split(';').map((p) => p.trim()).filter(Boolean).map((p) => p + ';').join('\n') }
  s = s.replace(/\)\s*\{/g, ') {\n').replace(/\{\s*/g, '{\n').replace(/\s*\}/g, '\n}').replace(/\n{3,}/g, '\n\n')
  const lines = s.split('\n'); let depth = 0; const out: string[] = []
  for (const line of lines) { const t = line.trim(); if (!t) { out.push(''); continue } ; if (/^[}\)]/.test(t)) depth = Math.max(0, depth - 1); out.push('  '.repeat(depth) + t); if (/[{]$/.test(t)) depth++ }
  return out.join('\n').replace(/\s+\n/g, '\n')
}

/* ===== 言語推定 ===== */
function detectLang(text: string, problem?: Problem): string {
  const src = (problem?.description || '') + '\n' + text
  if (/```(java|Java)/.test(src) || /\bclass\s+\w+\s*\{/.test(src) || /System\.out\.println/.test(src)) return 'java'
  if (/```(cpp|c\+\+)/.test(src) || /\b#include\s+</.test(src)) return 'cpp'
  if (/```c\b/.test(src)) return 'c'
  if (/```(python|py)\b/.test(src) || /\bdef\s+\w+\(.*\):/.test(src)) return 'python'
  if (/```(javascript|js|ts|typescript)\b/.test(src) || /\bfunction\s+\w+\(/.test(src)) return 'javascript'
  return 'java'
}

/* ================== 画面コンポーネント ================== */
export default function ChatPage() {
  const [input, setInput] = useState('')
  const [allMessages, setAllMessages] = useState<{ [problemId: string]: Message[] }>({})
  const [loading, setLoading] = useState(false)
  const [problems, setProblems] = useState<Problem[]>([])
  const [problem, setProblem] = useState<Problem | null>(null)
  const [gradingMode, setGradingMode] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  // ===== 解決確認（Yes/No が終わるまで送信不可） =====
  const [waitingFeedback, setWaitingFeedback] = useState(false)
  const [lastAssistantIndex, setLastAssistantIndex] = useState<number | null>(null)
  const [pendingNudge, setPendingNudge] = useState<string | null>(null) // タイマー声かけの保留

  // 継続時間トラッキング
  const [selectStartedAt, setSelectStartedAt] = useState<number | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [nudgeCount, setNudgeCount] = useState(0)
  const pad2 = (n: number) => n.toString().padStart(2, '0')
  const fmtHMS = (sec: number) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h > 0 ? `${h}:${pad2(m)}` : `${m}`) + `:${pad2(s)}` }

  const pushAssistant = (text: string, { isNudge = false }: { isNudge?: boolean } = {}) => {
    if (!problem) return
    if (isNudge && waitingFeedback) { setPendingNudge(text); return } // 衝突回避：保留
    setAllMessages((prev) => {
      const cur = prev[problem.id] || []
      return { ...prev, [problem.id]: [...cur, { role: 'assistant', content: text }] }
    })
  }

  // ガイドフォーム折りたたみ
  const [openHint, setOpenHint] = useState(false)
  const [openError, setOpenError] = useState(false)

  // 課題を進める
  const [hintQuestion, setHintQuestion] = useState('')
  const [hintCode, setHintCode] = useState('')
  const [hintContext, setHintContext] = useState('')

  // エラーを直す
  const [errWhere, setErrWhere] = useState('')
  const [errMessage, setErrMessage] = useState('')
  const [errCode, setErrCode] = useState('')
  const [errThought, setErrThought] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem('chatMessages')
    if (saved) setAllMessages(JSON.parse(saved))
    fetch('/api/problem').then((res) => res.json()).then(setProblems)
  }, [])

  useEffect(() => {
    localStorage.setItem('chatMessages', JSON.stringify(allMessages))
  }, [allMessages])

  const messages: Message[] = useMemo(
    () => (problem ? allMessages[problem.id] || [] : []),
    [problem, allMessages]
  )

  const buildSummary = (msgs: Message[]) => {
    const summaryLimit = 500
    const userText = msgs.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
    return userText.length > summaryLimit ? userText.slice(-summaryLimit) : userText
  }

  // 問題切替時：タイマーと待機状態を初期化
  useEffect(() => {
    if (!problem) {
      setSelectStartedAt(null); setElapsedSec(0); setNudgeCount(0)
      setWaitingFeedback(false); setLastAssistantIndex(null); setPendingNudge(null)
      return
    }
    const key = `selStart:${problem.id}`
    const raw = localStorage.getItem(key); const num = raw === null ? NaN : Number(raw)
    const start = Number.isFinite(num) ? num : Date.now()
    setSelectStartedAt(start); localStorage.setItem(key, String(start))
    setNudgeCount(0); setPendingNudge(null)
  }, [problem])

  /** テスト用しきい値（本番は 20*60 / 30*60 へ） */
  const NUDGE_FIRST = 20*60
  const NUDGE_SECOND = 30*60

  // 1秒タイマー＆声かけ（待機中は保留）
  useEffect(() => {
    if (!problem || !selectStartedAt) return
    const id = setInterval(() => {
      const sec = Math.floor((Date.now() - selectStartedAt) / 1000)
      setElapsedSec(sec)
      if (sec >= NUDGE_FIRST && nudgeCount === 0) {
        pushAssistant('20分間取り組んでいますね。何かわからないことがあれば何でも質問してください。', { isNudge: true })
        setNudgeCount(1)
      }
      if (sec >= NUDGE_SECOND && nudgeCount === 1) {
        pushAssistant('悩んでいる様子です。TAを呼んで一緒に解決しましょう。私に聞いても大丈夫です。', { isNudge: true })
        setNudgeCount(2)
      }
    }, 1000)
    return () => clearInterval(id)
  }, [problem, selectStartedAt, nudgeCount, waitingFeedback])

  /** 送信共通処理 */
  const sendWithContext = async (userContent: string) => {
    if (!userContent.trim() || !problem) return
    const userMessage: Message = { role: 'user', content: userContent }
    const current = [...(allMessages[problem.id] || []), userMessage]
    setAllMessages({ ...allMessages, [problem.id]: current })
    setInput(''); setLoading(true)

    const summary = buildSummary(current)
    const lang = detectLang(userContent, problem)

    const contextPrompt = gradingMode
      ? `${GRADING_PROMPT}\n\n【問題文】\n${problem.description}\n\n【模範コード】\n${problem.solution_code ?? ''}\n\n【学生の入力】\n${userContent}`
      : `${BASE_TEACHER_PROMPT(lang)}\n\n【問題文】\n${problem.description}\n\n【模範コード】\n${
          problem.solution_code ?? ''
        }\n\n【これまでの履歴要約】\n${summary}\n\n【質問/学生の考え】\n${userContent}\n\n${outputRule(lang)}`

    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: contextPrompt }),
      })
      if (!res.body) throw new Error('No response body from API')

      const reader = res.body.getReader(); const decoder = new TextDecoder('utf-8')
      let assistantText = ''
      const newAssistantMessage: Message = { role: 'assistant', content: '' }
      setAllMessages((prev) => ({ ...prev, [problem.id]: [...(prev[problem.id] || []), newAssistantMessage] }))

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n').filter((l) => l.trim().startsWith('data: ')).map((l) => l.replace(/^data: /, '')).filter((l) => l !== '' && l !== '[DONE]')
        for (const jsonStr of lines) {
          try {
            const parsed = JSON.parse(jsonStr)
            const delta = parsed.choices?.[0]?.delta?.content
            if (delta) {
              assistantText += delta
              setAllMessages((prev) => {
                const updated = [...(prev[problem.id] || [])]
                updated[updated.length - 1] = { role: 'assistant', content: assistantText }
                return { ...prev, [problem.id]: updated }
              })
            }
          } catch {/* ignore */}
        }
      }

      // ストリーム完了：このアシスタント返信に対して解決確認を要求
      setWaitingFeedback(true)
      setLastAssistantIndex((allMessages[problem.id]?.length ?? 0) + 1) // 最後のassistantのインデックスを推定保存
    } catch {
      const errMsg: Message = { role: 'assistant', content: 'エラーが発生しました。' }
      setAllMessages((prev) => ({ ...prev, [problem.id]: [...(prev[problem.id] || []), errMsg] }))
    } finally {
      setLoading(false)
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 0)
    }
  }

  const handleSend = async () => { if (!input.trim() || !problem || waitingFeedback) return; await sendWithContext(input) }
  const answerFeedback = (_resolved: boolean) => {
  // 送信解禁
  setWaitingFeedback(false)
  setLastAssistantIndex(null)

  // 保留していたタイマー通知があれば解放
  if (pendingNudge) {
    const text = pendingNudge
    setPendingNudge(null)
    setTimeout(() => pushAssistant(text), 10)
  }
}

  const formatMessageContent = (content: string): (string | { code: string })[] => {
    const regex = /```(?:[a-zA-Z0-9#+-]*)?\n([\s\S]*?)```/g
    const parts: (string | { code: string })[] = []; let last = 0; let match: RegExpExecArray | null
    while ((match = regex.exec(content))) {
      if (match.index > last) parts.push(content.slice(last, match.index))
      const raw = match[1] ?? ''; parts.push({ code: prettyCodeAuto(raw) }); last = regex.lastIndex
    }
    if (last < content.length) parts.push(content.slice(last))
    return parts
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, waitingFeedback])

  /* ============ 画面描画 ============ */
  const sendDisabled = !problem || loading || waitingFeedback
  return (
    <>
      <main className="flex h-screen">
        {/* 左：問題リスト */}
        <div className="w-1/3 bg-gray-50 border-r p-4 overflow-y-auto">
          <h2 className="font-bold mb-2">問題を選択</h2>
          {problems.map((p) => (
            <button
              key={p.id}
              onClick={() => setProblem(p)}
              className={`block w-full text-left p-2 mb-2 rounded ${problem?.id === p.id ? 'bg-blue-100' : 'hover:bg-blue-50'}`}
            >
              {p.title}
            </button>
          ))}
          <div className="mt-4 border-t pt-3">
            <h3 className="font-semibold text-sm text-gray-700 mb-2">選択中の問題</h3>
            {problem ? (
              <div className="bg-white border rounded p-3">
                <div className="text-sm font-bold mb-2">{problem.title}</div>
                {renderHighlightedDescription(problem.description || '（問題文が未設定です）')}
              </div>
            ) : (
              <div className="text-xs text-gray-500">左のリストから問題を選んでください。</div>
            )}
          </div>
        </div>

        {/* 右：チャット */}
        <div className="flex-1 p-4 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-xl font-bold">{problem?.title || '問題未選択'}</h1>
            <div className="flex items-center gap-3">
              {problem && <span className="text-xs px-2 py-1 rounded border bg-white">⏱ 継続: {fmtHMS(elapsedSec)}</span>}
              <button
                className={`border px-2 py-1 rounded text-xs ${waitingFeedback ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'}`}
                onClick={() => {
                  if (!problem || waitingFeedback) return
                  const now = Date.now()
                  setSelectStartedAt(now)
                  localStorage.setItem(`selStart:${problem.id}`, String(now))
                  setElapsedSec(0); setNudgeCount(0)
                }}
                disabled={waitingFeedback}
              >
                タイマー再開
              </button>
              <Link href="/settings" className="border px-3 py-1 rounded text-sm hover:bg-gray-50">ユーザ情報を変更</Link>
            </div>
          </div>

          <div className="flex items-center mb-4">
            <span className={!gradingMode ? 'font-bold' : 'text-gray-400'}>通常モード</span>
            <label className="mx-2 relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={gradingMode}
                onChange={(e) => setGradingMode(e.target.checked)}
                disabled={waitingFeedback}
              />
              <div className={`w-11 h-6 rounded-full transition-all ${waitingFeedback ? 'bg-gray-300' : 'bg-gray-200 peer-checked:bg-green-500'}`} />
              <div className={`absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${gradingMode ? 'translate-x-full' : ''}`} />
            </label>
            <span className={gradingMode ? 'font-bold' : 'text-gray-400'}>採点モード</span>
            {waitingFeedback && <span className="ml-3 text-xs text-rose-600">※ 解決確認に回答するまで送信できません</span>}
          </div>

          {/* ガイドフォーム（待機中は操作不可） */}
          <div className="space-y-3 mb-3">
            <div className={`border rounded-lg ${gradingMode ? 'opacity-50 pointer-events-none' : ''} ${waitingFeedback ? 'opacity-50 pointer-events-none' : ''}`}>
              <button className="w-full flex justify-between items-center px-3 py-2 text-left" onClick={() => setOpenHint((v) => !v)} disabled={!problem || gradingMode || waitingFeedback}>
                <span className="font-semibold">🧭 課題を進める（ヒント）</span>
                <span className="text-sm text-gray-500">{openHint ? '閉じる' : '開く'}</span>
              </button>
              {openHint && (
                <div className="px-3 pb-3 space-y-2">
                  <input className="w-full border p-2 rounded" placeholder="何を知りたい？" value={hintQuestion} onChange={(e) => setHintQuestion(e.target.value)} />
                  <textarea className="w-full border p-2 rounded h-24" placeholder="（任意）現在の状況/要件" value={hintContext} onChange={(e) => setHintContext(e.target.value)} />
                  <textarea className="w-full border p-2 rounded h-32 font-mono" placeholder="途中までのコード" value={hintCode} onChange={(e) => setHintCode(e.target.value)} />
                  <div className="flex justify-end">
                    <button className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50" onClick={() => problem && sendWithContext(['【モード】課題を進める（ヒント）', hintQuestion && `【知りたいこと】\n${hintQuestion}`, hintContext && `【状況/要件】\n${hintContext}`, hintCode && `【途中までのコード】\n\`\`\`\n${hintCode}\n\`\`\``, '【要望】直接の解答コードは出さず、次の一手を1つだけに絞ること。'].filter(Boolean).join('\n\n'))} disabled={sendDisabled || (!hintQuestion.trim() && !hintCode.trim() && !hintContext.trim())}>送信（ヒント）</button>
                  </div>
                </div>
              )}
            </div>

            <div className={`border rounded-lg ${gradingMode ? 'opacity-50 pointer-events-none' : ''} ${waitingFeedback ? 'opacity-50 pointer-events-none' : ''}`}>
              <button className="w-full flex justify-between items-center px-3 py-2 text-left" onClick={() => setOpenError((v) => !v)} disabled={!problem || gradingMode || waitingFeedback}>
                <span className="font-semibold">🛠️ エラーを直す</span>
                <span className="text-sm text-gray-500">{openError ? '閉じる' : '開く'}</span>
              </button>
              {openError && (
                <div className="px-3 pb-3 space-y-2">
                  <input className="w-full border p-2 rounded" placeholder="（任意）エラー箇所" value={errWhere} onChange={(e) => setErrWhere(e.target.value)} />
                  <textarea className="w-full border p-2 rounded h-20" placeholder="エラーメッセージ/想定と異なる結果" value={errMessage} onChange={(e) => setErrMessage(e.target.value)} />
                  <textarea className="w-full border p-2 rounded h-32 font-mono" placeholder="該当コード" value={errCode} onChange={(e) => setErrCode(e.target.value)} />
                  <textarea className="w-full border p-2 rounded h-20" placeholder="（任意）自分の仮説" value={errThought} onChange={(e) => setErrThought(e.target.value)} />
                  <div className="flex justify-end">
                    <button className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50" onClick={() => problem && sendWithContext(['【モード】エラーを直す', errWhere && `【エラー箇所】\n${errWhere}`, errMessage && `【エラー内容/想定と異なる結果】\n${errMessage}`, errCode && `【該当コード】\n\`\`\`\n${errCode}\n\`\`\``, errThought && `【自分の仮説】\n${errThought}`, '【要望】根本原因の仮説→観察/出力→修正方針の最優先の一手だけ。'].filter(Boolean).join('\n\n'))} disabled={sendDisabled || (!errWhere.trim() && !errMessage.trim() && !errCode.trim() && !errThought.trim())}>送信（エラー診断）</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* メッセージ表示 */}
          <div className="flex-1 space-y-4 overflow-y-auto">
            {messages.map((msg: Message, idx: number) => {
              const bubble = (
                <div className={`p-3 rounded max-w-[75%] whitespace-pre-wrap break-words ${msg.role === 'user' ? 'bg-blue-100' : 'bg-green-50'}`}>
                  {(() => {
                    const parts = (() => {
                      const regex = /```(?:[a-zA-Z0-9#+-]*)?\n([\s\S]*?)```/g
                      const res: (string | { code: string })[] = []; let last = 0; let m: RegExpExecArray | null
                      while ((m = regex.exec(msg.content))) { if (m.index > last) res.push(msg.content.slice(last, m.index)); res.push({ code: prettyCodeAuto(m[1] ?? '') }); last = regex.lastIndex }
                      if (last < msg.content.length) res.push(msg.content.slice(last))
                      return res
                    })()
                    return parts.map((p, i) =>
                      typeof p === 'string' ? <p key={i}>{p}</p> :
                        <pre key={i} className="bg-gray-200 p-2 rounded overflow-x-auto text-sm"><code>{p.code}</code></pre>
                    )
                  })()}
                </div>
              )

              // assistant の直後に解決確認 UI
              if (msg.role === 'assistant' && waitingFeedback && (lastAssistantIndex === null || idx >= (lastAssistantIndex ?? 0))) {
                const { advice, question, codeBlock, rest } = parseAdviceQuestion(msg.content)
                return (
                  <div key={idx} className="space-y-2">
                    <div className="flex justify-start">
                      <div className="p-3 rounded max-w-[75%] bg-green-50 whitespace-pre-wrap break-words space-y-2">
                        {advice && <p className="leading-relaxed">{emphasizeInline(advice)}</p>}
                        {question && <p className="leading-relaxed font-semibold">{emphasizeInline(question)}</p>}
                        {codeBlock && (
                          <div>
                            {formatMessageContent(codeBlock).map((part, i) =>
                              typeof part === 'string' ? <p key={i}>{part}</p> :
                                <pre key={i} className="bg-gray-200 p-2 rounded overflow-x-auto text-sm"><code>{part.code}</code></pre>
                            )}
                          </div>
                        )}
                        {rest && <p>{rest}</p>}
                      </div>
                    </div>
                    {/* 解決確認 UI */}
                    <div className="flex justify-start">
                      <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded px-3 py-2 text-sm flex items-center gap-2">
                        <span>この回答で問題は解決できましたか？</span>
                        <button className="px-2 py-1 rounded bg-emerald-600 text-white hover:opacity-90" onClick={() => answerFeedback(true)}>はい</button>
                        <button className="px-2 py-1 rounded bg-rose-600 text-white hover:opacity-90" onClick={() => answerFeedback(false)}>いいえ</button>
                      </div>
                    </div>
                  </div>
                )
              }

              return (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {bubble}
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          {/* 自由入力 */}
          <div className="mt-4">
            <AutoGrowTextarea
              value={input}
              placeholder={problem ? (waitingFeedback ? '（まず「解決できましたか？」に回答してください）' : '自由入力（Enterで送信、Shift+Enterで改行 / Tabでインデント）') : 'まず問題を選んでください'}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (waitingFeedback) return
                if (e.key === 'Tab') {
                  e.preventDefault()
                  const el = e.currentTarget
                  const start = el.selectionStart ?? 0
                  const end = el.selectionEnd ?? 0
                  const indent = '  '
                  const next = input.slice(0, start) + indent + input.slice(end)
                  setInput(next)
                  requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + indent.length })
                }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
              }}
              maxVh={70}
              disabled={waitingFeedback || !problem}
            />
            <div className="mt-1 flex items-center justify-between text-xs text-gray-600">
              <div>{input.split('\n').length} 行 / {input.length} 文字</div>
              <button className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50" onClick={handleSend} disabled={sendDisabled || !input.trim()}>
                {loading ? '送信中...' : '自由入力で送信'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
