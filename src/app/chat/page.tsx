// src/app/chat/page.tsx
'use client'

import React, {
  useEffect, useMemo, useRef, useState, ReactNode,
  forwardRef, useImperativeHandle,
} from 'react'

// Firestore / Auth
import {
  collection,
  addDoc,
  serverTimestamp,
  doc,
  getDoc,
  setDoc,              // ★ 追加
} from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { db, auth } from '@/lib/firebase'

// Storage（提出原本の保存）
import { getStorage, ref as sRef, uploadString, getDownloadURL } from 'firebase/storage'

/* ================== 座席番号 正規化・取得を堅牢化 ================== */
function normalizeSeatNumber(input: any): string | null {
  const s = (input ?? '').toString().trim().toUpperCase()
  return /^[A-Z][0-9]{2}$/.test(s) ? s : null
}
function pickSeatNumberFromAny(obj: any): string | null {
  if (!obj || typeof obj !== 'object') return null
  const cand = (obj as any).seatNumber ?? (obj as any).seat_no ?? (obj as any).seat ?? (obj as any).number ?? null
  return normalizeSeatNumber(cand)
}
function getSeatNumberFromStorage(): string | null {
  try {
    for (const k of ['seatNumber', 'seat', 'seat_no']) {
      const v = normalizeSeatNumber(localStorage.getItem(k))
      if (v) return v
    }
    for (const k of ['userSettings', 'settings', 'profile', 'student', 'userProfile']) {
      const s = localStorage.getItem(k)
      if (!s) continue
      try {
        const parsed = JSON.parse(s)
        const picked = pickSeatNumberFromAny(parsed)
        if (picked) return picked
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return null
}

/* ================== ポーズ式タイマー（問題ごと） ================== */
const keyAccum = (id: string) => `selAccum:${id}`
const keyStart = (id: string) => `selStart:${id}`
const keyNudgeStage = (id: string) => `nudgeStage:${id}`

function readNudgeStage(id: string): number {
  const v = Number(localStorage.getItem(keyNudgeStage(id)) || 0)
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(3, v)) // 0..3 に丸める
}
function writeNudgeStage(id: string, stage: number) {
  localStorage.setItem(keyNudgeStage(id), String(stage))
}


function readTimer(id: string) {
  const accum = Number(localStorage.getItem(keyAccum(id)) || 0)
  const startStr = localStorage.getItem(keyStart(id))
  const runningAt = startStr ? Number(startStr) : null
  return { accum, runningAt }
}
function writeTimer(id: string, next: { accum?: number; runningAt?: number | null }) {
  if (next.accum !== undefined) localStorage.setItem(keyAccum(id), String(next.accum))
  if (next.runningAt !== undefined) {
    if (next.runningAt == null) localStorage.removeItem(keyStart(id))
    else localStorage.setItem(keyStart(id), String(next.runningAt))
  }
}
function pauseTimer(id: string) {
  const { accum, runningAt } = readTimer(id)
  if (runningAt != null) {
    const now = Date.now()
    writeTimer(id, { accum: accum + (now - runningAt), runningAt: null })
  }
}

function getLocalElapsedSec(problemId: string): { sec: number; running: boolean } {
  const { accum, runningAt } = readTimer(problemId)
  const now = Date.now()
  const ms = accum + (runningAt ? (now - runningAt) : 0)
  return {
    sec: Math.max(0, Math.floor(ms / 1000)),
    running: runningAt != null,
  }
}

function resumeTimer(id: string) {
  const { runningAt } = readTimer(id)
  if (runningAt == null) writeTimer(id, { runningAt: Date.now() })
}

type UpdateTimerOpts = {
  resetTimer?: boolean
}

const TIMER_OWNER_KEY = 'timerOwnerUid'


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
- 学習者が質問した箇所以外の元素を出さない。
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

/* ================== 抽象化コメント記法ヘルパ（言語非依存） ================== */
function commentStyle(lang: string) {
  const l = (lang || '').toLowerCase()
  if (['python', 'py', 'ruby', 'rb', 'shell', 'sh', 'bash', 'yaml', 'yml', 'toml'].includes(l)) {
    return { prefix: '#', suffix: '' }
  }
  if (['sql'].includes(l)) {
    return { prefix: '--', suffix: '' }
  }
  if (['html', 'xml'].includes(l)) {
    return { prefix: '<!--', suffix: '-->' }
  }
  // デフォルトは C/Java/JS 系
  return { prefix: '//', suffix: '' }
}

function asComment(lang: string, text: string) {
  const { prefix, suffix } = commentStyle(lang)
  return suffix ? `${prefix} ${text} ${suffix}` : `${prefix} ${text}`
}


// ★ 授業内容（教員が毎回編集するメモ）
const CURRENT_LESSON_DESCRIPTION = String.raw`
本日の授業では「配列」「for文／拡張for文」「メソッド定義と呼び出し」などを扱っています。
※必要に応じて、この文章を授業ごとに書き換えてください。
`.trim()

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
- 出力は${shownLang}の構文を保ちつつ、学習者が自分で埋めるべき箇所を「TODOコメント穴埋め」で示すこと。

【ルール】
1. **型（${shownLang}の型表現）はそのまま残す。**
2. **識別子（クラス名・変数名・フィールド名・メソッド名）は、<...> を使わず**
   **ClassA / funcX / value1 のような“汎用で妥当な識別子”に置き換える。**
3. **具体値（数値/文字列/条件）は <...> にせず、TODOコメントで穴埋めにする。**
   - 例： ${asComment(shownLang, 'TODO: ここに数値リテラル')} / ${asComment(shownLang, 'TODO: ここに条件')}
4. **コード冒頭に必ず「抽象化コード例であり完成コードではない」旨の注意コメントを1行入れる。**
   - 例： ${asComment(shownLang, '【抽象化コード例】完成コードではありません。TODOを埋めてください。')}
5. **コメントは残しつつ抽象語に置換する。**
6. **コンパイル不要（構造理解が目的）。**
7. **出力は\`${shownLang}\`のコードブロックのみ。**
`.trim()

  return String.raw`
${rules}

【変換対象（最重要）】下のスニペット範囲だけ。
\`\`\`${shownLang}
${snippet || '// (抽出できる部分が見つかりませんでした)'}
\`\`\`
`.trim()
}

const outputRule = (lang: string) => String.raw`
【出力形式(再確認)】
アドバイスは最大5文。具体リテラル禁止。
コード例は \`\`\`${lang} から開始。
- コード例の先頭に「抽象化コード例」注意コメントを必ず入れること。
- 抽象箇所は <...> を使わず、TODOコメント穴埋めにすること。
`.trim()


const GRADING_PROMPT = String.raw`
[役割] 教員として提出コードを採点し、学習者が自分の進捗を数値で把握できるようにする。
[比較] 模範コードと学生コードを比較し、満たせている要件/未達の要件を抽出。
[出力]
1) 完成度: XX%（根拠を短く）
2) 未達/不正確: 最大5点
3) 次の一手: 1〜3点
[禁止]
- エラーメッセージの解説
- 模範コード全文貼付
`.trim()

const FREE_TEXT_PROMPT = String.raw`
あなたは、プログラミング演習の受講生と雑談や相談にのるメンターです。

【想定される内容】
- 「こんにちは」「最近どうですか？」のようなあいさつ
- 授業や課題への不安、勉強の進め方の相談など

【絶対に守るルール】
- コードや疑似コード、数式のような「プログラムとして使えそうなもの」は一切書かない。
- \`\`\` で囲んだコードブロックや、クラス名・メソッド名・変数名の例も出さない。
- Markdown の箇条書き（「- 」「1. 」など）も使わず、普通の文章だけで答える。

【出力形式】
- 日本語で 3〜5 文程度にまとめる。
- 1 行に 1 文を目安とし、**最大 5 行以内**に収める。
- 学生の気持ちを受け止めつつ、「次にどうすると良さそうか」を軽く提案する。
`.trim()

const buildAbstractionRulesForExample = (lang: string) => String.raw`
【コード例の抽象化テンプレート】

あなたは、プログラミング教材のためにコードを「抽象化テンプレート」に変換するアシスタントです。
**エラー相談 / コードレビュー相談のときに出力する「コード例:」の部分**は、必ず次のルールに従って抽象化してください。

以下の${lang}コード例を、**具体語（固有名・実データ）をすべて排除した抽象的な雛形**として書いてください。

【目的】
- 入力が日本語・英語・その他の言語であっても、抽象的で言語に依存しないテンプレートを作ること。
- 出力は${lang}構文の形を保ちつつ、学習者が自分で埋めるべき箇所を「TODOコメント穴埋め」で示すこと。

【ルール】
1. **型（${lang}の型表現）はそのまま残す。**
2. **識別子（クラス名・変数名・フィールド名・メソッド名）は <...> を使わず**
   **ClassA / funcX / value1 のような汎用で妥当な識別子に置き換える。**
3. **具体値（数値/文字列/条件/閾値/戻り値など）は <...> にしない。**
   **必ず対象言語のコメント記法で TODO穴埋めにする。**
   - 例： ${asComment(lang, 'TODO: ここに条件')} / ${asComment(lang, 'TODO: ここに数値')}
4. **コード例の先頭行に、必ず抽象化テンプレートである注意コメントを入れる。**
   - 例： ${asComment(lang, '【抽象化コード例】完成コードではありません。TODOを埋めてください。')}
5. **コメントは残しつつ抽象語に置換する。**
6. この抽象化は **「コード例:」の中だけ** に適用する。  
   アドバイス文や質問文では、元のクラス名や変数名をそのまま使って説明してよい。
`.trim()

/* ===== テンプレ（ステップUIで利用） ===== */
const TEMPLATE_TASK = `【課題の読み解き・作業工程の整理】
１：今取り組んでいる問題のどのあたりで止まっているか
→

２：自分なりに「何をする課題か」理解していること
→

３：次に何をすればよいかわからないポイント
→
`

const TEMPLATE_ERROR = `【エラー・例外の相談】

１：エラーメッセージ全文（コピペでOK）
→

２：実行したコード（全部）
→
`

const TEMPLATE_SYNTAX = `【文法・書き方の相談】

１：使いたいものの名前（メソッド / 変数）
→

２：どう動かしたいか（目的）
→
`

const TEMPLATE_REVIEW = `【コードレビュー・バグの相談】

１：コード全体
→

２：期待していた出力・動作
→

３：実際に起こっている出力・動作
→
`

const TEMPLATE_ALGO = `【理論・アルゴリズムの相談】

１：理解できていないポイント
→
`

/* ===== テンプレにステップ入力をはめ込むユーティリティ ===== */
function fillTemplate(template: string, answers: string[]): string {
  const parts = template.split('→')
  if (parts.length === 1) return template
  let result = parts[0]
  for (let i = 0; i < answers.length; i++) {
    const part = parts[i + 1] ?? ''
    result += (answers[i] || '') + part
  }
  if (parts.length > answers.length + 1) {
    result += parts.slice(answers.length + 1).join('→')
  }
  return result
}

/* ===== 型 ===== */
type QuestionMode = 'none' | 'task' | 'error' | 'syntax' | 'review' | 'algo' | 'free'
type QuestionTypeForLog = Exclude<QuestionMode, 'none'> | 'unknown'

type Message = {
  role: 'user' | 'assistant'
  content: string
  mode?: 'normal' | 'grading'
  questionType?: QuestionTypeForLog
  isNudge?: boolean
}
type ProblemFile = { filename: string; code: string; language?: string }
type Problem = { id: string; title: string; description: string; solution_files: ProblemFile[] }

/* ===== モード説明文 ===== */
function describeQuestionMode(q: QuestionTypeForLog): string {
  switch (q) {
    case 'task':
      return '課題の読み解きと作業工程の整理です。課題文をどう読むか・作業をどう分解するかだけを説明し、コード例や擬似コードは一切出さないでください。'
    case 'error':
      return 'エラー・例外の相談です。エラーメッセージとコードをもとに、原因と修正方針を説明してください。'
    case 'review':
      return 'コードレビュー・バグの相談です。期待する動作と実際の動作を比べて、バグの原因や改善点を説明してください。'
    case 'syntax':
      return '文法・書き方の相談です。構文や書き方の理解を助ける説明と、最小限のコード例を示してください。'
    case 'algo':
      return '理論・アルゴリズムの相談です。式の意味や処理の流れ・計算量など、概念的な理解を助けてください。'
    case 'free':
      return '自由記述の相談です。設計や学習の進め方など、学生の悩みに合わせて助言してください。'
    default:
      return '相談の種類は明示されていません。質問内容から適切に判断してください。'
  }
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
          <ol key={`ol-${i}`} className="list-decimal pl-5 my-1.space-y-0.5">{b.items.map((it, j) => <li key={j}>{highlightInline(it)}</li>)}</ol>
        ) : (
          <p key={`p-${i}`} className={KW_H.test(b.text) || LINE_L.test(b.text) ? 'py-0.5 pl-2 border-l-4 border-rose-300/70 text-gray-900' : 'py-0.5'}>
            {highlightInline(b.text)}
          </p>
        )
      )}
    </div>
  )
}

/* ===== 課題文ほぼコピペ検知用ユーティリティ ===== */
const normalizeForCompare = (text: string): string =>
  (text || '')
    .replace(/\s/g, '')                // 空白・改行をすべて削除
    .replace(/[。、，,.]/g, '')        // 句読点もざっくり削る

function looksLikeProblemCopy(desc: string, input: string): boolean {
  const a = normalizeForCompare(desc)
  const b = normalizeForCompare(input)

  // 問題文が短すぎる / 入力が短すぎる場合は判定しない
  if (a.length < 200) return false
  if (b.length < 80) return false

  const CHUNK = 60   // 1チャンクの長さ
  const STEP  = 30   // スライド幅

  let hitLen = 0

  for (let i = 0; i + CHUNK <= a.length; i += STEP) {
    const chunk = a.slice(i, i + CHUNK)
    if (b.includes(chunk)) {
      hitLen += CHUNK
    }
  }

  const overlapRatio = hitLen / b.length // 入力全体のうち、何割が課題文と一致しているか

  // 例: 入力の 60%以上が課題文由来なら「ほぼそのまま」とみなす
  return overlapRatio >= 0.6
}

/* ===== メッセージ整形 ===== */
function parseAdviceQuestion(raw: string) {
  const src = (raw || '').replace(/\r\n?/g, '\n')
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

/* ===== 模範コードから識別子抽出（禁止リスト用） ===== */
const IDENT_KEYWORDS = new Set<string>([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'return',
  'class', 'public', 'private', 'protected', 'static', 'void', 'int', 'double', 'float',
  'char', 'boolean', 'bool', 'long', 'short', 'byte', 'new', 'this', 'super', 'extends',
  'implements', 'import', 'package', 'using', 'namespace', 'null', 'true', 'false',
  'try', 'catch', 'finally', 'throw', 'throws', 'final', 'const', 'var', 'let', 'function',
  'def', 'from', 'in', 'out', 'override', 'virtual', 'enum', 'struct', 'interface', 'record',
  'typeof', 'instanceof', 'main', 'args', 'println', 'printf', 'scanf', 'cin', 'cout',
  'system', 'out', 'print', 'string'
])

function extractIdentifiersFromSolutionFiles(files: { code: string }[] | undefined): string[] {
  if (!files || files.length === 0) return []
  const ids = new Set<string>()
  const re = /\b[A-Za-z_][A-Za-z0-9_]*\b/g

  for (const f of files) {
    const code = f.code || ''
    let m: RegExpExecArray | null
    while ((m = re.exec(code))) {
      const id = m[0]
      const lower = id.toLowerCase()
      if (IDENT_KEYWORDS.has(lower)) continue
      if (id.length <= 1) continue
      if (/^[A-Z_]+$/.test(id)) continue // 定数っぽい全大文字は除外
      ids.add(id)
      if (ids.size >= 120) break
    }
    if (ids.size >= 120) break
  }
  return Array.from(ids)
}

/* ===== 抽出ユーティリティ（現在は未使用だが将来拡張用に保持） ===== */
type ExtractIntent = { wantClass: boolean; wantFields: boolean; wantCtor: boolean; wantMethods: boolean }
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
  const clsName = classMatch ? classMatch[1] : null
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
    the: {
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
  }

  const ctorBlocks: string[] = []
  const methodBlocks: string[] = []
  for (const b of blocks) {
    const isCtor = clsName && b.name === clsName
    if (isCtor) ctorBlocks.push(b.block)
    else        methodBlocks.push(b.block)
  }

  const collected: string[] = []
  if (intent.wantClass && clsName) collected.push(`class ${clsName} {}`)
  if (intent.wantFields && fieldLines.length) collected.push(...fieldLines)
  if (intent.wantCtor && ctorBlocks.length) collected.push(...ctorBlocks)
  if (intent.wantMethods && methodBlocks.length) collected.push(...methodBlocks)

  return collected.join('\n').trim()
}
function extractFromProblem(problem: Problem, intent: ExtractIntent): { snippet: string; lang: string } {
  const sources = (problem.solution_files ?? []).map(f => ({ code: f.code, language: f.language }))
  let best = ''
  let bestLang = 'java'
  for (const s of sources) {
    const snip = extractFromSource(s.code, intent)
    if (snip && snip.length > best.length) { best = snip; bestLang = s.language || detectLang(s.code) || 'java' }
  }
  console.groupCollapsed('[DEBUG] 抽出スニペット/言語 推定')
  console.log('intent:', intent); console.log('detected language:', bestLang); console.log('snippet:\n', best)
  console.groupEnd()
  return { snippet: best, lang: bestLang }
}

/* ===== コードブロック抽出（現在は未使用だが保持） ===== */
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

function guessStudentIdFromEmail(email?: string | null): string | null {
  if (!email) return null
  const m = email.match(/\d{7,}/)   // メール中の 7桁以上の数字を学籍番号候補として抽出
  return m ? m[0] : null
}

/* ================== Chat API ストリーム読取り ================== */
async function streamChat(
  message: string,
  onDelta?: (delta: string) => void,
  { idleMs = 30000 }: { idleMs?: number } = {}
): Promise<string> {
  const ac = new AbortController();
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal: ac.signal,
  });

  if (!res.body) {
    const text = await res.text().catch(() => '');
    if (text) onDelta?.(text);
    return text;
  }

  const isSSE = (res.headers.get('content-type') || '').includes('text/event-stream');
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');

  let full = '';
  let lastTick = Date.now();
  let sseBuffer = '';
  let doneBySentinel = false;

  const idleTimer = setInterval(() => {
    if (Date.now() - lastTick > idleMs) {
      try { ac.abort(); } catch {}
    }
  }, Math.min(5000, Math.max(1000, Math.floor(idleMs / 3))));

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      lastTick = Date.now();

      const chunk = decoder.decode(value, { stream: true });

      if (isSSE) {
        sseBuffer += chunk;
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() ?? '';

        for (const raw of lines) {
          const line = raw.trim();
          if (!line) continue;

          if (line.toLowerCase() === 'event: done') {
            doneBySentinel = true;
            await reader.cancel();
            break;
          }
          if (!line.startsWith('data:')) continue;

          const payload = line.slice(5).trim();
          if (!payload) continue;
          if (payload === '[DONE]') {
            doneBySentinel = true;
            await reader.cancel();
            break;
          }

          let delta = '';
          try {
            const j = JSON.parse(payload);
            delta = j?.choices?.[0]?.delta?.content ?? j?.choices?.[0]?.message?.content ?? '';
          } catch {
            delta = payload;
          }
          if (delta) {
            full += delta;
            onDelta?.(delta);
          }
        }
        if (doneBySentinel) break;
      } else {
        full += chunk;
        onDelta?.(chunk);
      }
    }
  } finally {
    clearInterval(idleTimer);
  }

  return full;
}

/* ================== 画面コンポーネント ================== */
export default function ChatPage() {
  const [allMessages, setAllMessages] = useState<{ [problemId: string]: Message[] }>({})
  const [loading, setLoading] = useState(false)
  const [problems, setProblems] = useState<Problem[]>([])
  const [problem, setProblem] = useState<Problem | null>(null)

  // 通常 / 採点モード
  const [gradingMode, setGradingMode] = useState(false)

  // ===== 通常モード：質問パターン（ステップ入力） =====
  const [questionMode, setQuestionMode] = useState<QuestionMode>('none')
  const [stepIndex, setStepIndex] = useState(0)
  const stepTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  // 課題の読み解き・進め方（3項目）
  const [taskWhere, setTaskWhere] = useState('')         // １：どの課題・どこで止まっているか
  const [taskUnderstand, setTaskUnderstand] = useState('') // ２：自分なりの理解
  const [taskStuck, setTaskStuck] = useState('')         // ３：どこで詰まっているか

  // エラー相談（2項目：テンプレ順に合わせる）
  const [errMessage, setErrMessage] = useState('') // １：エラーメッセージ全文
  const [errCode, setErrCode] = useState('')       // ２：実行したコード（全部）

  // 文法・書き方相談（2項目）
  const [hintQuestion, setHintQuestion] = useState('') // １：使いたいものの名前
  const [hintCode, setHintCode] = useState('')         // ２：どう動かしたいか（目的）

  // コードレビュー相談（3項目：テンプレ通り）
  const [reviewCode, setReviewCode] = useState('')
  const [reviewExpected, setReviewExpected] = useState('')
  const [reviewActual, setReviewActual] = useState('')

  // 理論・アルゴリズム相談（1項目）
  const [algoPoint, setAlgoPoint] = useState('')

  // 自由記述（1項目）
  const [freeText, setFreeText] = useState('')

  // ===== 採点モード UI =====
  const [gradingInputMode, setGradingInputMode] = useState<'files' | 'paste'>('files')
  const [gradingPaste, setGradingPaste] = useState('')
  const pasteTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  const bottomRef = useRef<HTMLDivElement | null>(null)

  // ===== 解決確認 =====
  const [waitingFeedback, setWaitingFeedback] = useState(false)
  const [lastAssistantIndex, setLastAssistantIndex] = useState<number | null>(null)
  // 20分・30分・40分コメントなどの「ナッジ」をためておくキュー
  const [pendingNudges, setPendingNudges] = useState<string[]>([])


  // ===== seatNumber / studentId 初期取得 & ログイン時の全タイマーリセット =====
  const [seatNumber, setSeatNumber] = useState<string | null>(null)
  const [studentId, setStudentId] = useState<string | null>(null)       // ★ 学籍番号
  const [studentDocId, setStudentDocId] = useState<string | null>(null) // ★ students ドキュメントID
  // TA呼び出し状態（この問題について TA を呼んだか）
  const [taRequested, setTaRequested] = useState(false)

  useEffect(() => {
    setSeatNumber(getSeatNumberFromStorage())
    const onStorage = () => setSeatNumber(getSeatNumberFromStorage())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        console.warn('[AUTH] user が null です');
        return;
      }
      try {
        // ★ 修正ポイント：
        //   直前にログインしていたユーザーと今回の user.uid が「異なるときだけ」
        //   問題ごとのローカルタイマーを全リセットする
        const prevUid = localStorage.getItem(TIMER_OWNER_KEY)
        if (prevUid && prevUid !== user.uid) {
          Object.keys(localStorage).forEach((k) => {
            if (k.startsWith('selAccum:') || k.startsWith('selStart:')) {
              localStorage.removeItem(k)
            }
          })
          setElapsedSec(0)
          setNudgeStage(0)
          nudgeStageRef.current = 0
          console.log('[AUTH] detect user change. local timers were reset.')
        } else {
          console.log('[AUTH] same user as before. keep local timers.')
        }
        // 現在のログインユーザーを記録
        localStorage.setItem(TIMER_OWNER_KEY, user.uid)

        const ref = doc(db, 'users', user.uid)
        const snap = await getDoc(ref)
        const data = snap.exists() ? (snap.data() as any) : null

        console.group('[AUTH] onAuthStateChanged');
        console.log('user.uid =', user.uid);
        console.log('user.email =', user.email);
        console.log('users doc exists? =', snap.exists());
        console.log('users data =', data);

        const fsSeat = normalizeSeatNumber(data?.seatNumber ?? null)
        console.log('fsSeat(from users.seatNumber) =', fsSeat);

        if (fsSeat && !getSeatNumberFromStorage()) {
          localStorage.setItem('seatNumber', fsSeat)
          setSeatNumber(fsSeat)
          console.log('=> seatNumber を localStorage / state に保存しました');
        }

        // ★ 学籍番号を users ドキュメント or メール から取得
        let sid: string | null = null
        if (data?.studentId) {
          sid = String(data.studentId)
          console.log('studentId from users.doc =', sid);
        } else {
          sid = guessStudentIdFromEmail(user.email)
          console.log('studentId guessed from email =', sid);
        }

        console.log('[AUTH] resolved studentId =', sid);
        console.groupEnd();

        setStudentId(sid || null)
      } catch (e) {
        console.warn('[seatNumber/studentId] fetch failed:', e)
      }
    })
    return () => unsub()
  }, [])



  // ★ seatNumber / studentId から students ドキュメントを用意
  useEffect(() => {
    console.group('[STUDENTS EFFECT]');
    const seat = normalizeSeatNumber(getSeatNumberFromStorage() ?? seatNumber ?? null)
    const docId = resolveStudentDocId()
    console.log('seat(from storage/state) =', seat);
    console.log('docId(from resolveStudentDocId) =', docId);

    if (!docId && !seat) {
      console.log('=> docId も seat も無いので何もしません');
      console.groupEnd();
      return;
    }
    if (!docId) {
      console.log('=> seat はあるが docId が無いので何もしません');
      console.groupEnd();
      return;
    }

    const ref = doc(db, 'students', docId)
    ;(async () => {
      try {
        const snap = await getDoc(ref)
        const existing = snap.exists() ? (snap.data() as any) : null
        console.log('students doc exists? =', snap.exists());
        console.log('existing data =', existing);

        const base: any = {
          updatedAt: serverTimestamp(),
          studentId: docId,
        }
        if (seat) base.seatNumber = seat
        if (!snap.exists()) {
          base.createdAt = serverTimestamp()
        }

        console.log('setDoc payload =', base);
        await setDoc(ref, base, { merge: true })

        if (existing && typeof existing.taRequested === 'boolean') {
          setTaRequested(existing.taRequested)
        }

        setStudentDocId(docId)
        // ★ 念のためここでも state にセット
        if (!studentId) {
          console.log('studentId state が空だったので docId を代入します');
          setStudentId(docId);
        }
      } catch (e) {
        console.warn('[students] ensure doc failed:', e)
      } finally {
        console.groupEnd();
      }
    })()
  }, [seatNumber, studentId])



  // ====== タイマー ======



  const [elapsedSec, setElapsedSec] = useState(0)
  const [nudgeStage, setNudgeStage] = useState(0)
  const lastTimerSyncRef = useRef<number>(0)
  const nudgeStageRef = useRef(0)
  const pad2 = (n: number) => n.toString().padStart(2, '0')
  const fmtHMS = (sec: number) => {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    return (h > 0 ? `${h}:${pad2(m)}` : `${m}`) + `:${pad2(s)}`
  }

  // 問題一覧
  useEffect(() => {
    const saved = localStorage.getItem('chatMessages')
    if (saved) setAllMessages(JSON.parse(saved))
    fetch('/api/problem').then((res) => res.json()).then(setProblems)
  }, [])
  useEffect(() => {
    localStorage.setItem('chatMessages', JSON.stringify(allMessages))
  }, [allMessages])
  useEffect(() => {
    lastTimerSyncRef.current = 0
  }, [problem?.id])

  // ★ students コレクションの timer / problem 情報を更新
  const updateStudentTimerForProblem = async (p: Problem, opts: UpdateTimerOpts = {}) => {
    const docId = resolveStudentDocId()
    console.group('[STUDENTS] updateStudentTimerForProblem');
    console.log('problemId =', p.id, 'title =', p.title);
    console.log('resolved docId =', docId);
    if (!docId) {
      console.warn('docId が無いので timer 情報を保存しません');
      console.groupEnd();
      return
    }

    const seat = normalizeSeatNumber(getSeatNumberFromStorage() ?? seatNumber ?? null)
    const ref = doc(db, 'students', docId)

    // ★ ローカルタイマーから「累積秒数」と「動作中かどうか」を取得
    const { sec: elapsedSec, running } = getLocalElapsedSec(p.id)

    const payload: any = {
      studentId: docId,
      seatNumber: seat ?? null,
      currentProblemId: p.id,
      currentProblemTitle: p.title,
      updatedAt: serverTimestamp(),

      // ▼ 座席マップ用：ローカルタイマーの状態
      timerBaseSec: elapsedSec,   // ここまでの累積秒
      timerRunning: running,      // いま動いているかどうか

      currentElapsedSec: elapsedSec,
    }

    // 動作中のときだけ「再開時刻（サーバー時刻）」を記録
    if (running) {
      payload.timerResumedAt = serverTimestamp()
    } else {
      payload.timerResumedAt = null
    }

    console.log('payload =', payload);
    try {
      await setDoc(ref, payload, { merge: true })
    } catch (e) {
      console.warn('[students] update timer failed:', e)
    } finally {
      console.groupEnd();
    }
  }


  // ★ TA 呼び出しフラグを更新
  const updateStudentTaRequest = async (requested: boolean) => {
    const docId = resolveStudentDocId()
    console.group('[TA] updateStudentTaRequest');
    console.log('requested =', requested);
    console.log('resolved docId =', docId);
    console.log('studentId state =', studentId, 'studentDocId state =', studentDocId);
    console.log('auth.currentUser?.email =', auth.currentUser?.email ?? null);

    if (!docId) {
      console.warn('[TA] studentId が取得されていませんでした')
      console.groupEnd();
      return
    }

    const ref = doc(db, 'students', docId)
    try {
      await setDoc(
        ref,
        {
          taRequested: requested,
          taRequestedAt: requested ? serverTimestamp() : null,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
      console.log('=> TA フラグを書き込みました');
    } catch (e) {
      console.warn('[students] update TA request failed:', e)
    } finally {
      console.groupEnd();
    }
  }

  const handleToggleTa = () => {
    if (!problem) return

    setTaRequested(prev => {
      const next = !prev
      console.log('[TA] ボタンクリック: prev -> next', prev, next)

      // Firestore 更新は非同期で投げる（失敗しても UI は変わる）
      updateStudentTaRequest(next).catch(e =>
        console.error('[TA] updateStudentTaRequest error', e)
      )

      return next
    })
  }

  const handleSelectProblem = (p: Problem) => {
    if (problem) pauseTimer(problem.id)

    setProblem(p)
    resumeTimer(p.id)

    // ★ ナッジ段階を問題ごとに復元（毎回リセットしない）
    const stage = readNudgeStage(p.id)
    setNudgeStage(stage)
    nudgeStageRef.current = stage

    setPendingNudges([])
    setTaRequested(false)

    updateStudentTimerForProblem(p, { resetTimer: true })
    updateStudentTaRequest(false)
  }

  // 経過秒 & ナッジ
  const NUDGE_FIRST = 2 * 60
  const NUDGE_SECOND = 3 * 60
  const TA_CALL_THRESHOLD_SEC = 4 * 60
  useEffect(() => {
    if (!problem) return

    const tick = () => {
      const { accum, runningAt } = readTimer(problem.id)
      const now = Date.now()
      const ms = accum + (now - (runningAt ?? now))
      const sec = Math.max(0, Math.floor(ms / 1000))
      setElapsedSec(sec)

      let stage = nudgeStageRef.current

      // 20分
      if (sec >= NUDGE_FIRST && stage < 1) {
        pushAssistant(
          '20分間取り組んでいますね。何かわからないことがあれば何でも質問してください。',
          { isNudge: true }
        )
        stage = 1
      }

      // 30分（あなたの設定では26分コメント）
      if (sec >= NUDGE_SECOND && stage < 2) {
        pushAssistant(
          '悩んでいる様子です。TAを呼んで一緒に解決しましょう。私に聞いても大丈夫です。',
          { isNudge: true }
        )
        stage = 2
      }

      // 40分
      if (sec >= TA_CALL_THRESHOLD_SEC && stage < 3) {
        pushAssistant(
          '40分以上同じ問題に取り組んでいるようです。\n' +
          '画面右上に「TAを呼ぶ」ボタンが表示されています。\n' +
          '人間のTAに来てもらいたい場合は、そのボタンを押してください。',
          { isNudge: true }
        )
        stage = 3
      }

      if (stage !== nudgeStageRef.current) {
        nudgeStageRef.current = stage
        setNudgeStage(stage)
        writeNudgeStage(problem.id, stage) // ★ 永続化
      }
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [problem, waitingFeedback, loading])

  const pushAssistant = (
    text: string,
    { isNudge = false }: { isNudge?: boolean } = {}
  ) => {
    if (!problem) return

    // ★ ナッジのとき、LLM ストリーミング中ならいったんキューに積む
    if (isNudge && loading) {
      setPendingNudges(prev => {
        // すでに同じ文面のナッジがキューにあるなら追加しない
        if (prev.includes(text)) return prev
        return [...prev, text]
      })
      return
    }

    setAllMessages(prev => {
      const cur = prev[problem.id] || []
      return {
        ...prev,
        [problem.id]: [
          ...cur,
          {
            role: 'assistant' as const,
            content: text,
            ...(isNudge ? { isNudge: true } : {}),
          },
        ],
      }
    })
  }

  // ★ ナッジの自動フラッシュ
  useEffect(() => {
    // 問題未選択 or ローディング中 or キュー空 → 何もしない
    if (!problem) return
    if (loading) return
    if (pendingNudges.length === 0) return

    // ローディングが終わったタイミングで、キューされていたナッジを順番に流す
    const texts = [...pendingNudges]
    setPendingNudges([])

    setAllMessages(prev => {
      const cur = prev[problem.id] || []

      return {
        ...prev,
        [problem.id]: [
          ...cur,
          ...texts.map(t => ({
            role: 'assistant' as const,
            content: t,
            isNudge: true,           // ★ ナッジであることを明示
          })),
        ],
      }
    })
  }, [loading, pendingNudges, problem])

  // ストリーミング更新
  const createStreamingAssistant = (initial = '') => {
    if (!problem) return null
    setAllMessages(prev => {
      const cur = prev[problem.id] || []
      return { ...prev, [problem.id]: [...cur, { role: 'assistant', content: initial }] }
    })
    return true
  }

  const updateLastAssistant = (text: string | ((prev: string) => string)) => {
    if (!problem) return
    setAllMessages(prev => {
      const cur = prev[problem.id] || []
      if (cur.length === 0) return prev
      const idx = cur.length - 1
      const old = cur[idx]
      const next = typeof text === 'function' ? (text as any)(old.content) : text
      const arr = cur.slice()
      arr[idx] = { ...old, content: next }
      return { ...prev, [problem.id]: arr }
    })
  }

  const messages: Message[] = useMemo(
    () => (problem ? allMessages[problem.id] || [] : []),
    [problem, allMessages]
  )

  const buildSummary = (msgs: Message[]) => {
    const summaryLimit = 500
    const userText = msgs.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
    return userText.length > summaryLimit ? userText.slice(-summaryLimit) : userText
  }

  /* ===== ステップUI用 定義 ===== */
  type StepConfig = {
    key: string
    label: string
    placeholder?: string
    value: string
    setValue: (v: string) => void
  }

  const questionTitle = useMemo(() => {
    switch (questionMode) {
      case 'task': return '課題の読み解き・進め方の相談'
      case 'error': return 'エラー・例外の相談'
      case 'syntax': return '文法・書き方の相談'
      case 'review': return 'コードレビュー・バグの相談'
      case 'algo': return '理論・アルゴリズムの相談'
      case 'free': return '自由記述の相談'
      default: return ''
    }
  }, [questionMode])

  const steps: StepConfig[] = useMemo(() => {
    const errorIntro = `【エラー・例外の相談】

※正確に判断するには、できるだけ詳しい情報が必要です…。
 私も完璧ではないので、いただいた情報が多いほど
 より正確に原因を特定できると思います。

`
    const syntaxIntro = `【文法・書き方の相談】

※あなたの理解度に合わせて説明したいので…
 どこまで理解していて、どこが不安なのか
 少しだけ教えていただけると助かります。

※２の「どう動かしたいか（目的）」は *任意* です。
 書ける範囲で構いませんが、書いてもらえると
 よりあなたの状況に合った説明がしやすくなります。

`
    const reviewIntro = `【コードレビュー・バグの相談】

※的確な指摘をするには、期待する動きと
 実際の動きを比べる必要があります。

`
    const algoIntro = `【理論・アルゴリズムの相談】

※あなたの理解度に合わせて説明したいので…
 どの部分が難しかったか、少しだけ教えてください。

`

    switch (questionMode) {
     case 'task':
       return [
         {
           key: 'task-where',
           label:
             '【課題の読み解き・作業工程の整理】\n\n' +
             '１：今取り組んでいる問題のどのあたりで止まっているか',
           placeholder: '例）課題3-2の～（問題文の具体的な個所）で止まっています など',
           value: taskWhere,
           setValue: setTaskWhere,
         },
         {
           key: 'task-understand',
           label:
             '２：自分なりに「何をする課題か」理解していること\n' +
             '   （分かっていること／分かったと思っていること）',
           placeholder: '例）入力された数を配列に入れて、合計を求める課題だと思っています など',
           value: taskUnderstand,
           setValue: setTaskUnderstand,
         },
         {
           key: 'task-stuck',
           label:
             '３：次に何をすればよいか分からないポイント\n' +
             '   （作業工程のどこが曖昧か・不安か）',
           placeholder: '例）配列に入れるところまではできたが、その後何をすれば良いか分からない など',
           value: taskStuck,
           setValue: setTaskStuck,
         },
       ]

      case 'error':
        return [
          {
            key: 'err-msg',
            label: errorIntro + '１：エラーメッセージ全文（コピペでOK）',
            placeholder: '例）Exception in thread "main" java.lang.NullPointerException ...',
            value: errMessage,
            setValue: setErrMessage,
          },
          {
            key: 'err-code',
            label: errorIntro + '２：実行したコード（全部）',
            placeholder: 'エラーが出ているクラスやメソッドを貼り付けてください。',
            value: errCode,
            setValue: setErrCode,
          },
        ]

      case 'syntax':
        return [
          {
            key: 'syn-name',
            label:
              syntaxIntro +
              '１：使いたいものの名前（メソッド / 変数）\n' +
              '   例：拡張for文、nextInt、length、parseInt など',
            placeholder: '例）拡張for文の書き方／nextInt の使い方 など',
            value: hintQuestion,
            setValue: setHintQuestion,
          },
          {
            key: 'syn-goal',
            label:
              syntaxIntro +
              '２：どう動かしたいか（目的）※任意（書ける範囲でOK）\n' +
              '   例：配列の全要素を順番に取り出したい など',
            placeholder:
              '（任意）例）配列の中身を順番に表示したい／文字列から1文字ずつ取り出したい など',
            value: hintCode,
            setValue: setHintCode,
          },
        ]

      case 'review':
        return [
          {
            key: 'rev-code',
            label: reviewIntro + '１：コード全体',
            placeholder: 'レビューしてほしいコードを貼り付けてください。',
            value: reviewCode,
            setValue: setReviewCode,
          },
          {
            key: 'rev-exp',
            label: reviewIntro + '２：期待していた出力・動作',
            placeholder: '例）1〜10までの合計が表示されるはず など',
            value: reviewExpected,
            setValue: setReviewExpected,
          },
          {
            key: 'rev-actual',
            label: reviewIntro + '３：実際に起こっている出力・動作',
            placeholder: '例）0が表示される／何も表示されない など',
            value: reviewActual,
            setValue: setReviewActual,
          },
        ]

      case 'algo':
        return [
          {
            key: 'algo-point',
            label: algoIntro + '１：理解できていないポイント\n（例：式の意味／処理の流れ／概念そのもの など）',
            placeholder: '例）再帰の終了条件が分からない／計算量O(n^2)の意味が分からない など',
            value: algoPoint,
            setValue: setAlgoPoint,
          },
        ]

      case 'free':
        return [
          {
            key: 'free',
            label: '【自由記述の相談】\n\n授業や課題に関することを自由に書いてください。',
            placeholder: '例）問題3-2でfor文の条件式がよく分かりません。今は〜のように考えています。',
            value: freeText,
            setValue: setFreeText,
          },
        ]

      default:
        return []
    }
  },  [
    questionMode,
    taskWhere, taskUnderstand, taskStuck,
    errMessage, errCode,
    hintQuestion, hintCode,
    reviewCode, reviewExpected, reviewActual,
    algoPoint, freeText,
  ])

  // モード変更時はステップを先頭に戻す
  useEffect(() => {
    setStepIndex(0)
  }, [questionMode])

  // ステップ切り替えごとにフォーカス
  useEffect(() => {
    if (!gradingMode && questionMode !== 'none') {
      setTimeout(() => stepTextareaRef.current?.focus(), 0)
    }
  }, [questionMode, stepIndex, gradingMode])

  // 現在の入力から送信テキストを組み立て
  const currentUserText = useMemo(() => {
    switch (questionMode) {
      case 'task': {
        const answers = [taskWhere, taskUnderstand, taskStuck]
        if (!answers.some(a => a.trim())) return ''
        return fillTemplate(TEMPLATE_TASK, answers)
      }
      case 'error': {
        const answers = [errMessage, errCode]
        if (!answers.some(a => a.trim())) return ''
        return fillTemplate(TEMPLATE_ERROR, answers)
      }
      case 'syntax': {
        const answers = [hintQuestion, hintCode]
        if (!answers.some(a => a.trim())) return ''
        return fillTemplate(TEMPLATE_SYNTAX, answers)
      }
      case 'review': {
        const answers = [reviewCode, reviewExpected, reviewActual]
        if (!answers.some(a => a.trim())) return ''
        return fillTemplate(TEMPLATE_REVIEW, answers)
      }
      case 'algo': {
        if (!algoPoint.trim()) return ''
        return fillTemplate(TEMPLATE_ALGO, [algoPoint])
      }
      case 'free':
        return freeText.trim() ? freeText : ''
      default:
        return ''
    }
  },  [
    questionMode,
    taskWhere, taskUnderstand, taskStuck,
    errMessage, errCode,
    hintQuestion, hintCode,
    reviewCode, reviewExpected, reviewActual,
    algoPoint, freeText,
  ])

  const currentLines = currentUserText ? currentUserText.split('\n').length : 0
  const currentChars = currentUserText.length

  // モードごとの「必須項目が埋まっているか」判定
  const isQuestionValid = useMemo(() => {
    switch (questionMode) {
      case 'task':
        // ①どの課題か ＋ ③どこで詰まっているか は必須、②は任意
        return !!taskWhere.trim() && !!taskStuck.trim()
      case 'error':
        return !!errMessage.trim() && !!errCode.trim()
      case 'syntax':
        // 「使いたいもの」は必須、「目的」は任意
        return !!hintQuestion.trim()
      case 'review':
        return !!reviewCode.trim() && !!reviewExpected.trim() && !!reviewActual.trim()
      case 'algo':
        return !!algoPoint.trim()
      case 'free':
        return !!freeText.trim()
      default:
        return false
    }
  },  [
    questionMode,
    taskWhere, taskUnderstand, taskStuck,
    errMessage, errCode,
    hintQuestion, hintCode,
    reviewCode, reviewExpected, reviewActual,
    algoPoint, freeText,
  ])

  /** 送信（通常モードのみ） */
  const sendWithContext = async (userContent: string, qType: QuestionTypeForLog) => {
    if (!userContent.trim() || !problem) return

    // ★ 課題文ほぼそのまま貼り付けチェック（文法・理論・自由記述・課題整理のみ）
    if (qType === 'syntax' || qType === 'algo' || qType === 'free' || qType === 'task') {
      if (looksLikeProblemCopy(problem.description || '', userContent)) {
        pushAssistant(
          '課題文そのもの、あるいは課題文の大部分がそのまま貼り付けられているようです。\n' +
          'このモードでは「どの部分が分からないか」「自分でどう考えたか」を書いて質問してください。\n' +
          '・課題文のうち、どの行／どの文が分からないのか\n' +
          'などを含めて、短く書き直してからもう一度送信してください。'
        )
        return
      }
    }

    // 1. チャット欄＆ログ用のユーザーメッセージはそのまま保存
    const userMessage: Message = {
      role: 'user',
      content: userContent,
      mode: gradingMode ? 'grading' : 'normal',
      questionType: qType,
    }
    const current = [...(allMessages[problem.id] || []), userMessage]
    setAllMessages({ ...allMessages, [problem.id]: current })

    // 2. LLM 用プロンプトをモード別に組み立て
    const summary = buildSummary(current)
    const langGuess = detectLang(userContent, problem)
    const lang = langGuess || 'java'
    const modeDesc = describeQuestionMode(qType)

    let promptForLLM = ''

    if (qType === 'error' || qType === 'review') {
      // (A) 模範コード全文（参考用）
      const exemplarForPrompt = (problem.solution_files || [])
        .map((f) => {
          const l = (f.language && f.language.trim()) || detectLang(f.code)
          return `// ${f.filename || '(no name)'}\n\`\`\`${l}\n${f.code}\n\`\`\``
        })
        .join('\n\n')

      // (B) 「コード例:」だけに適用する抽象化ルール
      const abstractionRules = buildAbstractionRulesForExample(lang)

      // (C) 最終プロンプト
      promptForLLM = String.raw`${BASE_TEACHER_PROMPT(lang)}

  【相談モード】
  ${modeDesc}

  【今回の授業内容（教員メモ）】
  ${CURRENT_LESSON_DESCRIPTION}

  【今回扱っている問題】
  ${problem.title}
  ${problem.description}

  【模範コード（参考・任意）】
  ${exemplarForPrompt || '(この問題には模範コードが設定されていません)'}

  【これまでの履歴要約】
  ${summary}

  【学生のコード・エラーや挙動の説明】
  ${userContent}

  【コード例の抽象化ルール】
  ${abstractionRules}

  ${outputRule(lang)}`
    }
 else if (qType === 'task') {
      // 🟧 課題の読み解き・作業工程の整理（コードは一切出さない）
      promptForLLM = String.raw`
あなたは、プログラミング課題の「読み解き」と「作業工程の整理」を手伝う教員です。

【重要制約】
- 具体的なコード例・疑似コード・数式の形のアルゴリズムは一切書かないでください。
- \`\`\` やコードブロック、セミコロン付きの行など、「そのまま写せば動きそうなもの」は出してはいけません。
- 代わりに、「課題文のどの部分をどう読むか」「どの順番で手を動かせば良いか」を日本語の文章と箇条書きだけで説明してください。

【相談モード】
${modeDesc}

【今回の授業内容（教員メモ）】
${CURRENT_LESSON_DESCRIPTION}

【今回扱っている問題】
${problem.title}
${problem.description}

【これまでの履歴要約】
${summary}

【学生の状況・考え】
${userContent}

[出力形式]
1) 課題のゴールの言い換え（1〜3文）
2) 作業工程のステップ（番号付きで3〜7ステップ程度）
3) 「今すぐできそうな最初の一歩」を1〜2文で提案
`.trim()
    } else if (qType === 'free') {
      // 🟪 自由記述：あいさつ・雑談用。コードは絶対に出さない＆5行以内
      promptForLLM = String.raw`${FREE_TEXT_PROMPT}

【相談モード】
${modeDesc}

【これまでの履歴要約】
${summary}

【学生の相談内容】
${userContent}
`
    } else {
      // 🟦 文法・書き方 / 🟨 理論・アルゴリズム
      // → 問題文・模範コードは送らず、変数名を変えるルール＋禁止識別子リストを追加
      const bannedIdList = extractIdentifiersFromSolutionFiles(problem.solution_files || [])
      const bannedSection = bannedIdList.length
        ? `\n【禁止識別子リスト（重要）】
以下の名前は現在の課題の模範コードで使われています。これらと同じ名前を新しく出すコード例に使ってはいけません：
${bannedIdList.join(', ')}
`
        : ''

      promptForLLM = String.raw`${BASE_TEACHER_PROMPT(lang)}

【相談モード】
${modeDesc}

【これまでの履歴要約】
${summary}

【学生の質問/考え】
${userContent}

[追加ルール（重要）]
- コード例を出すときは、現在授業で扱っている問題や模範コードで使われているものとは
  「全く違う変数名・メソッド名・クラス名」を使ってください。
  例: sum → totalX, count → itemCnt, Main → SampleDemo など。
- ただし、役割が分からなくならないように、意味が想像しやすい名前（value1, totalCount など）にしてください。
- 正解コード全体や、そのまま提出すると通ってしまう完成コードは出さないでください。
- あくまで「考え方」と「部分的なコード例」にとどめてください。
${bannedSection}
${outputRule(lang)}`
    }

    // 3. 1回の呼び出しでストリーミング表示
    setLoading(true)
    createStreamingAssistant('')

    try {
      await streamChat(promptForLLM, (delta) => {
        updateLastAssistant((prev) => (prev || '') + delta)
      })

      setLastAssistantIndex((allMessages[problem.id]?.length ?? 0) + 1)
      setWaitingFeedback(true)
    } catch (e) {
      console.error('[ERROR] 通常モードフロー失敗:', e)
      updateLastAssistant('処理中にエラーが発生しました。もう一度お試しください。')
      setWaitingFeedback(false)
    } finally {
      setLoading(false)
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 0)
    }
  }


  const handleSend = async () => {
    if (!problem || waitingFeedback || loading) return
    if (!isQuestionValid) return
    const text = currentUserText.trim()
    if (!text) return
    const qType: QuestionTypeForLog =
      questionMode === 'none' ? 'unknown' : questionMode

    await sendWithContext(text, qType)

    // 入力リセット
    switch (questionMode) {
      case 'task':
        setTaskWhere('')
        setTaskUnderstand('')
        setTaskStuck('')
        break
      case 'error':
        setErrMessage('')
        setErrCode('')
        break
      case 'syntax':
        setHintQuestion('')
        setHintCode('')
        break
      case 'review':
        setReviewCode('')
        setReviewExpected('')
        setReviewActual('')
        break
      case 'algo':
        setAlgoPoint('')
        break
      case 'free':
        setFreeText('')
        break
    }
    setQuestionMode('none')
  }

  /* ===== Firestore 保存（通常モードの会話ログ） ===== */
  const persistChatLog = async (resolved: boolean) => {
    try {
      if (!problem) return
      const seatRaw = getSeatNumberFromStorage() ?? seatNumber ?? null
      const seat = normalizeSeatNumber(seatRaw)
      const user = auth.currentUser

      const msgs = allMessages[problem.id] || []
      let assistantMessage = ''
      let userMessage = ''
      let userMode: 'normal' | 'grading' | null = null
      let userQuestionType: QuestionTypeForLog | null = null

      let aIdx = -1

      // ★ 1. まず「ナッジではない最後の assistant」を探す
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i]
        if (m.role === 'assistant' && !m.isNudge) {
          aIdx = i
          assistantMessage = m.content
          break
        }
      }

      // ★ 2. 見つからなければ（＝ナッジしかない場合）は従来通り最後の assistant を使う
      if (aIdx === -1) {
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i]
          if (m.role === 'assistant') {
            aIdx = i
            assistantMessage = m.content
            break
          }
        }
      }

      // assistant が 1つも無いならログを作らない
      if (aIdx === -1) {
        console.warn('[Firestore] no assistant message found, skip persistChatLog')
        return
      }

      // 直前の user を探す（従来通り）
      if (aIdx !== -1) {
        for (let j = aIdx - 1; j >= 0; j--) {
          const m = msgs[j]
          if (m.role === 'user') {
            userMessage = m.content
            userMode = m.mode ?? null
            userQuestionType = m.questionType ?? null
            break
          }
        }
      }
      if (!userMode) userMode = gradingMode ? 'grading' : 'normal'

      const { accum, runningAt } = readTimer(problem.id)
      const ms = accum + (runningAt ? (Date.now() - runningAt) : 0)
      const durationSec = Math.max(0, Math.floor(ms / 1000))

      await addDoc(collection(db, 'chatLogs'), {
        userMessage,
        assistantMessage,
        resolved,
        seatNumber: seat ?? null,
        studentId: studentId ?? null,
        problemTitle: problem.title,
        problemId: problem.id,
        userId: user?.uid ?? null,
        userEmail: user?.email ?? null,
        createdAt: serverTimestamp(),
        answeredAt: serverTimestamp(),
        durationSec,
        userMode,
        answerMode: gradingMode ? 'grading' : 'normal',
        questionType: userQuestionType ?? 'unknown',
      })
    } catch (e) {
      console.error('[Firestore] persistChatLog failed:', e)
    }
  }

  const answerFeedback = async (resolved: boolean) => {
    await persistChatLog(resolved)
    setWaitingFeedback(false)
    setLastAssistantIndex(null)
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

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, waitingFeedback])

  /* ================== 採点モード：ファイル提出 & 保存 ================== */
  const [uploads, setUploads] = useState<{ name: string; size: number; text: string }[]>([])
  const [gradingSaving, setGradingSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function handlePickFiles(files: FileList | null) {
    if (!files) return
    const exts = ['.java', '.c', '.cpp', '.py', '.cs', '.kt', '.js', '.ts', '.tsx']
    const readers = Array.from(files).map(async (f) => {
      if (!exts.some(ext => f.name.toLowerCase().endsWith(ext))) return null
      const text = await f.text()
      return { name: f.name, size: f.size, text }
    })
    Promise.all(readers).then(list => {
      const add = (list.filter(Boolean) as any[])
      setUploads(prev => [...prev, ...add])
    })
  }
  function removeUpload(idx: number) { setUploads(prev => prev.filter((_, i) => i !== idx)) }

  function handleDropOnFileZone(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    if (e.dataTransfer?.files?.length) handlePickFiles(e.dataTransfer.files)
  }

  function resolveStudentDocId(): string | null {
    const fromState = studentId;
    const fromStudentDoc = studentDocId;
    const fromEmail = guessStudentIdFromEmail(auth.currentUser?.email ?? null);

    console.group('[RESOLVE] resolveStudentDocId');
    console.log('studentId state =', fromState);
    console.log('studentDocId state =', fromStudentDoc);
    console.log('email =', auth.currentUser?.email ?? null);
    console.log('studentId guessed from email =', fromEmail);

    let result: string | null = null;
    if (fromState) result = fromState;
    else if (fromStudentDoc) result = fromStudentDoc;
    else if (fromEmail) result = fromEmail;

    console.log('=> resolved docId =', result);
    if (!result) console.warn('[RESOLVE] 学籍IDを決定できませんでした');
    console.groupEnd();

    return result;
  }


  async function safeGetDownloadURL(r: ReturnType<typeof sRef>, timeoutMs = 8000): Promise<string> {
    return await Promise.race<string>([
      getDownloadURL(r),
      new Promise((_, rej) => setTimeout(() => rej(new Error('getDownloadURL timeout')), timeoutMs)) as any
    ]);
  }

  async function safeUploadString(r: ReturnType<typeof sRef>, content: string, timeoutMs = 15015) {
    console.time(`[UPLOAD] ${r.fullPath}`);
    const res = await Promise.race([
      uploadString(r, content, 'raw', { contentType: 'text/plain; charset=utf-8' }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('uploadString timeout')), timeoutMs)),
    ]);
    console.timeEnd(`[UPLOAD] ${r.fullPath}`);
    return res;
  }

  async function handleGradingSubmit() {
    if (!problem) return
    if (gradingInputMode === 'files' && uploads.length === 0) return
    if (gradingInputMode === 'paste' && !gradingPaste.trim()) return

    setLoading(true); setGradingSaving(true)

    const filesForPrompt =
      gradingInputMode === 'paste'
        ? `// pasted_all.txt\n\`\`\`\n${gradingPaste}\n\`\`\``
        : uploads.map(u => `// ${u.name}\n\`\`\`\n${u.text}\n\`\`\``).join('\n\n')

    const exemplarForPrompt = (problem.solution_files||[])
      .map(f => `// ${f.filename}\n\`\`\`\n${f.code}\n\`\`\``).join('\n\n') || '(なし)'

    const prompt = `${GRADING_PROMPT}

【問題文】
${problem.description}

【模範コード（参考）】
${exemplarForPrompt}

【学生提出ファイル（全文）】
${filesForPrompt}
`

let fullGradingResult = ''   // ★ 追加：AI出力を溜める

createStreamingAssistant('')
  try {
    await streamChat(prompt, (delta) => {
      fullGradingResult += delta            // ★ 追加：deltaを累積
      updateLastAssistant((prev) => (prev || '') + delta) // 既存の表示更新は維持
    })
  } catch (e) {
    console.error('grading failed', e)
    updateLastAssistant('採点中にエラーが発生しました。もう一度お試しください。')
  }

  let saveOk = false
  try {
    // ★ 修正：空文字ではなく、溜めた採点結果を保存
    saveOk = await saveGradingSubmission(fullGradingResult.trim())
  } finally {
    setLoading(false)
    setGradingSaving(false)
    if (saveOk) {
      setUploads([])
      setGradingPaste('')
    }
  }
}

  async function saveGradingSubmission(gradingResult: string): Promise<boolean> {
    if (!problem) return false

    console.group('[SAVE] grading submission')
    const { accum, runningAt } = readTimer(problem.id)
    const ms = accum + (runningAt ? (Date.now() - runningAt) : 0)
    const durationSec = Math.max(0, Math.floor(ms / 1000))

    const storage = getStorage(undefined, 'gs://virtualta-916ce-9c6cd.firebasestorage.app')

    const uid = auth.currentUser?.uid ?? 'anon'
    const base = `gradingSubmissions/${problem.id}/${uid}/${Date.now()}`
    const startTs = Date.now()

    const watchdog = setTimeout(() => {
      console.error('[SAVE] watchdog fired (took >25s)')
    }, 25000)

    try {
      console.time('[SAVE] uploads')
      let uploaded: { name: string; size: number; storagePath: string; downloadURL: string }[] = []

      if (gradingInputMode === 'paste') {
        const name = 'pasted_all.txt'
        const content = gradingPaste
        const r = sRef(storage, `${base}/${name}`)
        await safeUploadString(r, content)
        const url = await safeGetDownloadURL(r)
        uploaded = [{ name, size: content.length, storagePath: r.fullPath, downloadURL: url }]
      } else if (uploads.length > 0) {
        uploaded = await Promise.all(
          uploads.map(async (u) => {
            const r = sRef(storage, `${base}/${u.name}`)
            await safeUploadString(r, u.text)
            const url = await safeGetDownloadURL(r)
            return { name: u.name, size: u.size, storagePath: r.fullPath, downloadURL: url }
          })
        )
      } else {
        console.warn('[SAVE] no files provided; result-only save')
      }
      console.timeEnd('[SAVE] uploads')

      console.time('[SAVE] addDoc')
      await addDoc(collection(db, 'submissions'), {
        mode: 'grading',
        problemId: problem.id,
        problemTitle: problem.title,
        userId: uid,
        userEmail: auth.currentUser?.email ?? null,
        seatNumber: normalizeSeatNumber(getSeatNumberFromStorage() ?? seatNumber ?? null),
        submittedAt: serverTimestamp(),
        durationSec,
        files: uploaded,
        gradingResult,
        inputMode: gradingInputMode,
        clientMeta: {
          ua: navigator.userAgent,
          tookMs: Date.now() - startTs,
        },
      })
      console.timeEnd('[SAVE] addDoc')
      console.log('[SAVE] done')
      return true
    } catch (e) {
      console.error('[SAVE] failed:', e)
      pushAssistant('保存でエラーが発生しました。ネットワーク/ログイン状態/Storage ルールをご確認ください。もう一度お試しください。')
      return false
    } finally {
      clearTimeout(watchdog)
      console.groupEnd()
    }
  }

  /* ============ 画面描画 ============ */
  const sendDisabled = !problem || loading || waitingFeedback || !isQuestionValid

  // ★ タイマー再開ボタンからも「ローカル累積タイムの状態」を students に反映  
  const handleTimerRestartClick = async () => {
    if (!problem || waitingFeedback) return
    pauseTimer(problem.id)
    resumeTimer(problem.id)
    await updateStudentTimerForProblem(problem, { resetTimer: true })
  }

  return (
    <>
      <main className="flex h-screen">
        {/* 左：問題リスト */}
        <div className="w-1/3 bg-gray-50 border-r p-4 overflow-y-auto">
          <h2 className="font-bold mb-2">問題を選択</h2>
          {problems.map((p) => (
            <button
              key={p.id}
              onClick={() => handleSelectProblem(p)}
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
              {/* ★ 学籍番号の表示 */}
              {studentId && (
                <span className="text-xs px-2 py-1 rounded border bg-white">
                  学籍: {studentId}
                </span>
              )}

              {seatNumber && (
                <span className="text-xs px-2 py-1 rounded border bg-white">
                  座席: {seatNumber}
                </span>
              )}

              {problem && (
                <span className="text-xs px-2 py-1 rounded border bg-white">
                  ⏱ 継続: {fmtHMS(elapsedSec)}
                </span>
              )}
              {/* 40分以上取り組んでいるときだけ TA 呼び出しボタンを表示 */}
              {/* TA呼び出しボタン（画像＋テキスト） */}
              {/* TA呼び出しボタン：常に表示してトグルできるようにする */}
              {problem && elapsedSec >= TA_CALL_THRESHOLD_SEC && (
                <button
                  type="button"
                  className={`border px-2 py-1 rounded text-xs ${
                    taRequested
                      ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                      : 'bg-rose-50 hover:bg-rose-100'
                  }`}
                  onClick={handleToggleTa}
                >
                  {taRequested ? '👋 TA呼び出し中（クリックでキャンセル）' : 'TAを呼ぶ'}
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4.mb-4">
            <div className="flex items-center gap-2">
              <span className={!gradingMode ? 'font-bold' : 'text-gray-400'}>通常モード</span>
              <label className="mx-2 relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={gradingMode}
                  onChange={(e) => { setGradingMode(e.target.checked); setQuestionMode('none') }}
                  disabled={waitingFeedback}
                />
                <div className={`w-11 h-6 rounded-full transition-all ${waitingFeedback ? 'bg-gray-300' : 'bg-gray-200 peer-checked:bg-green-500'}`} />
                <div className={`absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${gradingMode ? 'translate-x-full' : ''}`} />
              </label>
              <span className={gradingMode ? 'font-bold' : 'text-gray-400'}>採点モード</span>
            </div>

            {waitingFeedback && <span className="text-xs text-rose-600">※ 解決確認に回答するまで送信できません</span>}
          </div>

          {/* メッセージ表示 */}
          <div className="flex-1 space-y-4 overflow-y-auto">
            {messages.map((msg: Message, idx: number) => {
              const bubble = (
                <div
                  className={`p-3 rounded max-w-[75%] whitespace-pre-wrap break-words ${
                    msg.role === 'user' ? 'bg-blue-100' : 'bg-green-50'
                  }`}
                >
                  {(() => {
                    const parts = (() => {
                      const regex = /```(?:[a-zA-Z0-9#+-]*)?\n([\s\S]*?)```/g
                      const res: (string | { code: string })[] = []
                      let last = 0
                      let m: RegExpExecArray | null
                      while ((m = regex.exec(msg.content))) {
                        if (m.index > last) res.push(msg.content.slice(last, m.index))
                        res.push({ code: prettyCodeAuto(m[1] ?? '') })
                        last = regex.lastIndex
                      }
                      if (last < msg.content.length) res.push(msg.content.slice(last))
                      return res
                    })()
                    return parts.map((p, i) =>
                      typeof p === 'string' ? (
                        <p key={i}>{p}</p>
                      ) : (
                        <pre
                          key={i}
                          className="bg-gray-200 p-2 rounded overflow-x-auto text-sm"
                        >
                          <code>{p.code}</code>
                        </pre>
                      )
                    )
                  })()}
                </div>
              )

              // ★ 解決確認待ちのアシスタントメッセージだけ、
              //    「バブル＋アンケート」をまとめて表示するように変更
              if (
                msg.role === 'assistant' &&
                !msg.isNudge &&
                waitingFeedback &&
                (lastAssistantIndex === null || idx >= (lastAssistantIndex ?? 0))
              ) {
                return (
                  <div key={idx} className="space-y-2">
                    {/* 回答全文（つぶさない） */}
                    <div className="flex justify-start">{bubble}</div>

                    {/* 解決できたかアンケート */}
                    <div className="flex justify-start">
                      <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded px-3 py-2 text-sm flex items-center gap-2">
                        <span>この回答で問題は解決できましたか？</span>
                        <button
                          className="px-2 py-1 rounded bg-emerald-600 text-white hover:opacity-90"
                          onClick={() => answerFeedback(true)}
                        >
                          はい
                        </button>
                        <button
                          className="px-2 py-1 rounded bg-rose-600 text-white hover:opacity-90"
                          onClick={() => answerFeedback(false)}
                        >
                          いいえ
                        </button>
                      </div>
                    </div>
                  </div>
                )
              }

              // 通常表示
              return (
                <div
                  key={idx}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {bubble}
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          {/* ===== 採点モードUI ===== */}
          {problem && !waitingFeedback && gradingMode && (
            <div className="mb-3 border rounded p-3 bg-slate-50 space-y-3">
              <div className="text-sm font-semibold">採点モード提出（どちらか選択）</div>

              <div className="flex items-center gap-6 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="grading-input-mode"
                    value="files"
                    checked={gradingInputMode === 'files'}
                    onChange={() => setGradingInputMode('files')}
                  />
                  ファイル提出（複数可）
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="grading-input-mode"
                    value="paste"
                    checked={gradingInputMode === 'paste'}
                    onChange={() => { setGradingInputMode('paste'); setTimeout(()=>pasteTextareaRef.current?.focus(),0) }}
                  />
                  コード全文を貼り付ける
                </label>
              </div>

              {gradingInputMode === 'files' && (
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDropOnFileZone}
                  className="rounded-2xl border-2 border-dashed border-sky-300 bg-sky-50/70 hover:bg-sky-50 transition-colors p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-700">
                      .java / .c / .cpp / .py / .cs / .kt / .js / .ts / .tsx をこのエリアに<strong>ドラッグ&ドロップ</strong>できます。<br/>
                      下の「ファイルを選ぶ」からも追加可能。提出前は一覧から<strong>削除</strong>・<strong>追加</strong>ができます。
                    </p>
                    <label
                      className="cursor-pointer text-xs bg-sky-600 text-white px-3 py-1.5 rounded hover:opacity-90 shadow"
                      title="ファイル選択"
                    >
                      ファイルを選ぶ
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".java,.c,.cpp,.py,.cs,.kt,.js,.ts,.tsx"
                        onChange={(e) => { handlePickFiles(e.target.files); if (e.currentTarget) e.currentTarget.value = '' }}
                        className="hidden"
                      />
                    </label>
                  </div>

                  {uploads.length === 0 ? (
                    <div className="text-xs text-gray-500">ファイルの選択がまだありません。</div>
                  ) : (
                    <ul className="mt-1 text-xs divide-y rounded border bg-white">
                      {uploads.map((u, i) => (
                        <li key={`${u.name}-${i}`} className="flex items-center justify-between px-3 py-2">
                          <span className="truncate">{u.name}（{u.size}B）</span>
                          <button
                            className="text-rose-700 border border-rose-300 px-2 py-0.5 rounded hover:bg-rose-50"
                            onClick={() => removeUpload(i)}
                          >
                            削除
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {gradingInputMode === 'paste' && (
                <div className="space-y-2">
                  <div className="border-2 border-dashed rounded-2xl p-4 bg-white/70 hover:bg-white transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-semibold">ここに<strong>コード全文</strong>を貼り付け（Ctrl+V / ⌘V）</div>
                      <button
                        type="button"
                        className="text-xs border px-3 py-1 rounded hover:bg-gray-50"
                        onClick={() => pasteTextareaRef.current?.focus()}
                      >
                        クリップボードから貼り付け
                      </button>
                    </div>
                    <div className="mb-2 text-[12px] text-gray-600">
                      テキストやコードのファイルをドラッグ&ドロップしても読み込めます。
                    </div>
                    <AutoGrowTextarea
                      ref={pasteTextareaRef as any}
                      value={gradingPaste}
                      onChange={(e) => setGradingPaste(e.target.value)}
                      placeholder={`例）
                      /* あなたのプロジェクト全コード */
                      class Main { public static void main(String[] args) { /* ... */ } }
                      // 複数ファイルはそのまま連結でOK
                      `}
                      maxVh={50}
                      className="min-h-[16rem] rounded-xl"
                    />
                    <div className="mt-1 text-xs text-gray-600">
                      {gradingPaste.split('\n').length} 行 / {gradingPaste.length} 文字
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-2">
                <button
                  className="bg-emerald-600 text-white px-4 py-2 rounded disabled:opacity-50"
                  onClick={handleGradingSubmit}
                  disabled={
                    loading || gradingSaving || waitingFeedback || !problem ||
                    (gradingInputMode === 'files' && uploads.length === 0) ||
                    (gradingInputMode === 'paste' && !gradingPaste.trim())
                  }
                >
                  {gradingSaving ? '採点&保存中…' : '採点として提出'}
                </button>
              </div>

              <div className="text-[11px] text-gray-500">
                ※ 採点モードでは質問の受付は行いません（採点のみ）。ファイル提出と貼り付けの切り替えは提出前ならいつでも可能です。
              </div>
            </div>
          )}

          {/* ===== 通常モード：ステップ入力 UI ===== */}
          {!gradingMode && (
            <div className="mt-4 space-y-3">
              {/* 質問パターン選択 */}
              <div className="flex flex-wrap.items-center gap-2 text-xs">
                <span className="text-gray-600">質問のパターンから選ぶ：</span>

                {/* 🟧 課題の読み解き／作業工程の整理 */}
                <button
                  type="button"
                  className={`px-2 py-1 rounded border ${
                    questionMode === 'task'
                      ? 'bg-orange-200'
                      : 'bg-orange-50 hover:bg-orange-100'
                  }`}
                  onClick={() => setQuestionMode('task')}
                  disabled={!problem || waitingFeedback || loading}
                >
                  🟧 課題の読み解き・進め方
                </button>

                {/* 🟦 書き方 */}
                <button
                  type="button"
                  className={`px-2 py-1 rounded border ${
                    questionMode === 'syntax'
                      ? 'bg-blue-200'
                      : 'bg-blue-50 hover:bg-blue-100'
                  }`}
                  onClick={() => setQuestionMode('syntax')}
                  disabled={!problem || waitingFeedback || loading}
                >
                  🟦 書き方の相談
                </button>

                {/* 🟥 エラー */}
                <button
                  type="button"
                  className={`px-2 py-1 rounded border ${
                    questionMode === 'error'
                      ? 'bg-red-200'
                      : 'bg-red-50 hover:bg-red-100'
                  }`}
                  onClick={() => setQuestionMode('error')}
                  disabled={!problem || waitingFeedback || loading}
                >
                  🟥 エラー・例外の相談
                </button>

                {/* 🟩 コードレビュー */}
                <button
                  type="button"
                  className={`px-2 py-1 rounded border ${
                    questionMode === 'review'
                      ? 'bg-green-200'
                      : 'bg-green-50 hover:bg-green-100'
                  }`}
                  onClick={() => setQuestionMode('review')}
                  disabled={!problem || waitingFeedback || loading}
                >
                  🟩 コードレビュー・バグの相談
                </button>

                {/* 🟨 アルゴリズム */}
                <button
                  type="button"
                  className={`px-2 py-1 rounded border ${
                    questionMode === 'algo'
                      ? 'bg-yellow-200'
                      : 'bg-yellow-50 hover:bg-yellow-100'
                  }`}
                  onClick={() => setQuestionMode('algo')}
                  disabled={!problem || waitingFeedback || loading}
                >
                  🟨 アルゴリズム・理論の相談
                </button>

                {/* 🟪 自由記述 */}
                <button
                  type="button"
                  className={`px-2 py-1 rounded border ${
                    questionMode === 'free'
                      ? 'bg-purple-200'
                      : 'bg-purple-50 hover:bg-purple-100'
                  }`}
                  onClick={() => setQuestionMode('free')}
                  disabled={!problem || waitingFeedback || loading}
                >
                  🟪 自由記述の相談
                </button>
              </div>

              {/* パターン未選択時の案内 */}
              {questionMode === 'none' && (
                <div className="border rounded p-3 text-xs text-gray-600 bg-gray-50">
                  まず上のボタンのどれかを選んでください。選んだ内容に応じて、1項目ずつ入力する画面が表示されます。
                </div>
              )}

              {/* ステップ入力本体 */}
              {questionMode !== 'none' && (
                <div className="border rounded p-3 bg-white space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <div className="font-semibold">{questionTitle}</div>
                    <div className="text-gray-600">
                      入力 {steps.length === 0 ? '0/0' : `${stepIndex + 1}/${steps.length}`}
                    </div>
                  </div>

                  {steps.length > 0 && (
                    <>
                      {(() => {
                        const totalSteps = steps.length
                        const currentStep = steps[stepIndex]
                        const isLastStep = stepIndex === totalSteps - 1
                        const canGoNext = stepIndex < totalSteps - 1

                        return (
                          <>
                            <div className="space-y-1">
                              <div className="text-xs font-semibold whitespace-pre-wrap">
                                {currentStep.label}
                              </div>
                              <AutoGrowTextarea
                                ref={stepTextareaRef as any}
                                value={currentStep.value}
                                onChange={(e) => currentStep.setValue(e.target.value)}
                                placeholder={currentStep.placeholder}
                                maxVh={50}
                                className="min-h-[8rem] rounded-xl"
                                onKeyDown={(e) => {
                                  if (waitingFeedback || loading) return
                                  if (e.key === 'Tab') {
                                    e.preventDefault()
                                    const el = e.currentTarget
                                    const start = el.selectionStart ?? 0
                                    const end = el.selectionEnd ?? 0
                                    const indent = '  '
                                    const v = currentStep.value || ''
                                    const next = v.slice(0, start) + indent + v.slice(end)
                                    currentStep.setValue(next)
                                    requestAnimationFrame(() => {
                                      (el as any).selectionStart = (el as any).selectionEnd = start + indent.length
                                    })
                                  }
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault()
                                    const total = steps.length
                                    const isLast = stepIndex === total - 1
                                    if (isLast) {
                                      if (sendDisabled) return
                                      handleSend()
                                    } else {
                                      setStepIndex(stepIndex + 1)
                                    }
                                  }
                                }}
                              />
                            </div>

                            <div className="flex items-center justify-between text-xs mt-2">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  className="px-2 py-1 rounded border hover:bg-gray-50"
                                  onClick={() => setQuestionMode('none')}
                                >
                                  ← パターン選択に戻る
                                </button>
                                {steps.length > 1 && (
                                  <>
                                    <button
                                      type="button"
                                      className="px-2 py-1 rounded border hover:bg-gray-50 disabled:opacity-40"
                                      onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                                      disabled={stepIndex === 0}
                                    >
                                      ◀ 前へ
                                    </button>
                                    <button
                                      type="button"
                                      className="px-2 py-1 rounded border hover:bg-gray-50 disabled:opacity-40"
                                      onClick={() =>
                                        setStepIndex((i) => Math.min(steps.length - 1, i + 1))
                                      }
                                      disabled={!canGoNext}
                                    >
                                      次へ ▶
                                    </button>
                                  </>
                                )}
                              </div>

                              <div className="flex items-center gap-3">
                                <button
                                  className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
                                  onClick={handleSend}
                                  disabled={sendDisabled}
                                >
                                  {loading ? '送信中...' : '送信'}
                                </button>
                              </div>
                            </div>
                          </>
                        )
                      })()}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
