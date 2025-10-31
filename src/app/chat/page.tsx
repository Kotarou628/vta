'use client'

import { useEffect, useMemo, useRef, useState, ReactNode } from 'react'
import Link from 'next/link'

/** 通常モード：出力形式の厳守（アドバイス1行 + 質問1行） */
const TEACHER_PROMPT = `
[役割] プログラミングを正しく教えられる教員。
[禁止] 解答コードは絶対に出さない（必要最小限の断片は可）。
[方針] 逆質問（ソクラテス式）でヒント提示。
[出力] 簡潔に、質問にだけ答える（最大5行）。
[出力形式(厳守)]
アドバイス: 学習者が今やるべき具体的行動を1つだけ、最大2文で提示。
質問: 逆質問を1つだけ提示し、必ず「?」で終える。
※ 箇条書き禁止。上の2行以外は書かない。`.trim()

/** 採点モード：★変更しない（ご要望通り） */
const GRADING_PROMPT = `
[役割] 教員として採点・助言を行う。
[比較] 模範コードと学生コードを比較し、未達箇所を抽出。
[出力]
- 完成度: XX%（根拠を簡潔に）
- 未達/不正確: 問題文の該当箇所を短く列挙（なければ不要）
- 次の一手: 実装/修正すべき箇所を1〜3点（なければ不要）
- すべて正しく実装されていた場合は、「あなたのコードは完璧です。」とだけ表示
[禁止] 模範コードの全文貼付は禁止。
[追加] 現時点のコードに対して簡単なテストコードも提示（部分的でよい）`.trim()

type Message = { role: 'user' | 'assistant', content: string }
type Problem = {
  id: string
  title: string
  description: string
  solution_code?: string
}

/* ===== 問題文ハイライト ===== */
const KW_HIGHLIGHT = /(重要|ポイント|要件|仕様|条件|制約|注意|入力|出力|手順|実装手順|目的|ヒント|制限|例|例外|評価|採点)/g
const LINE_LABELS = /^(入力|出力|条件|制約|注意|目的|手順|実装手順|ポイント|重要)[:：]/

const normalize = (t: string) => (t || '').replace(/\r\n?/g, '\n')

function highlightInline(line: string): ReactNode[] {
  if (!line) return ['']
  const out: ReactNode[] = []
  let last = 0
  const g = new RegExp(KW_HIGHLIGHT, 'g')
  let m: RegExpExecArray | null
  while ((m = g.exec(line))) {
    const hit = m[0]
    if (m.index > last) out.push(line.slice(last, m.index))
    out.push(<mark key={`${m.index}-${hit}`} className="bg-transparent text-rose-600 font-semibold">{hit}</mark>)
    last = m.index + hit.length
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}

function renderHighlightedDescription(desc: string) {
  const lines = normalize(desc).split('\n')

  type Block =
    | { type: 'p'; text: string }
    | { type: 'ul'; items: string[] }
    | { type: 'ol'; items: string[] }

  const blocks: Block[] = []
  let current: Block | null = null
  const push = () => { if (current) blocks.push(current); current = null }

  for (const raw of lines) {
    const line = raw.trim()

    if (!line) { push(); blocks.push({ type: 'p', text: '' }); continue }

    const step = line.match(/^(\d+)[\.\)\}]?[ 　、．)](.*)$/)
    if (step) {
      const body = (step[2] || '').trim()
      if (!current || current.type !== 'ol') { push(); current = { type: 'ol', items: [] } }
      current.items.push(body)
      continue
    }

    if (/^[-–—*・※]\s+/.test(line)) {
      const body = line.replace(/^[-–—*・※]\s+/, '')
      if (!current || current.type !== 'ul') { push(); current = { type: 'ul', items: [] } }
      current.items.push(body)
      continue
    }

    push()
    blocks.push({ type: 'p', text: line })
  }
  push()

  return (
    <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
      {blocks.map((b, i) => {
        if (b.type === 'ul') {
          return (
            <ul key={`ul-${i}`} className="list-disc pl-5 my-1 space-y-0.5">
              {b.items.map((it, j) => <li key={j}>{highlightInline(it)}</li>)}
            </ul>
          )
        }
        if (b.type === 'ol') {
          return (
            <ol key={`ol-${i}`} className="list-decimal pl-5 my-1 space-y-0.5">
              {b.items.map((it, j) => <li key={j}>{highlightInline(it)}</li>)}
            </ol>
          )
        }
        const isImportant = KW_HIGHLIGHT.test(b.text) || LINE_LABELS.test(b.text)
        return (
          <p
            key={`p-${i}`}
            className={isImportant ? 'py-0.5 pl-2 border-l-4 border-rose-300/70 text-gray-900' : 'py-0.5'}
          >
            {highlightInline(b.text)}
          </p>
        )
      })}
    </div>
  )
}

/* ====== アドバイス/質問の表示整形（ラベルを隠して強調） ====== */

/** 「アドバイス:」「質問:」の2行を抽出し、ラベルは除去 */
function parseAdviceQuestion(raw: string) {
  const lines = normalize(raw).split('\n').map(l => l.trim()).filter(Boolean)
  const adviceLine = lines.find(l => /^アドバイス[:：]/.test(l))
  const questionLine = lines.find(l => /^質問[:：]/.test(l))
  const advice = adviceLine ? adviceLine.replace(/^アドバイス[:：]\s*/, '') : null
  const question = questionLine ? questionLine.replace(/^質問[:：]\s*/, '') : null
  return { advice, question }
}

/** 重要そうな語を太字に。必要なら語を調整してください。 */
const EMPHASIS = /(重要|最優先|まず|次に|初期化|確認|修正|原因|手順|注意|ポイント|必ず|だけ|正しく)/g
function emphasizeInline(text: string): ReactNode[] {
  if (!text) return ['']
  const out: ReactNode[] = []
  let last = 0
  const g = new RegExp(EMPHASIS, 'g')
  let m: RegExpExecArray | null
  while ((m = g.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<strong key={`${m.index}-${m[0]}`} className="font-semibold">{m[0]}</strong>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export default function ChatPage() {
  const [input, setInput] = useState('')
  const [allMessages, setAllMessages] = useState<{ [problemId: string]: Message[] }>({})
  const [loading, setLoading] = useState(false)
  const [problems, setProblems] = useState<Problem[]>([])
  const [problem, setProblem] = useState<Problem | null>(null)
  const [gradingMode, setGradingMode] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  // ガイドフォーム
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
    fetch('/api/problem').then(res => res.json()).then(setProblems)
  }, [])

  useEffect(() => {
    localStorage.setItem('chatMessages', JSON.stringify(allMessages))
  }, [allMessages])

  const messages: Message[] = useMemo(
    () => (problem ? allMessages[problem.id] || [] : []),
    [problem, allMessages]
  )

  const buildSummary = (messages: Message[]) => {
    const summaryLimit = 500
    const userText = messages.filter(m => m.role === 'user').map(m => m.content).join('\n')
    return userText.length > summaryLimit ? userText.slice(-summaryLimit) : userText
  }

  /** 送信共通処理 */
  const sendWithContext = async (userContent: string) => {
    if (!userContent.trim() || !problem) return

    const userMessage: Message = { role: 'user', content: userContent }
    const current = [...(allMessages[problem.id] || []), userMessage]
    setAllMessages({ ...allMessages, [problem.id]: current })
    setInput('')
    setLoading(true)

    const summary = buildSummary(current)

    // 通常モードだけ出力形式を強制。採点モードは一切変更しない。
    const OUTPUT_RULE = `
【出力形式(厳守)】
アドバイス: 学習者が今やるべき具体的行動を1つだけ、最大2文。
質問: 逆質問を1つだけ、必ず「?」で終える。
※ 箇条書きや追加の段落は禁止。上の2行のみ出力。`.trim()

    const contextPrompt = gradingMode
      ? `${GRADING_PROMPT}\n\n【問題文】\n${problem.description}\n\n【模範コード】\n${problem.solution_code ?? ''}\n\n【学生の入力】\n${userContent}`
      : `${TEACHER_PROMPT}\n\n【問題文】\n${problem.description}\n\n【模範コード】\n${problem.solution_code ?? ''}\n\n【これまでの履歴要約】\n${summary}\n\n【質問/学生の考え】\n${userContent}\n\n${OUTPUT_RULE}`

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: contextPrompt }),
      })
      if (!res.body) throw new Error('No response body from API')
      const reader = res.body.getReader()
      const decoder = new TextDecoder('utf-8')

      let assistantText = ''
      const newAssistantMessage: Message = { role: 'assistant', content: '' }
      setAllMessages(prev => ({
        ...prev,
        [problem.id]: [...(prev[problem.id] || []), newAssistantMessage],
      }))

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')
          .filter(l => l.trim().startsWith('data: '))
          .map(l => l.replace(/^data: /, ''))
          .filter(l => l !== '' && l !== '[DONE]')

        for (const jsonStr of lines) {
          try {
            const parsed = JSON.parse(jsonStr)
            const delta = parsed.choices?.[0]?.delta?.content
            if (delta) {
              assistantText += delta
              setAllMessages(prev => {
                const updated = [...(prev[problem.id] || [])]
                updated[updated.length - 1] = { role: 'assistant', content: assistantText }
                return { ...prev, [problem.id]: updated }
              })
            }
          } catch (e) {
            console.error('ストリームJSON解析エラー:', e)
          }
        }
      }
    } catch (e) {
      console.error('エラー:', e)
      const errMsg: Message = { role: 'assistant', content: 'エラーが発生しました。' }
      setAllMessages(prev => ({
        ...prev,
        [problem.id]: [...(prev[problem.id] || []), errMsg]
      }))
    } finally {
      setLoading(false)
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 0)
    }
  }

  // 自由入力
  const handleSend = async () => {
    if (!input.trim() || !problem) return
    await sendWithContext(input)
  }

  // ガイドプロンプト
  const buildHintPrompt = () => [
    '【モード】課題を進める（ヒント）',
    hintQuestion && `【知りたいこと】\n${hintQuestion}`,
    hintContext && `【状況/要件】\n${hintContext}`,
    hintCode && `【途中までのコード】\n\`\`\`\n${hintCode}\n\`\`\``,
    '【要望】直接の解答コードは出さず、次の一手を1つだけに絞ること。'
  ].filter(Boolean).join('\n\n')

  const buildErrorPrompt = () => [
    '【モード】エラーを直す',
    errWhere && `【エラー箇所】\n${errWhere}`,
    errMessage && `【エラー内容/想定と異なる結果】\n${errMessage}`,
    errCode && `【該当コード】\n\`\`\`\n${errCode}\n\`\`\``,
    errThought && `【自分の仮説】\n${errThought}`,
    '【要望】根本原因の仮説→確認のための観察/出力→修正方針、に沿って最優先の一手だけ。'
  ].filter(Boolean).join('\n\n')

  const handleSendHint  = async () => { if (problem) await sendWithContext(buildHintPrompt()) }
  const handleSendError = async () => { if (problem) await sendWithContext(buildErrorPrompt()) }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const formatMessageContent = (content: string): (string | { code: string })[] => {
    const regex = /```(?:[a-z]*)?\n([\s\S]*?)```/g
    const parts: (string | { code: string })[] = []
    let last = 0, match
    while ((match = regex.exec(content))) {
      if (match.index > last) parts.push(content.slice(last, match.index))
      parts.push({ code: match[1] })
      last = regex.lastIndex
    }
    if (last < content.length) parts.push(content.slice(last))
    return parts
  }

  // 入力チェック（空なら送信不可）
  const hintEmpty =
    !hintQuestion.trim() && !hintCode.trim() && !hintContext.trim()

  const errEmpty =
    !errWhere.trim() && !errMessage.trim() && !errCode.trim() && !errThought.trim()

  return (
    <main className="flex h-screen">
      {/* 左：問題リスト＋ハイライト付き表示 */}
      <div className="w-1/3 bg-gray-50 border-r p-4 overflow-y-auto">
        <h2 className="font-bold mb-2">問題を選択</h2>
        {problems.map(p => (
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

      {/* 右：チャット＆フォーム */}
      <div className="flex-1 p-4 flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-xl font-bold">{problem?.title || '問題未選択'}</h1>
          <Link href="/settings" className="border px-3 py-1 rounded text-sm hover:bg-gray-50">
            ユーザ情報を変更
          </Link>
        </div>

        <div className="flex items-center mb-4">
          <span className={!gradingMode ? 'font-bold' : 'text-gray-400'}>通常モード</span>
          <label className="mx-2 relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={gradingMode}
              onChange={e => setGradingMode(e.target.checked)}
            />
            <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:bg-green-500 transition-all" />
            <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow peer-checked:translate-x-full transition-all" />
          </label>
          <span className={gradingMode ? 'font-bold' : 'text-gray-400'}>採点モード</span>
        </div>

        {/* ガイドフォーム */}
        <div className="space-y-3 mb-3">
          {/* 🧭 課題を進める */}
          <div className={`border rounded-lg ${gradingMode ? 'opacity-50 pointer-events-none' : ''}`}>
            <button
              className="w-full flex justify-between items-center px-3 py-2 text-left"
              onClick={() => setOpenHint(v => !v)}
              disabled={!problem || gradingMode}
            >
              <span className="font-semibold">🧭 課題を進める（ヒント）</span>
              <span className="text-sm text-gray-500">{openHint ? '閉じる' : '開く'}</span>
            </button>
            {openHint && (
              <div className="px-3 pb-3 space-y-2">
                <input
                  className="w-full border p-2 rounded"
                  placeholder="何を知りたい？"
                  value={hintQuestion}
                  onChange={e => setHintQuestion(e.target.value)}
                />
                <textarea
                  className="w-full border p-2 rounded h-24"
                  placeholder="（任意）現在の状況/要件"
                  value={hintContext}
                  onChange={e => setHintContext(e.target.value)}
                />
                <textarea
                  className="w-full border p-2 rounded h-32 font-mono"
                  placeholder="途中までのコード"
                  value={hintCode}
                  onChange={e => setHintCode(e.target.value)}
                />
                <div className="flex justify-end">
                  <button
                    className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
                    onClick={handleSendHint}
                    disabled={loading || !problem || gradingMode || hintEmpty}
                  >
                    送信（ヒント）
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 🛠️ エラーを直す */}
          <div className={`border rounded-lg ${gradingMode ? 'opacity-50 pointer-events-none' : ''}`}>
            <button
              className="w-full flex justify-between items-center px-3 py-2 text-left"
              onClick={() => setOpenError(v => !v)}
              disabled={!problem || gradingMode}
            >
              <span className="font-semibold">🛠️ エラーを直す</span>
              <span className="text-sm text-gray-500">{openError ? '閉じる' : '開く'}</span>
            </button>
            {openError && (
              <div className="px-3 pb-3 space-y-2">
                <input
                  className="w-full border p-2 rounded"
                  placeholder="（任意）エラー箇所（例: Main.javaの25行目）"
                  value={errWhere}
                  onChange={e => setErrWhere(e.target.value)}
                />
                <textarea
                  className="w-full border p-2 rounded h-20"
                  placeholder="エラーメッセージ/想定と異なる結果"
                  value={errMessage}
                  onChange={e => setErrMessage(e.target.value)}
                />
                <textarea
                  className="w-full border p-2 rounded h-32 font-mono"
                  placeholder="該当コード"
                  value={errCode}
                  onChange={e => setErrCode(e.target.value)}
                />
                <textarea
                  className="w-full border p-2 rounded h-20"
                  placeholder="（任意）自分の仮説"
                  value={errThought}
                  onChange={e => setErrThought(e.target.value)}
                />
                <div className="flex justify-end">
                  <button
                    className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
                    onClick={handleSendError}
                    disabled={loading || !problem || gradingMode || errEmpty}
                  >
                    送信（エラー診断）
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* メッセージ表示（アシスタント返答はラベル非表示＆太字強調） */}
        <div className="flex-1 space-y-4 overflow-y-auto">
          {messages.map((msg: Message, idx: number) => {
            if (msg.role === 'assistant') {
              const { advice, question } = parseAdviceQuestion(msg.content)
              if (advice || question) {
                return (
                  <div key={idx} className="flex justify-start">
                    <div className="p-3 rounded max-w-[75%] bg-green-50 whitespace-pre-wrap break-words">
                      {advice && (
                        <p className="leading-relaxed mb-2">
                          {emphasizeInline(advice)}
                        </p>
                      )}
                      {question && (
                        <p className="leading-relaxed font-semibold">
                          {emphasizeInline(question)}
                        </p>
                      )}
                      {/* ラベル形式でない場合の保険 */}
                      {!advice && !question && formatMessageContent(msg.content).map((part, i) =>
                        typeof part === 'string'
                          ? <p key={i}>{part}</p>
                          : <pre key={i} className="bg-gray-200 p-2 rounded"><code>{part.code}</code></pre>
                      )}
                    </div>
                  </div>
                )
              }
            }

            // ユーザ or フォールバック
            return (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`p-3 rounded max-w-[75%] whitespace-pre-wrap break-words ${msg.role === 'user' ? 'bg-blue-100' : 'bg-green-50'}`}>
                  {formatMessageContent(msg.content).map((part, i) =>
                    typeof part === 'string'
                      ? <p key={i}>{part}</p>
                      : <pre key={i} className="bg-gray-200 p-2 rounded"><code>{part.code}</code></pre>
                  )}
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {/* 自由入力 */}
        <div className="mt-4">
          <textarea
            className="w-full border p-2 rounded h-24 resize-none"
            value={input}
            placeholder={problem ? '自由入力（Enterで送信、Shift+Enterで改行）' : 'まず問題を選んでください'}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            disabled={!problem}
          />
          <div className="flex justify-end mt-2">
            <button
              className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
              onClick={handleSend}
              disabled={!input.trim() || loading || !problem}
            >
              {loading ? '送信中...' : '自由入力で送信'}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
