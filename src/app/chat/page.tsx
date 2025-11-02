// src/app/chat/page.tsx
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

/* ================== 教員/抽象化プロンプト群 ================== */
const BASE_TEACHER_PROMPT = (lang: string) => String.raw`
[役割] プログラミングを正しく教えられる教員。  
学習者が「いま質問した箇所だけ」を対象に説明し、それ以外の部分は出力しない。  
目的は、学習者が自分のコードの“どの位置に何を書くか”を理解すること。

[出力範囲の制限（最重要）]
- 学習者が質問した箇所以外の要素を出さない。
- 「全体像」や「次に書く部分」を先回りして出さない。

[最優先禁止ルール]
- 絶対に完成コードの提示禁止（位置だけ示す）。

[コード出力ルール]
- \`\`\`${lang}\`\`\` で、該当範囲のみ骨組みを出す。

[出力形式]
アドバイス: 3〜5文。  
質問: 1つだけ（?で終える）。  
コード例: 上記の抽象度/記法で。

[出力フォーマット厳守]
- 行頭に必ず「アドバイス:」「質問:」を付け、「コード例:」の直後に \`\`\`${lang} で開始すること。
`.trim()

/** 多言語対応 抽象化プロンプト（抽出スニペットを与えて“コードのみ”を要求） */
const buildAbstractPrompt = (lang: string, snippet: string) => {
  const langName = (lang || 'java').toLowerCase()
  const shownLang =
    langName === 'ts' ? 'typescript'
      : langName === 'js' ? 'javascript'
      : langName

  const rules = String.raw`
あなたは、プログラミング教材のためにコードを「抽象化テンプレート」に変換するアシスタントです。

以下の${shownLang}コードを、**具体語（固有名・実データ）をすべて排除した抽象的な雛形**に書き換えてください。

【目的】
- 入力が日本語・英語・その他の言語であっても、抽象的で言語に依存しないテンプレートを作ること。
- 出力は${shownLang}構文の形を保ちつつ、具体的な識別子や値を \`<～>\` で表現する。

【ルール】
1. **型（${shownLang}の型表現）はそのまま残す。**
2. **識別子（クラス名・変数名・フィールド名・メソッド名）はすべて抽象語に置き換える。**
   - \`<クラス名>\` / \`<整数型>\` / \`<文字列型>\` / \`<idを表すフィールド>\` / \`<名前を表すフィールド>\` など。
3. **配列や文字列リテラルなどの具体値も抽象化する。**
   - 文字列例: \`"math"\` → \`"<科目名1をここに入れる>"\`
   - 数値例: \`0\` → \`xx\`
4. **コメントは残すが、具体語は抽象語に置換して説明として分かる文体にする。**
5. **コンパイルは不要（構造理解が目的）。**
6. **出力は\`${shownLang}\`のコードブロックのみ**（説明文・前置き・注釈は書かない）。

【変換対象（最重要）】
- 下に与える「抽出スニペット」の範囲**だけ**を抽象化する。前後の補完や別の部分の生成はしない。
`.trim()

  return String.raw`
${rules}

【抽出スニペット】
\`\`\`${shownLang}
${snippet || '// (抽出できる部分が見つかりませんでした)'}
\`\`\`
`.trim()
}

const outputRule = (lang: string) => String.raw`
【出力形式(再確認)】
アドバイスは最大5文。具体リテラル禁止。
コード例は \`\`\`${lang} から。識別子追加や別記法の導入は禁止。
`.trim()

const GRADING_PROMPT = String.raw`
[役割] 採点・助言。完成度・未達・次の一手のみを簡潔に。
[禁止] 模範コード全文や具体リテラルを含む完成コードの提示。
`.trim()

type Message = { role: 'user' | 'assistant'; content: string }

// ① 型を整理（solution_files 必須）
type ProblemFile = { filename: string; code: string; language?: string }
type Problem = {
  id: string;
  title: string;
  description: string;
  solution_files: ProblemFile[];
}

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

/* ===== メッセージ整形（堅牢版） ===== */
function parseAdviceQuestion(raw: string) {
  const src = (raw || '').replace(/\r\n?/g, '\n')

  // コードブロックを退避
  const codeRegex = /```[\w#+-]*\n([\s\S]*?)```/g
  const codeParts: string[] = []
  let cm: RegExpExecArray | null
  while ((cm = codeRegex.exec(src))) codeParts.push(cm[0])
  const textOnly = src.replace(codeRegex, '\n')

  const lines = textOnly.split('\n').map(l => l.trim()).filter(Boolean)

  const pickByLabel = (labelJa: string, labelEn: string) => {
    const idx = lines.findIndex(l => new RegExp(`^(${labelJa}|${labelEn})\\s*[:：]?`, 'i').test(l))
    if (idx === -1) return null
    const head = lines[idx].replace(new RegExp(`^(${labelJa}|${labelEn})\\s*[:：]?\\s*`, 'i'), '')
    if (head) return head
    let j = idx + 1
    const buf: string[] = []
    while (j < lines.length) {
      const s = lines[j]
      if (/^(アドバイス|Advice|質問|Question)\s*[:：]?/i.test(s)) break
      if (/^```/.test(s)) break
      buf.push(s)
      if (buf.join(' ').length > 300) break
      j++
    }
    return buf.join(' ').trim() || null
  }

  let advice = pickByLabel('アドバイス', 'Advice')
  let question = pickByLabel('質問', 'Question')

  if (!advice) {
    const firstPara = lines.find(l => !/^(アドバイス|Advice|質問|Question)\s*[:：]?/i.test(l)) || ''
    advice = firstPara || null
  }
  if (!question) {
    question = lines.find(l => /[?？]$/.test(l)) || null
  }

  const codeBlock = codeParts.join('\n')
  const rest = ''

  return { advice, question, codeBlock, rest }
}

const EMP = /(重要|最優先|まず|次に|初期化|確認|修正|原因|手順|注意|ポイント|必ず|だけ|正しく)/
const emphasizeInline = (text: string): ReactNode[] => {
  if (!text) return ['']
  const out: ReactNode[] = []
  let last = 0
  const g = new RegExp(EMP.source, 'g')
  let m: RegExpExecArray | null
  while ((m = g.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<strong key={`${m.index}-${m[0]}`} className="font-semibold">{m[0]}</strong>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/* ===== コード整形 ===== */
function prettyCodeAuto(code: string): string {
  let s = code.replace(/\t/g, '  ').trim()
  const semicolons = (s.match(/;/g) || []).length
  const newlines = (s.match(/\n/g) || []).length
  if (semicolons >= 2 && newlines <= 1) {
    s = s.split(';').map((p) => p.trim()).filter(Boolean).map((p) => p + ';').join('\n')
  }
  s = s.replace(/\)\s*\{/g, ') {\n').replace(/\{\s*/g, '{\n').replace(/\s*\}/g, '\n}').replace(/\n{3,}/g, '\n\n')
  const lines = s.split('\n'); let depth = 0; const out: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (!t) { out.push(''); continue }
    if (/^[}\)]/.test(t)) depth = Math.max(0, depth - 1)
    out.push('  '.repeat(depth) + t)
    if (/[{]$/.test(t)) depth++
  }
  return out.join('\n').replace(/\s+\n/g, '\n')
}

/* ===== 言語推定 ===== */
function detectLang(text: string, problem?: Problem): string {
  const src = ((problem?.description || '') + '\n' + (text || '')).toLowerCase()

  const fence = text.match(/```([\w#+-]+)\b/)
  if (fence) return fence[1]

  if (/\bclass\s+\w+\s*\{/.test(text) && /system\.out\.println|public\s+static\s+void\s+main/.test(src)) return 'java'
  if (/\b#include\s*</.test(text) && /\bstd::/.test(text)) return 'cpp'
  if (/\b#include\s*</.test(text)) return 'c'
  if (/\bdef\s+\w+\(.*\):/.test(text) || /\bprint\(/.test(text)) return 'python'
  if (/\bfunction\s+\w+\(/.test(text) || /\bconst\s+\w+\s*=\s*\(/.test(text)) {
    if (/\b:\s*\w+(\[\])?/.test(text) || /\binterface\b/.test(text)) return 'typescript'
    return 'javascript'
  }
  if (/\bfun\s+\w+\(.*\)\s*{/.test(text) || /\bdata\s+class\b/.test(text)) return 'kotlin'
  if (/\bnamespace\b/.test(text) && /\bclass\b/.test(text) && /\bstring\b/i.test(text)) return 'csharp'

  return 'java'
}

/* ===== 抽出ユーティリティ ===== */
type ExtractIntent = {
  wantClass: boolean
  wantFields: boolean
  wantCtor: boolean
  wantMethods: boolean
}
function deriveIntent(userContent: string): ExtractIntent {
  const t = (userContent || '').toLowerCase()
  const wantClass   = /クラス宣言|クラス名|class\s+\w+/.test(userContent) || /\bclass\b/.test(t)
  const wantFields  = /フィールド|メンバ変数|field|プロパティ/.test(userContent) || /\bfield|property\b/.test(t)
  const wantCtor    = /コンストラクタ|constructor/.test(userContent) || /\bconstructor\b/.test(t)
  const wantMethods = /メソッド|method|get(ter)?|set(ter)?/.test(userContent) || /\bmethod|getter|setter\b/.test(t)
  const any = wantClass || wantFields || wantCtor || wantMethods
  return {
    wantClass:   any ? wantClass   : true,
    wantFields:  any ? wantFields  : true,
    wantCtor:    any ? wantCtor    : true,
    wantMethods: any ? wantMethods : false,
  }
}

function extractFromSource(code: string, intent: ExtractIntent): string {
  const src = (code || '').replace(/\r\n?/g, '\n')
  if (!src.trim()) return ''

  const classMatch = src.match(/\bclass\s+([A-Za-z_]\w*)\s*\{([\s\S]*)\}\s*$/m)
  const className = classMatch ? classMatch[1] : null
  const classBody = classMatch ? classMatch[2] : src

  const lines = classBody.split('\n')

  const fieldLines: string[] = []
  for (const ln of lines) {
    const t = ln.trim()
    if (!t) continue
    if (t.endsWith(';') && !t.includes('(')) fieldLines.push(ln)
  }

  const blockRegex = /([A-Za-z_<>\[\]\s]+)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/g
  const blocks: { header: string; name: string; params: string; block: string }[] = []
  let m: RegExpExecArray | null
  while ((m = blockRegex.exec(classBody)) !== null) {
    const header = (m[1] || '').trim()
    const name   = (m[2] || '').trim()
    const params = (m[3] || '')
    let i = m.index + m[0].length
    let depth = 1
    while (i < classBody.length && depth > 0) {
      const ch = classBody[i++]
      if (ch === '{') depth++
      else if (ch === '}') depth--
    }
    const block = classBody.slice(m.index, i)
    blocks.push({ header, name, params, block })
  }

  const ctorBlocks: string[] = []
  const methodBlocks: string[] = []
  for (const b of blocks) {
    const isCtor = className && b.name === className
    if (isCtor) ctorBlocks.push(b.block)
    else        methodBlocks.push(b.block)
  }

  const collected: string[] = []
  if (intent.wantClass && className) collected.push(`class ${className} {}`)
  if (intent.wantFields && fieldLines.length) collected.push(...fieldLines)
  if (intent.wantCtor && ctorBlocks.length) collected.push(...ctorBlocks)
  if (intent.wantMethods && methodBlocks.length) collected.push(...methodBlocks)

  return collected.join('\n').trim()
}

// solution_files 専用
function extractFromProblem(problem: Problem, intent: ExtractIntent): { snippet: string; lang: string } {
  const sources = (problem.solution_files ?? []).map(f => ({ code: f.code, language: f.language }))

  let best = ''
  let bestLang = 'java'
  for (const s of sources) {
    const snip = extractFromSource(s.code, intent)
    if (snip && snip.length > best.length) {
      best = snip
      bestLang = s.language || detectLang(s.code) || 'java'
    }
  }

  console.groupCollapsed('[DEBUG] 抽出スニペット/言語 推定')
  console.log('intent:', intent)
  console.log('detected language:', bestLang)
  console.log('snippet:\n', best)
  console.groupEnd()

  return { snippet: best, lang: bestLang }
}

/* ===== コードブロック抽出 ===== */
function getFirstCodeBlock(md: string): { lang: string | null; code: string } | null {
  const re = /```([\w#+-]*)\n([\s\S]*?)```/
  const m = md.match(re)
  if (!m) return null
  return { lang: m[1] || null, code: m[2] || '' }
}

// 複数ブロック対応（言語一致優先→それ以外は最長）
function getBestCodeBlock(md: string, preferLang?: string | null): { lang: string | null; code: string } | null {
  const re = /```([\w#+-]*)\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  let best: { lang: string | null; code: string } | null = null
  while ((m = re.exec(md))) {
    const lang = (m[1] || '') || null
    const code = m[2] || ''
    if (!best) { best = { lang, code }; continue }
    const preferHitNow  = preferLang && lang && lang.toLowerCase() === preferLang.toLowerCase()
    const preferHitBest = preferLang && best.lang && best.lang.toLowerCase() === preferLang.toLowerCase()
    if (preferHitNow && !preferHitBest) { best = { lang, code }; continue }
    if (code.length > best.code.length) best = { lang, code }
  }
  return best
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

  // ===== 解決確認 =====
  const [waitingFeedback, setWaitingFeedback] = useState(false)
  const [lastAssistantIndex, setLastAssistantIndex] = useState<number | null>(null)
  const [pendingNudge, setPendingNudge] = useState<string | null>(null)

  // 継続時間トラッキング
  const [selectStartedAt, setSelectStartedAt] = useState<number | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [nudgeCount, setNudgeCount] = useState(0)
  const pad2 = (n: number) => n.toString().padStart(2, '0')
  const fmtHMS = (sec: number) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h > 0 ? `${h}:${pad2(m)}` : `${m}`) + `:${pad2(s)}` }

  const pushAssistant = (text: string, { isNudge = false }: { isNudge?: boolean } = {}) => {
    if (!problem) return
    if (isNudge && waitingFeedback) { setPendingNudge(text); return }
    setAllMessages((prev) => {
      const cur = prev[problem.id] || []
      return { ...prev, [problem.id]: [...cur, { role: 'assistant', content: text }] }
    })
  }

  // 折りたたみフォーム
  const [openHint, setOpenHint] = useState(false)
  const [openError, setOpenError] = useState(false)

  // 入力フォーム（ヒント/エラー）
  const [hintQuestion, setHintQuestion] = useState('')
  const [hintCode, setHintCode] = useState('')
  const [hintContext, setHintContext] = useState('')

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

  // 問題切替時：初期化
  useEffect(() => {
    if (!problem) {
      setSelectStartedAt(null); setElapsedSec(0); setNudgeCount(0)
      setWaitingFeedback(false); setLastAssistantIndex(null); setPendingNudge(null)
      return
    }
    const key = `selStart:${problem.id}`
    const raw = localStorage.getItem(key)
    const num = raw === null ? NaN : Number(raw)
    const start = Number.isFinite(num) ? num : Date.now()
    setSelectStartedAt(start); localStorage.setItem(key, String(start))
    setNudgeCount(0); setPendingNudge(null)
  }, [problem])

  /** テスト用しきい値（本番は 20*60 / 30*60） */
  const NUDGE_FIRST = 20 * 60
  const NUDGE_SECOND = 30 * 60

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

  /** 送信共通処理（通常モードに抽象化連携を内包） */
  const sendWithContext = async (userContent: string) => {
    if (!userContent.trim() || !problem) return
    const userMessage: Message = { role: 'user', content: userContent }
    const current = [...(allMessages[problem.id] || []), userMessage]
    setAllMessages({ ...allMessages, [problem.id]: current })
    setInput('')

    const summary = buildSummary(current)
    const langGuess = detectLang(userContent, problem)

    // 送信用の模範コード（solution_files 全て）を整形
    const exemplarForPrompt = (problem.solution_files || [])
      .map((f) => {
        const l = (f.language && f.language.trim()) || detectLang(f.code)
        return `// ${f.filename || '(no name)'}\n\`\`\`${l}\n${f.code}\n\`\`\``
      })
      .join('\n\n')

    setLoading(true)

    try {
      // ===== 1) 助言/逆質問の取得（教員プロンプト）
      const teacherPrompt = `${BASE_TEACHER_PROMPT(langGuess)}

【問題文】
${problem.description}

【模範コード（複数可）】
${exemplarForPrompt || '(なし)'}

【これまでの履歴要約】
${summary}

【質問/学生の考え】
${userContent}

${outputRule(langGuess)}`
      console.groupCollapsed('[DEBUG] 送信プロンプト: 教員（アドバイス/逆質問）')
      console.log(teacherPrompt)
      console.groupEnd()

      const res1 = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: teacherPrompt }),
      })
      if (!res1.body) throw new Error('No response body from API (teacher step)')

      let teacherReply = ''
      {
        const reader = res1.body.getReader()
        const decoder = new TextDecoder('utf-8')
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split('\n')
            .filter((l) => l.trim().startsWith('data: '))
            .map((l) => l.replace(/^data: /, ''))
            .filter((l) => l !== '' && l !== '[DONE]')
          for (const jsonStr of lines) {
            try {
              const parsed = JSON.parse(jsonStr)
              const delta = parsed.choices?.[0]?.delta?.content
              if (delta) teacherReply += delta
            } catch { /* ignore */ }
          }
        }
      }

      console.groupCollapsed('[DEBUG] 受信: 教員応答（生テキスト）')
      console.log(teacherReply)
      console.groupEnd()

      const { advice, question } = parseAdviceQuestion(teacherReply)

      // ===== 2) 先生が示したコードブロックをそのまま抽象化へ（最適ブロックを選択）
      let snippet = ''
      let lang = langGuess
      const picked = getBestCodeBlock(teacherReply, langGuess)
      if (picked && picked.code.trim()) {
        snippet = picked.code
        lang = picked.lang || langGuess
        console.log('[DEBUG] 抽象化に使用: 教員応答の最適コードブロック')
      } else {
        // なければ solution_files から抽出（従来フォールバック）
        const intent = deriveIntent(userContent)
        const ex = extractFromProblem(problem, intent)
        snippet = ex.snippet
        lang = ex.lang || langGuess
        console.log('[DEBUG] 抽象化に使用: solution_files からの抽出スニペット')
      }

      // ===== 3) 抽象化の実行（抽象化プロンプト: コードのみ）
      const abstractPrompt = buildAbstractPrompt(lang || langGuess || 'java', snippet)
      console.groupCollapsed('[DEBUG] 送信プロンプト: 抽象化')
      console.log(abstractPrompt)
      console.groupEnd()

      const res2 = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: abstractPrompt }),
      })
      if (!res2.body) throw new Error('No response body from API (abstract step)')

      let abstractReply = ''
      {
        const reader = res2.body.getReader()
        const decoder = new TextDecoder('utf-8')
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split('\n')
            .filter((l) => l.trim().startsWith('data: '))
            .map((l) => l.replace(/^data: /, ''))
            .filter((l) => l !== '' && l !== '[DONE]')
          for (const jsonStr of lines) {
            try {
              const parsed = JSON.parse(jsonStr)
              const delta = parsed.choices?.[0]?.delta?.content
              if (delta) abstractReply += delta
            } catch { /* ignore */ }
          }
        }
      }

      console.groupCollapsed('[DEBUG] 受信: 抽象化応答（生テキスト）')
      console.log(abstractReply)
      console.groupEnd()

      const fenced = getFirstCodeBlock(abstractReply)
      const abstractCode = prettyCodeAuto(fenced?.code || abstractReply) // 念のため整形

      // ===== 4) まとめて学生に表示（アドバイス + 質問 + 抽象化コード）
      const parts: string[] = []
      if (advice) parts.push(`アドバイス: ${advice}`)
      parts.push(`質問: ${question || 'どの部分でつまずいていますか？'}`)
      parts.push(`コード例:\n\`\`\`${(fenced?.lang || lang || 'java')}\n${abstractCode}\n\`\`\``)
      const finalMessage = parts.join('\n\n')

      const newAssistantMessage: Message = { role: 'assistant', content: finalMessage }
      setAllMessages((prev) => {
        const cur = prev[problem.id] || []
        return { ...prev, [problem.id]: [...cur, newAssistantMessage] }
      })

      setWaitingFeedback(true)
      setLastAssistantIndex((allMessages[problem.id]?.length ?? 0) + 1)
    } catch (e) {
      console.error('[ERROR] 通常モード統合フロー失敗:', e)
      const errMsg: Message = { role: 'assistant', content: '処理中にエラーが発生しました。もう一度お試しください。' }
      setAllMessages((prev) => ({ ...prev, [problem.id]: [...(prev[problem.id] || []), errMsg] }))
    } finally {
      setLoading(false)
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 0)
    }
  }

  const handleSend = async () => { if (!input.trim() || !problem || waitingFeedback) return; await sendWithContext(input) }
  const answerFeedback = (_resolved: boolean) => {
    setWaitingFeedback(false)
    setLastAssistantIndex(null)
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

          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              <span className={!gradingMode ? 'font-bold' : 'text-gray-400'}>通常モード</span>
              <label className="mx-2 relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={gradingMode}
                  onChange={(e) => { setGradingMode(e.target.checked) }}
                  disabled={waitingFeedback}
                />
                <div className={`w-11 h-6 rounded-full transition-all ${waitingFeedback ? 'bg-gray-300' : 'bg-gray-200 peer-checked:bg-green-500'}`} />
                <div className={`absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${gradingMode ? 'translate-x-full' : ''}`} />
              </label>
              <span className={gradingMode ? 'font-bold' : 'text-gray-400'}>採点モード（※本画面では未使用）</span>
            </div>

            {waitingFeedback && <span className="text-xs text-rose-600">※ 解決確認に回答するまで送信できません</span>}
          </div>

          {/* ガイドフォーム */}
          <div className="space-y-3 mb-3">
            <div className={`border rounded-lg ${waitingFeedback ? 'opacity-50 pointer-events-none' : ''}`}>
              <button className="w-full flex justify-between items-center px-3 py-2 text-left" onClick={() => setOpenHint((v) => !v)} disabled={!problem || waitingFeedback}>
                <span className="font-semibold">🧭 課題を進める（ヒント）</span>
                <span className="text-sm text-gray-500">{openHint ? '閉じる' : '開く'}</span>
              </button>
              {openHint && (
                <div className="px-3 pb-3 space-y-2">
                  <input className="w-full border p-2 rounded" placeholder="何を知りたい？" value={hintQuestion} onChange={(e) => setHintQuestion(e.target.value)} />
                  <textarea className="w-full border p-2 rounded h-24" placeholder="（任意）現在の状況/要件" value={hintContext} onChange={(e) => setHintContext(e.target.value)} />
                  <textarea className="w-full border p-2 rounded h-32 font-mono" placeholder="途中までのコード" value={hintCode} onChange={(e) => setHintCode(e.target.value)} />
                  <div className="flex justify-end">
                    <button className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
                      onClick={() => problem && sendWithContext([
                        '【モード】課題を進める（ヒント）',
                        hintQuestion && `【知りたいこと】\n${hintQuestion}`,
                        hintContext && `【状況/要件】\n${hintContext}`,
                        hintCode && `【途中までのコード】\n\`\`\`\n${hintCode}\n\`\`\``,
                        '【要望】直接の解答コードは出さず、次の一手を1つだけに絞ること。'
                      ].filter(Boolean).join('\n\n'))}
                      disabled={(!hintQuestion.trim() && !hintCode.trim() && !hintContext.trim()) || waitingFeedback}>
                      送信（ヒント）
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className={`border rounded-lg ${waitingFeedback ? 'opacity-50 pointer-events-none' : ''}`}>
              <button className="w-full flex justify-between items-center px-3 py-2 text-left" onClick={() => setOpenError((v) => !v)} disabled={!problem || waitingFeedback}>
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
                    <button className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
                      onClick={() => problem && sendWithContext([
                        '【モード】エラーを直す',
                        errWhere && `【エラー箇所】\n${errWhere}`,
                        errMessage && `【エラー内容/想定と異なる結果】\n${errMessage}`,
                        errCode && `【該当コード】\n\`\`\`\n${errCode}\n\`\`\``,
                        errThought && `【自分の仮説】\n${errThought}`,
                        '【要望】根本原因の仮説→観察/出力→修正方針の最優先の一手だけ。'
                      ].filter(Boolean).join('\n\n'))}
                      disabled={(!errWhere.trim() && !errMessage.trim() && !errCode.trim() && !errThought.trim()) || waitingFeedback}>
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
              const bubble = (
                <div className={`p-3 rounded max-w-[75%] whitespace-pre-wrap break-words ${msg.role === 'user' ? 'bg-blue-100' : 'bg-green-50'}`}>
                  {(() => {
                    const parts = (() => {
                      const regex = /```(?:[a-zA-Z0-9#+-]*)?\n([\s\S]*?)```/g
                      const res: (string | { code: string })[] = []; let last = 0; let m: RegExpExecArray | null
                      while ((m = regex.exec(msg.content))) {
                        if (m.index > last) res.push(msg.content.slice(last, m.index))
                        res.push({ code: prettyCodeAuto(m[1] ?? '') })
                        last = regex.lastIndex
                      }
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
              placeholder={
                !problem
                  ? 'まず問題を選んでください'
                  : waitingFeedback
                    ? '（まず「解決できましたか？」に回答してください）'
                    : '自由入力（Enterで送信、Shift+Enterで改行 / Tabでインデント）'
              }
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
                  requestAnimationFrame(() => { (el as any).selectionStart = (el as any).selectionEnd = start + indent.length })
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
