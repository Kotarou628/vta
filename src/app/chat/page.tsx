'use client'

import { useEffect, useMemo, useRef, useState, ReactNode } from 'react'
import Link from 'next/link'

/**
 * 教員モードのベースプロンプト（抽象度は「型は抽象語・識別子は問題準拠」）
 * テンプレ内のコードフェンスは \` でエスケープ（\`\`\`）する。
 * ★模範コード（solution_code）に示された抽象度・記法に厳密準拠★
 */
const BASE_TEACHER_PROMPT = (lang: string) => String.raw`
[役割] プログラミングを正しく教えられる教員。  
学習者が「いま質問した箇所だけ」を対象に説明し、それ以外の部分は出力しない。  
目的は、学習者が自分のコードの“どの位置に何を書くか”を理解すること。

[出力範囲の制限（最重要）]
- 学習者が質問した箇所（例: フィールド宣言・コンストラクタの一部など）以外の要素を一切出してはいけない。  
  例: 質問が「インスタンスフィールド」に関するものであれば、toStringやmainを出してはならない。
- 「全体像」や「次に書く部分」を先回りして出すことは禁止。
- 質問に含まれない範囲は「// …（この部分はまだ扱わない）」として省略してよい。

[最優先禁止ルール]
- 問題文や模範コードに「〜を宣言/定義しなさい」とある行を完成させてはならない（完成コードの提示禁止）。
- そうした行は「// ここに <...> を書く」「// ここに <...> を宣言する」と**位置だけ**示す。
- 模範コードに存在しない要素（不要なメソッド・補助クラス・アクセス修飾子・具体リテラルなど）を**新規に追加しない**。

[抽象度の基準（模範コード準拠・固定）]
- 型は**抽象語**で表す（例: <整数型>, <文字列型>, <文字列配列型>, <整数配列型>）。
- **識別子は問題/模範コードで明示されたもののみ**使う（例: id, name, subject, score, Person1）。
- 配列リテラルは**形だけ**を示す（{ "<要素1>", "<要素2>" } / { <要素1>, <要素2> }）。  
  "math", "english", 0 といった具体値は出さない。
- **記法は模範コードに合わせる**：例）subject/score の初期化は \`{...}\` リテラルのみ。\`new String[]{...}\` のように**別記法へ変更しない**。
- 模範コードに無い修飾（public/private 等）や順序変更をしない。**順序と行構造を尊重**する。

[抽象度逸脱の扱い]
- 学習者の入力に具体リテラル等が含まれていても、回答では**プレースホルダに置換**して示す（例: "math" → "<要素1>"）。
- 完成コード化しそうな場合は、**位置と意図だけ**をコメントで指示する。

[逆質問（概念理解を促す）]
- 「どの部分を自分が埋める必要があるか／どの行はまだ書かないか」を説明させる問いにする。必ず「?」で終える。

[コード出力ルール]
- フェンス付きコード（\`\`\`${lang} ... \`\`\`）で出力。
- 1行目に「// この部分の骨組み」と書く。
- 各行に日本語コメントで役割を説明する。
- **模範コードの抽象度・記法・順序に一致**させる（言い換えや別表現にしない）。
- 質問範囲外の構造（toString, main 等）は出さない。

[出力形式(厳守)]
アドバイス: 学習者が「次に自分で書くべき行・位置」を3〜5文で説明する。  
質問: 学習者が「自分が書くべき部分」と「与えられている部分」の違いを説明できるか確認する問いを1つだけ（必ず「?」で終える）。  
コード例: 質問で触れた範囲だけを \`\`\`${lang}\`\`\` で示す。**型は抽象語**（<整数型> など）、**識別子は問題/模範コードで指定のもののみ**。**具体リテラルは入れない**。
`.trim()

/** 出力形式の追加縛り（コードフェンスはエスケープ済み） */
const outputRule = (lang: string) => String.raw`
【出力形式(再確認)】
アドバイス: 最大5文。問題にまだ出ていないフィールド・配列・初期値は書かないこと。
質問: 「この時点では○○を書かなくてよい」と学習者に言わせる質問にすること。
コード例: \`\`\`${lang} から始め、<...> の抽象語のみ。**模範コードにない識別子・修飾子・書式は使わない**。  
　　　　具体値（"math", 0 等）や \`new 型[]{...}\` の導入は禁止。**{ "<要素1>", "<要素2>" } / { <要素1>, <要素2> } の形だけ**。
`.trim()

/** 採点モード（抽象度・記法の準拠度も評価） */
const GRADING_PROMPT = String.raw`
[役割] 教員として採点・助言を行う。
[比較] 模範コードと学生コードを比較し、未達箇所を抽出。
[評価観点]
- 機能面の正しさ
- **抽象度の一致**（型は抽象語、識別子は問題/模範コード準拠、具体リテラル非使用）
- **記法の一致**（配列初期化は \{…\} リテラル等、模範コードと同一記法・順序）
[出力]
- 完成度: XX%（根拠を簡潔に）
- 未達/不正確: 問題文・模範コードの該当箇所を短く列挙（なければ不要）
- 次の一手: 実装/修正すべき箇所を1〜3点（なければ不要）
- すべて正しく実装されていた場合は、「あなたのコードは完璧です。」とだけ表示
[禁止]
- 模範コードの全文貼付は禁止。
- 具体リテラル（"math", 0 等）を含む完成コードの提示は禁止。
[追加]
- 現時点のコードに対して**抽象的な形**のテスト観点やチェック箇所を提示（例: 「フィールド順序」「配列リテラルの書式」「引数順」）。コード全文は不要。
`.trim()

type Message = { role: 'user' | 'assistant'; content: string }
type Problem = { id: string; title: string; description: string; solution_code?: string }

/* ===== 問題文ハイライト ===== */
const KW_HIGHLIGHT = /(重要|ポイント|要件|仕様|条件|制約|注意|入力|出力|手順|実装手順|目的|ヒント|制限|例|例外|評価|採点)/
const LINE_LABELS = /^(入力|出力|条件|制約|注意|目的|手順|実装手順|ポイント|重要)[:：]/
const normalize = (t: string) => (t || '').replace(/\r\n?/g, '\n')

function highlightInline(line: string): ReactNode[] {
  if (!line) return ['']
  const out: ReactNode[] = []
  let last = 0
  const g = new RegExp(KW_HIGHLIGHT.source, 'g')
  let m: RegExpExecArray | null
  while ((m = g.exec(line))) {
    const hit = m[0]
    if (m.index > last) out.push(line.slice(last, m.index))
    out.push(
      <mark key={`${m.index}-${hit}`} className="bg-transparent text-rose-600 font-semibold">
        {hit}
      </mark>
    )
    last = m.index + hit.length
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}

function renderHighlightedDescription(desc: string) {
  const lines = normalize(desc).split('\n')
  type Block = { type: 'p'; text: string } | { type: 'ul'; items: string[] } | { type: 'ol'; items: string[] }

  const blocks: Block[] = []
  let current: Block | null = null
  const push = () => {
    if (current) blocks.push(current)
    current = null
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      push()
      blocks.push({ type: 'p', text: '' })
      continue
    }

    const step = line.match(/^(\d+)[\.\)\}]?[ 　、．)](.*)$/)
    if (step) {
      const body = (step[2] || '').trim()
      if (!current || current.type !== 'ol') {
        push()
        current = { type: 'ol', items: [] }
      }
      current.items.push(body)
      continue
    }

    if (/^[-–—*・※]\s+/.test(line)) {
      const body = line.replace(/^[-–—*・※]\s+/, '')
      if (!current || current.type !== 'ul') {
        push()
        current = { type: 'ul', items: [] }
      }
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
              {b.items.map((it, j) => (
                <li key={j}>{highlightInline(it)}</li>
              ))}
            </ul>
          )
        }
        if (b.type === 'ol') {
          return (
            <ol key={`ol-${i}`} className="list-decimal pl-5 my-1 space-y-0.5">
              {b.items.map((it, j) => (
                <li key={j}>{highlightInline(it)}</li>
              ))}
            </ol>
          )
        }
        const isImportant = KW_HIGHLIGHT.test(b.text) || LINE_LABELS.test(b.text)
        return (
          <p key={`p-${i}`} className={isImportant ? 'py-0.5 pl-2 border-l-4 border-rose-300/70 text-gray-900' : 'py-0.5'}>
            {highlightInline(b.text)}
          </p>
        )
      })}
    </div>
  )
}

/* ===== アドバイス/質問/コードの表示整形 ===== */
function parseAdviceQuestion(raw: string) {
  const lines = normalize(raw)
    .split('\n')
    .map((l) => l.trim())
  const adviceLine = lines.find((l) => /^アドバイス[:：]/.test(l)) || null
  const questionLine = lines.find((l) => /^質問[:：]/.test(l)) || null
  const codeLineIdx = lines.findIndex((l) => /^コード例[:：]/.test(l) || /^```/.test(l))

  const advice = adviceLine ? adviceLine.replace(/^アドバイス[:：]\s*/, '') : null
  const question = questionLine ? questionLine.replace(/^質問[:：]\s*/, '') : null

  let codeBlock = ''
  if (codeLineIdx !== -1) codeBlock = lines.slice(codeLineIdx).join('\n').replace(/^コード例[:：]\s*/, '')

  const restLines = lines.filter((l, i) => {
    if (adviceLine && l === adviceLine) return false
    if (questionLine && l === questionLine) return false
    if (i >= codeLineIdx && codeLineIdx !== -1) return false
    return l.length > 0
  })
  const rest = restLines.join('\n')

  return { advice, question, codeBlock, rest }
}

const EMPHASIS = /(重要|最優先|まず|次に|初期化|確認|修正|原因|手順|注意|ポイント|必ず|だけ|正しく)/
function emphasizeInline(text: string): ReactNode[] {
  if (!text) return ['']
  const out: ReactNode[] = []
  let last = 0
  const g = new RegExp(EMPHASIS.source, 'g')
  let m: RegExpExecArray | null
  while ((m = g.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<strong key={`${m.index}-${m[0]}`} className="font-semibold">{m[0]}</strong>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/* ===== フェンス内コードの自動整形 ===== */
function prettyCodeAuto(code: string): string {
  let s = code.replace(/\t/g, '  ').trim()

  const semicolons = (s.match(/;/g) || []).length
  const newlines = (s.match(/\n/g) || []).length
  if (semicolons >= 2 && newlines <= 1) {
    s = s
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part + ';')
      .join('\n')
  }

  s = s.replace(/\)\s*\{/g, ') {\n')
  s = s.replace(/\{\s*/g, '{\n')
  s = s.replace(/\s*\}/g, '\n}')
  s = s.replace(/\n{3,}/g, '\n\n')

  const lines = s.split('\n')
  let depth = 0
  const out: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      out.push('')
      continue
    }
    if (/^[}\)]/.test(trimmed)) depth = Math.max(0, depth - 1)
    out.push('  '.repeat(depth) + trimmed)
    if (/[{]$/.test(trimmed)) depth++
  }
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

/* ===== 画面コンポーネント ===== */
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
    fetch('/api/problem').then((res) => res.json()).then(setProblems)
  }, [])

  useEffect(() => {
    localStorage.setItem('chatMessages', JSON.stringify(allMessages))
  }, [allMessages])

  const messages: Message[] = useMemo(() => (problem ? allMessages[problem.id] || [] : []), [problem, allMessages])

  const buildSummary = (msgs: Message[]) => {
    const summaryLimit = 500
    const userText = msgs.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
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
    const lang = detectLang(userContent, problem)

    const contextPrompt = gradingMode
      ? `${GRADING_PROMPT}\n\n【問題文】\n${problem.description}\n\n【模範コード】\n${problem.solution_code ?? ''}\n\n【学生の入力】\n${userContent}`
      : `${BASE_TEACHER_PROMPT(lang)}\n\n【問題文】\n${problem.description}\n\n【模範コード】\n${
          problem.solution_code ?? ''
        }\n\n【これまでの履歴要約】\n${summary}\n\n【質問/学生の考え】\n${userContent}\n\n${outputRule(lang)}`

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: contextPrompt })
      })
      if (!res.body) throw new Error('No response body from API')

      const reader = res.body.getReader()
      const decoder = new TextDecoder('utf-8')

      let assistantText = ''
      const newAssistantMessage: Message = { role: 'assistant', content: '' }
      setAllMessages((prev) => ({
        ...prev,
        [problem.id]: [...(prev[problem.id] || []), newAssistantMessage]
      }))

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk
          .split('\n')
          .filter((l) => l.trim().startsWith('data: '))
          .map((l) => l.replace(/^data: /, ''))
          .filter((l) => l !== '' && l !== '[DONE]')

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
          } catch {
            // ストリーム断片のJSON化に失敗しても続行
          }
        }
      }
    } catch {
      const errMsg: Message = { role: 'assistant', content: 'エラーが発生しました。' }
      setAllMessages((prev) => ({
        ...prev,
        [problem.id]: [...(prev[problem.id] || []), errMsg]
      }))
    } finally {
      setLoading(false)
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 0)
    }
  }

  const handleSend = async () => {
    if (!input.trim() || !problem) return
    await sendWithContext(input)
  }

  const buildHintPrompt = () =>
    [
      '【モード】課題を進める（ヒント）',
      hintQuestion && `【知りたいこと】\n${hintQuestion}`,
      hintContext && `【状況/要件】\n${hintContext}`,
      hintCode && `【途中までのコード】\n\`\`\`\n${hintCode}\n\`\`\``,
      '【要望】直接の解答コードは出さず、次の一手を1つだけに絞ること。'
    ]
      .filter(Boolean)
      .join('\n\n')

  const buildErrorPrompt = () =>
    [
      '【モード】エラーを直す',
      errWhere && `【エラー箇所】\n${errWhere}`,
      errMessage && `【エラー内容/想定と異なる結果】\n${errMessage}`,
      errCode && `【該当コード】\n\`\`\`\n${errCode}\n\`\`\``,
      errThought && `【自分の仮説】\n${errThought}`,
      '【要望】根本原因の仮説→確認のための観察/出力→修正方針、に沿って最優先の一手だけ。'
    ]
      .filter(Boolean)
      .join('\n\n')

  const handleSendHint = async () => {
    if (problem) await sendWithContext(buildHintPrompt())
  }
  const handleSendError = async () => {
    if (problem) await sendWithContext(buildErrorPrompt())
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const formatMessageContent = (content: string): (string | { code: string })[] => {
    const regex = /```(?:[a-zA-Z0-9#+-]*)?\n([\s\S]*?)```/g
    const parts: (string | { code: string })[] = []
    let last = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(content))) {
      if (match.index > last) parts.push(content.slice(last, match.index))
      const raw = match[1] ?? ''
      parts.push({ code: prettyCodeAuto(raw) })
      last = regex.lastIndex
    }
    if (last < content.length) parts.push(content.slice(last))
    return parts
  }

  const hintEmpty = !hintQuestion.trim() && !hintCode.trim() && !hintContext.trim()
  const errEmpty = !errWhere.trim() && !errMessage.trim() && !errCode.trim() && !errThought.trim()

  return (
    <main className="flex h-screen">
      {/* 左：問題リスト */}
      <div className="w-1/3 bg-gray-50 border-r p-4 overflow-y-auto">
        <h2 className="font-bold mb-2">問題を選択</h2>
        {problems.map((p) => (
          <button
            key={p.id}
            onClick={() => setProblem(p)}
            className={`block w-full text-left p-2 mb-2 rounded ${
              problem?.id === p.id ? 'bg-blue-100' : 'hover:bg-blue-50'
            }`}
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
              onChange={(e) => setGradingMode(e.target.checked)}
            />
            <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:bg-green-500 transition-all" />
            <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow peer-checked:translate-x-full transition-all" />
          </label>
          <span className={gradingMode ? 'font-bold' : 'text-gray-400'}>採点モード</span>
        </div>

        {/* ガイドフォーム */}
        <div className="space-y-3 mb-3">
          {/* 課題を進める */}
          <div className={`border rounded-lg ${gradingMode ? 'opacity-50 pointer-events-none' : ''}`}>
            <button
              className="w-full flex justify-between items-center px-3 py-2 text-left"
              onClick={() => setOpenHint((v) => !v)}
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
                  onChange={(e) => setHintQuestion(e.target.value)}
                />
                <textarea
                  className="w-full border p-2 rounded h-24"
                  placeholder="（任意）現在の状況/要件"
                  value={hintContext}
                  onChange={(e) => setHintContext(e.target.value)}
                />
                <textarea
                  className="w-full border p-2 rounded h-32 font-mono"
                  placeholder="途中までのコード"
                  value={hintCode}
                  onChange={(e) => setHintCode(e.target.value)}
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

          {/* エラーを直す */}
          <div className={`border rounded-lg ${gradingMode ? 'opacity-50 pointer-events-none' : ''}`}>
            <button
              className="w-full flex justify-between items-center px-3 py-2 text-left"
              onClick={() => setOpenError((v) => !v)}
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
                  onChange={(e) => setErrWhere(e.target.value)}
                />
                <textarea
                  className="w-full border p-2 rounded h-20"
                  placeholder="エラーメッセージ/想定と異なる結果"
                  value={errMessage}
                  onChange={(e) => setErrMessage(e.target.value)}
                />
                <textarea
                  className="w-full border p-2 rounded h-32 font-mono"
                  placeholder="該当コード"
                  value={errCode}
                  onChange={(e) => setErrCode(e.target.value)}
                />
                <textarea
                  className="w-full border p-2 rounded h-20"
                  placeholder="（任意）自分の仮説"
                  value={errThought}
                  onChange={(e) => setErrThought(e.target.value)}
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

        {/* メッセージ表示 */}
        <div className="flex-1 space-y-4 overflow-y-auto">
          {messages.map((msg: Message, idx: number) => {
            if (msg.role === 'assistant') {
              const { advice, question, codeBlock, rest } = parseAdviceQuestion(msg.content)
              const restParts = rest ? formatMessageContent(rest) : []
              return (
                <div key={idx} className="flex justify-start">
                  <div className="p-3 rounded max-w-[75%] bg-green-50 whitespace-pre-wrap break-words space-y-2">
                    {advice && <p className="leading-relaxed">{emphasizeInline(advice)}</p>}
                    {question && <p className="leading-relaxed font-semibold">{emphasizeInline(question)}</p>}
                    {codeBlock && (
                      <div>
                        {formatMessageContent(codeBlock).map((part, i) =>
                          typeof part === 'string' ? (
                            <p key={i}>{part}</p>
                          ) : (
                            <pre key={i} className="bg-gray-200 p-2 rounded overflow-x-auto text-sm">
                              <code>{part.code}</code>
                            </pre>
                          )
                        )}
                      </div>
                    )}
                    {restParts.length > 0 &&
                      restParts.map((part, i) =>
                        typeof part === 'string' ? (
                          <p key={i}>{part}</p>
                        ) : (
                          <pre key={i} className="bg-gray-200 p-2 rounded overflow-x-auto text-sm">
                            <code>{part.code}</code>
                          </pre>
                        )
                      )}
                  </div>
                </div>
              )
            }
            return (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`p-3 rounded max-w-[75%] whitespace-pre-wrap break-words ${
                    msg.role === 'user' ? 'bg-blue-100' : 'bg-green-50'
                  }`}
                >
                  {formatMessageContent(msg.content).map((part, i) =>
                    typeof part === 'string' ? (
                      <p key={i}>{part}</p>
                    ) : (
                      <pre key={i} className="bg-gray-200 p-2 rounded overflow-x-auto text-sm">
                        <code>{part.code}</code>
                      </pre>
                    )
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
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
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
