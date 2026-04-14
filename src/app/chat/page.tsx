// src/app/chat/page.tsx
'use client'
export const dynamic = 'force-dynamic';

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

import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

/* ================== テーマ（dark/light） ================== */
const THEME_KEY = 'theme' // 'light' | 'dark' | 'system'

function applyTheme(theme: 'light' | 'dark' | 'system') {
  const root = document.documentElement
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
  const shouldDark = theme === 'dark' || (theme === 'system' && prefersDark)
  root.classList.toggle('dark', !!shouldDark)
}

function readTheme(): 'light' | 'dark' | 'system' {
  const t = (localStorage.getItem(THEME_KEY) || 'system') as any
  if (t === 'light' || t === 'dark' || t === 'system') return t
  return 'system'
}

function writeTheme(t: 'light' | 'dark' | 'system') {
  localStorage.setItem(THEME_KEY, t)
}

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
        // ✅ light/dark 両対応
        'bg-white text-gray-900 border-gray-300',
        'dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700',
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

[文章構成ルール（最重要）]
- 全ての回答は必ず「結論ファースト（結論→理由・説明）」の順序で記述してください。
- 最初の1文目で、質問に対する直接的な答えや最も重要なポイント（結論）を端的に述べてください

[出力範囲の制限（最重要）]
- 学習者が質問した箇所以外の元素を出さない。
- 「全体像」や「次に書く部分」を先回りして出さない。

[最優先禁止ルール]
- 絶対に完成コードの提示禁止（位置だけ示す）。

[コード出力ルール]
- \`\`\`${lang}\`\`\` で、該当範囲のみ骨組みを出す。

[出力形式（長文禁止・可読性重視）]
アドバイス: 
- 必ず「結論ファースト（結論→補足説明）」の順に書くこと。
- 全体で3〜5文以内に収めること（長文禁止）。
- 重要な用語は**太字**にし、適宜箇条書きや空行を使ってパッと見て読める工夫をすること。
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
2) 未達/不正確: 箇条書きで3〜5点
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

【文章構成ルール（最重要）】
- 全ての回答は必ず「結論ファースト（結論→理由・説明）」の順序で記述してください。
- 最初の1文目で、質問に対する直接的な答えや最も重要なポイント（結論）を端的に述べてください。

【絶対に守るルール】
- コードや疑似コード、数式のような「プログラムとして使えそうなもの」は一切書かない。
- \`\`\` で囲んだコードブロックや、クラス名・メソッド名・変数名の例も出さない。
- Markdown の箇条書き（「- 」「1. 」など）も使わず、普通の文章だけで答える。

【出力形式（長文禁止・可読性重視）】
- 全ての回答は必ず「結論ファースト（結論→補足説明）」の順に書くこと。
- 日本語で 3〜5 文程度にまとめ、決して長文にしないこと。
- 空行や箇条書きを含めても、全体で **最大 5〜7 行以内** に収めること。
- 結論と補足の間に空行を入れる、重要な用語は**太字**にする、箇条書き（-）を使うなど、少ない文字数でもパッと見て理解できるよう視覚的に整理すること。
- 学生の気持ちを受け止めつつ、「次にどうすると良さそうか」を軽く提案すること。
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

４：今書いているコード全体
→
`

const TEMPLATE_ERROR = `【エラー・例外の相談】

１：エラーメッセージ全文（コピペでOK）
→

２：今取り組んでいるコード全体
→
`

const TEMPLATE_SYNTAX = `【文法・書き方の相談】

１：使いたいものの名前（メソッド / 変数）
→

２：どう動かしたいか（目的）
→
`

const TEMPLATE_REVIEW = `【コードレビュー・バグの相談】

１：今取り組んでいるコード全体
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
type QuestionMode = 'none' | 'task' | 'error' | 'syntax' | 'review' | 'algo' | 'free' | 'basic'
type QuestionTypeForLog = Exclude<QuestionMode, 'none'> | 'unknown'

type Message = {
  role: 'user' | 'assistant'
  content: string
  mode?: 'normal' | 'grading'
  questionType?: QuestionTypeForLog
  isNudge?: boolean
  isAbstractTemplate?: boolean
}
type ProblemFile = { filename: string; code: string; language?: string }

// ★ Chat画面用に visibleInChat を追加
type Problem = {
  id: string
  title: string
  description: string
  solution_files: ProblemFile[]
  visibleInChat?: boolean        // ← これを追加
}

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
    case 'basic':
      return '初歩的な質問・基礎概念（インスタンス、クラス、変数など）の相談です。初学者が理解しやすいように、専門用語を並べすぎず、身近な例えなどを用いて分かりやすく説明してください。'
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
    out.push(
      <mark
        key={`${m.index}-${m[0]}`}
        className="bg-transparent text-rose-700 font-semibold dark:text-rose-300"
      >
        {m[0]}
      </mark>
    )
    last = m.index + m[0].length
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}

function renderHighlightedDescription(desc: string) {
  if (!desc) return null;
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed 
                    prose-p:my-2 prose-headings:mb-2 prose-li:my-0
                    prose-hr:my-4 prose-strong:text-blue-600 dark:prose-strong:text-blue-400">
      <ReactMarkdown 
        remarkPlugins={[remarkMath]} 
        rehypePlugins={[rehypeKatex]}
        components={{
          // 型エラー解消の決定版： node, cite, ref を取り除いてから ...props を渡す
          blockquote: ({ node, cite, ref, children, ...props }: any) => {
              const { align, ...safeProps } = props;
              return (
                <div 
                  className="border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-900/20 p-4 my-4 rounded-r-md"
                  {...safeProps}
                >
                  {children}
                </div>
              );
            },

          // div の方も同様に node, ref を除外して安全性を高めます
          div: ({ node, ref, className, children, ...props }) => {
            if (className?.includes('math-display')) {
              return (
                <div className="my-6 text-center text-lg overflow-x-auto" {...props}>
                  {children}
                </div>
              );
            }
            return <div className={className} {...props}>{children}</div>;
          }
        }}
      >
        {desc}
      </ReactMarkdown>
    </div>
  )
}

/* ===== 課題文ほぼコピペ検知用ユーティリティ ===== */
const normalizeForCompare = (text: string): string =>
  (text || '')
    .replace(/\s/g, '')
    .replace(/[。、，,.]/g, '')

function looksLikeProblemCopy(desc: string, input: string): boolean {
  const a = normalizeForCompare(desc)
  const b = normalizeForCompare(input)

  if (a.length < 200) return false
  if (b.length < 80) return false

  const CHUNK = 60
  const STEP  = 30

  let hitLen = 0

  for (let i = 0; i + CHUNK <= a.length; i += STEP) {
    const chunk = a.slice(i, i + CHUNK)
    if (b.includes(chunk)) {
      hitLen += CHUNK
    }
  }

  const overlapRatio = hitLen / b.length
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

/** 抽象化コードであることを先頭コメントで明示する（すでに入っていれば何もしない） */
function ensureAbstractComment(code: string): string {
  const trimmed = code.trimStart()
  if (/抽象化コード例|抽象化テンプレート/.test(trimmed)) {
    return code
  }
  const lang = detectLang(code)
  const comment = asComment(lang, '【抽象化コード例】完成コードではありません。TODOを埋めてください。')
  return `${comment}\n${code}`
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
      if (/^[A-Z_]+$/.test(id)) continue
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
  const m = email.match(/\d{7,}/)
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
  const visibleProblems = useMemo<Problem[]>(() => problems, [problems])

  // 通常 / 採点モード
  const [gradingMode, setGradingMode] = useState(false)

  // ===== 通常モード：質問パターン（ステップ入力） =====
  const [questionMode, setQuestionMode] = useState<QuestionMode>('none')
  const [stepIndex, setStepIndex] = useState(0)
  const stepTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  // 課題の読み解き・進め方（4項目）
  const [taskWhere, setTaskWhere] = useState('')
  const [taskUnderstand, setTaskUnderstand] = useState('')
  const [taskStuck, setTaskStuck] = useState('')
  const [taskCode, setTaskCode] = useState('')

  // エラー相談（2項目）
  const [errMessage, setErrMessage] = useState('')
  const [errCode, setErrCode] = useState('')

  // 文法・書き方相談（2項目）
  const [hintQuestion, setHintQuestion] = useState('')
  const [hintCode, setHintCode] = useState('')

  // コードレビュー相談（3項目）
  const [reviewCode, setReviewCode] = useState('')
  const [reviewExpected, setReviewExpected] = useState('')
  const [reviewActual, setReviewActual] = useState('')

  // 理論・アルゴリズム相談（1項目）
  const [algoPoint, setAlgoPoint] = useState('')

  // 自由記述（1項目）
  const [freeText, setFreeText] = useState('')

  // 初歩的な質問（1項目）
  const [basicQuestion, setBasicQuestion] = useState('')

  // ===== 採点モード UI =====
  const [gradingInputMode, setGradingInputMode] = useState<'files' | 'paste'>('files')
  const [gradingPaste, setGradingPaste] = useState('')
  const pasteTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  const bottomRef = useRef<HTMLDivElement | null>(null)

  // ===== 解決確認 =====
  const [waitingFeedback, setWaitingFeedback] = useState(false)
  const [lastAssistantIndex, setLastAssistantIndex] = useState<number | null>(null)
  const [pendingNudges, setPendingNudges] = useState<string[]>([])

  // ===== seatNumber / studentId 初期取得 & ログイン時の全タイマーリセット =====
  const [seatNumber, setSeatNumber] = useState<string | null>(null)
  const [studentId, setStudentId] = useState<string | null>(null)
  const [studentDocId, setStudentDocId] = useState<string | null>(null)
  const [taRequested, setTaRequested] = useState(false)

  // ===== theme =====
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system')
  useEffect(() => {
    const t = readTheme()
    setTheme(t)
    applyTheme(t)

    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const onChange = () => {
      if (readTheme() === 'system') applyTheme('system')
    }
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])

  useEffect(() => {
    setSeatNumber(getSeatNumberFromStorage())
    const onStorage = () => setSeatNumber(getSeatNumberFromStorage())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        console.warn('[AUTH] user が null です')
        return
      }
      try {
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
        localStorage.setItem(TIMER_OWNER_KEY, user.uid)

        const ref = doc(db, 'users', user.uid)
        const snap = await getDoc(ref)
        const data = snap.exists() ? (snap.data() as any) : null

        console.group('[AUTH] onAuthStateChanged')
        console.log('user.uid =', user.uid)
        console.log('user.email =', user.email)
        console.log('users doc exists? =', snap.exists())
        console.log('users data =', data)

        const fsSeat = normalizeSeatNumber(data?.seatNumber ?? null)
        console.log('fsSeat(from users.seatNumber) =', fsSeat)

        if (fsSeat && !getSeatNumberFromStorage()) {
          localStorage.setItem('seatNumber', fsSeat)
          setSeatNumber(fsSeat)
          console.log('=> seatNumber を localStorage / state に保存しました')
        }

        let sid: string | null = null
        if (data?.studentId) {
          sid = String(data.studentId)
          console.log('studentId from users.doc =', sid)
        } else {
          sid = guessStudentIdFromEmail(user.email)
          console.log('studentId guessed from email =', sid)
        }

        console.log('[AUTH] resolved studentId =', sid)
        console.groupEnd()

        setStudentId(sid || null)
      } catch (e) {
        console.warn('[seatNumber/studentId] fetch failed:', e)
      }
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    // 1. まず ID と座席番号を取得
    const docId = resolveStudentDocId()
    const seat = normalizeSeatNumber(getSeatNumberFromStorage() ?? seatNumber ?? null)

    // 2. docId が無い（認証待ちなどの）間は、ログを出さずに静かに終了する
    // これによりコンソールの「学籍IDを決定できませんでした」というノイズが解消されます
    if (!docId) {
      return
    }

    // 3. ID が確定している場合のみ、同期処理とログ出力を開始
    console.group('[STUDENTS EFFECT]')
    console.log('seat(from storage/state) =', seat)
    console.log('docId(from resolveStudentDocId) =', docId)

    const ref = doc(db, 'students', docId)
    ;(async () => {
      try {
        const snap = await getDoc(ref)
        const existing = snap.exists() ? (snap.data() as any) : null
        console.log('students doc.exists? =', snap.exists())
        console.log('existing data =', existing)

        const base: any = {
          updatedAt: serverTimestamp(),
          studentId: docId,
        }
        if (seat) base.seatNumber = seat
        if (!snap.exists()) {
          base.createdAt = serverTimestamp()
        }

        console.log('setDoc.payload =', base)
        await setDoc(ref, base, { merge: true })

        if (existing && typeof existing.taRequested === 'boolean') {
          setTaRequested(existing.taRequested)
        }

        setStudentDocId(docId)
        if (!studentId) {
          console.log('studentId state が空だったので docId を代入します')
          setStudentId(docId)
        }
      } catch (e) {
        console.warn('[students] ensure doc failed:', e)
      } finally {
        console.groupEnd()
      }
    })()
  }, [seatNumber, studentId]) // studentId がセットされた瞬間に再実行されます

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

    fetch('/api/problem')
      .then((res) => res.json())
      .then((data: Problem[]) => {
        const visible = data.filter((p) => p.visibleInChat ?? true)
        setProblems(visible)
      })
  }, [])
  useEffect(() => {
    localStorage.setItem('chatMessages', JSON.stringify(allMessages))
  }, [allMessages])
  useEffect(() => {
    lastTimerSyncRef.current = 0
  }, [problem?.id])

  const updateStudentTimerForProblem = async (p: Problem, opts: UpdateTimerOpts = {}) => {
    const docId = resolveStudentDocId()
    console.group('[STUDENTS] updateStudentTimerForProblem')
    console.log('problemId =', p.id, 'title =', p.title)
    console.log('resolved docId =', docId)
    if (!docId) {
      console.warn('docId が無いので timer 情報を保存しません')
      console.groupEnd()
      return
    }

    const seat = normalizeSeatNumber(getSeatNumberFromStorage() ?? seatNumber ?? null)
    const ref = doc(db, 'students', docId)

    const { sec: elapsedSec, running } = getLocalElapsedSec(p.id)

    const payload: any = {
      studentId: docId,
      seatNumber: seat ?? null,
      currentProblemId: p.id,
      currentProblemTitle: p.title,
      updatedAt: serverTimestamp(),
      timerBaseSec: elapsedSec,
      timerRunning: running,
      currentElapsedSec: elapsedSec,
    }

    if (running) {
      payload.timerResumedAt = serverTimestamp()
    } else {
      payload.timerResumedAt = null
    }

    console.log('payload =', payload)
    try {
      await setDoc(ref, payload, { merge: true })
    } catch (e) {
      console.warn('[students] update timer failed:', e)
    } finally {
      console.groupEnd()
    }
  }

  const updateStudentTaRequest = async (requested: boolean) => {
    const docId = resolveStudentDocId()
    console.group('[TA] updateStudentTaRequest')
    console.log('requested =', requested)
    console.log('resolved docId =', docId)
    console.log('studentId state =', studentId, 'studentDocId state =', studentDocId)
    console.log('auth.currentUser?.email =', auth.currentUser?.email ?? null)

    if (!docId) {
      console.warn('[TA] studentId が取得されていませんでした')
      console.groupEnd()
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
      console.log('=> TA フラグを書き込みました')
    } catch (e) {
      console.warn('[students] update TA request failed:', e)
    } finally {
      console.groupEnd()
    }
  }

  const handleToggleTa = () => {
    if (!problem) return

    setTaRequested((prev) => {
      const next = !prev
      console.log('[TA] ボタンクリック: prev -> next', prev, next)
      updateStudentTaRequest(next).catch((e) =>
        console.error('[TA] updateStudentTaRequest error', e)
      )
      return next
    })
  }

  const handleSelectProblem = (p: Problem) => {
    if (problem) pauseTimer(problem.id)

    setProblem(p)
    resumeTimer(p.id)

    const stage = readNudgeStage(p.id)
    setNudgeStage(stage)
    nudgeStageRef.current = stage

    setPendingNudges([])
    setTaRequested(false)

    updateStudentTimerForProblem(p, { resetTimer: true })
    updateStudentTaRequest(false)
  }

  const NUDGE_FIRST = 20 * 60
  const NUDGE_SECOND = 30 * 60
  const TA_CALL_THRESHOLD_SEC = 40 * 60

  useEffect(() => {
    if (!problem) return

    const tick = () => {
      const { accum, runningAt } = readTimer(problem.id)
      const now = Date.now()
      const ms = accum + (now - (runningAt ?? now))
      const sec = Math.max(0, Math.floor(ms / 1000))
      setElapsedSec(sec)

      let stage = nudgeStageRef.current

      if (sec >= NUDGE_FIRST && stage < 1) {
        pushAssistant(
          '20分間取り組んでいますね。何かわからないことがあれば何でも質問してください。',
          { isNudge: true }
        )
        stage = 1
      }

      if (sec >= NUDGE_SECOND && stage < 2) {
        pushAssistant(
          '悩んでいる様子です。TAを呼んで一緒に解決しましょう。私に聞いても大丈夫です。',
          { isNudge: true }
        )
        stage = 2
      }

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
        writeNudgeStage(problem.id, stage)
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

    if (isNudge && loading) {
      setPendingNudges((prev) => {
        if (prev.includes(text)) return prev
        return [...prev, text]
      })
      return
    }

    setAllMessages((prev) => {
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

  useEffect(() => {
    if (!problem) return
    if (loading) return
    if (pendingNudges.length === 0) return

    const texts = [...pendingNudges]
    setPendingNudges([])

    setAllMessages((prev) => {
      const cur = prev[problem.id] || []

      return {
        ...prev,
        [problem.id]: [
          ...cur,
          ...texts.map((t) => ({
            role: 'assistant' as const,
            content: t,
            isNudge: true,
          })),
        ],
      }
    })
  }, [loading, pendingNudges, problem])

  const createStreamingAssistant = (
    initial = '',
    options?: { isAbstractTemplate?: boolean }
  ) => {
    if (!problem) return null
    const { isAbstractTemplate = false } = options || {}

    setAllMessages((prev) => {
      const cur = prev[problem.id] || []
      return {
        ...prev,
        [problem.id]: [
          ...cur,
          {
            role: 'assistant' as const,
            content: initial,
            ...(isAbstractTemplate ? { isAbstractTemplate: true } : {}),
          },
        ],
      }
    })
    return true
  }

  const updateLastAssistant = (text: string | ((prev: string) => string)) => {
    if (!problem) return
    setAllMessages((prev) => {
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
    const userText = msgs
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('\n')
    return userText.length > summaryLimit ? userText.slice(-summaryLimit) : userText
  }

  /* ===== ステップUI用 定義 ===== */
  type StepConfig = {
    key: string
    label: string
    placeholder?: string
    value: string
    setValue: (v: string) => void
    highlight?: boolean
  }

  const questionTitle = useMemo(() => {
    switch (questionMode) {
      case 'task':
        return '課題の読み解き・進め方の相談'
      case 'error':
        return 'エラー・例外の相談'
      case 'syntax':
        return '文法・書き方の相談'
      case 'review':
        return 'コードレビュー・バグの相談'
      case 'algo':
        return '理論・アルゴリズムの相談'
      case 'free':
        return '自由記述の相談'
      case 'basic':
        return '初歩的な質問'
      default:
        return ''
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
            placeholder:
              '例）入力された数を配列に入れて、合計を求める課題だと思っています など',
            value: taskUnderstand,
            setValue: setTaskUnderstand,
          },
          {
            key: 'task-stuck',
            label:
              '３：次に何をすればよいか分からないポイント\n' +
              '   （作業工程のどこが曖昧か・不安か）',
            placeholder:
              '例）配列に入れるところまではできたが、その後何をすれば良いか分からない など',
            value: taskStuck,
            setValue: setTaskStuck,
          },
          {
            key: 'task-code',
            label:
              '４：今書いているコード全体\n' +
              '   ※できるだけ、現在取り組んでいるコードを「全部」貼り付けてください。',
            placeholder:
              '例）Main.java 全文／他にクラスがあれば続けて全部貼り付けてください。',
            value: taskCode,
            setValue: setTaskCode,
            highlight: true,
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
            label:
              errorIntro +
              '２：今取り組んでいるコード全体\n' +
              '   ※必ず、現在のコードを「全部」貼り付けてください。',
            placeholder:
              '例）Main.java など、今実行しているコードを「全部」貼り付けてください。\n' +
              'ファイルが複数ある場合は、すべて続けて貼り付けてください。',
            value: errCode,
            setValue: setErrCode,
            highlight: true,
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
            label:
              reviewIntro +
              '１：今取り組んでいるコード全体\n' +
              '   ※必ず、現在のコードを「全部」貼り付けてください。',
            placeholder:
              'レビューしてほしいコードを、今書いている分を「全部」貼り付けてください。\n' +
              '複数ファイルがある場合は、順番にすべて貼り付けてください。',
            value: reviewCode,
            setValue: setReviewCode,
            highlight: true,
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
            label:
              algoIntro +
              '１：理解できていないポイント\n（例：式の意味／処理の流れ／概念そのもの など）',
            placeholder:
              '例）再帰の終了条件が分からない／計算量O(n^2)の意味が分からない など',
            value: algoPoint,
            setValue: setAlgoPoint,
          },
        ]

      case 'free':
        return [
          {
            key: 'free',
            label:
              '【自由記述の相談】\n\n授業や課題に関することを自由に書いてください。',
            placeholder:
              '例）問題3-2でfor文の条件式がよく分かりません。今は〜のように考えています。',
            value: freeText,
            setValue: setFreeText,
          },
        ]

      case 'basic':
        return [
          {
            key: 'basic-question',
            label: '【初歩的な質問】\n\n分からない用語や概念（例：インスタンス、クラスなど）について教えてください。',
            placeholder: '例）「インスタンス」とは何ですか？分かりやすく教えてください。',
            value: basicQuestion,
            setValue: setBasicQuestion,
          },
        ]  

      default:
        return []
    }
  }, [
    questionMode,
    taskWhere,
    taskUnderstand,
    taskStuck,
    taskCode,
    errMessage,
    errCode,
    hintQuestion,
    hintCode,
    reviewCode,
    reviewExpected,
    reviewActual,
    algoPoint,
    freeText,
    basicQuestion,
  ])

  useEffect(() => {
    setStepIndex(0)
  }, [questionMode])

  useEffect(() => {
    if (!gradingMode && questionMode !== 'none') {
      setTimeout(() => stepTextareaRef.current?.focus(), 0)
    }
  }, [questionMode, stepIndex, gradingMode])

  const currentUserText = useMemo(() => {
    switch (questionMode) {
      case 'task': {
        const answers = [taskWhere, taskUnderstand, taskStuck, taskCode]
        if (!answers.some((a) => a.trim())) return ''
        return fillTemplate(TEMPLATE_TASK, answers)
      }
      case 'error': {
        const answers = [errMessage, errCode]
        if (!answers.some((a) => a.trim())) return ''
        return fillTemplate(TEMPLATE_ERROR, answers)
      }
      case 'syntax': {
        const answers = [hintQuestion, hintCode]
        if (!answers.some((a) => a.trim())) return ''
        return fillTemplate(TEMPLATE_SYNTAX, answers)
      }
      case 'review': {
        const answers = [reviewCode, reviewExpected, reviewActual]
        if (!answers.some((a) => a.trim())) return ''
        return fillTemplate(TEMPLATE_REVIEW, answers)
      }
      case 'algo': {
        if (!algoPoint.trim()) return ''
        return fillTemplate(TEMPLATE_ALGO, [algoPoint])
      }
      case 'free':
        return freeText.trim() ? freeText : ''
      case 'basic':
        return basicQuestion.trim() ? basicQuestion.trim() : ''
      default:
        return ''
    }
  }, [
    questionMode,
    taskWhere,
    taskUnderstand,
    taskStuck,
    taskCode,
    errMessage,
    errCode,
    hintQuestion,
    hintCode,
    reviewCode,
    reviewExpected,
    reviewActual,
    algoPoint,
    freeText,
    basicQuestion,
  ])

  const currentLines = currentUserText ? currentUserText.split('\n').length : 0
  const currentChars = currentUserText.length

  const isQuestionValid = useMemo(() => {
    switch (questionMode) {
      case 'task':
        return !!taskWhere.trim() && !!taskStuck.trim()
      case 'error':
        return !!errMessage.trim() && !!errCode.trim()
      case 'syntax':
        return !!hintQuestion.trim()
      case 'review':
        return !!reviewCode.trim() && !!reviewExpected.trim() && !!reviewActual.trim()
      case 'algo':
        return !!algoPoint.trim()
      case 'free':
        return !!freeText.trim()
      case 'basic':
        return !!basicQuestion.trim()
      default:
        return false
    }
  }, [
    questionMode,
    taskWhere,
    taskStuck,
    errMessage,
    errCode,
    hintQuestion,
    reviewCode,
    reviewExpected,
    reviewActual,
    algoPoint,
    freeText,
    basicQuestion,
  ])

  const sendWithContext = async (userContent: string, qType: QuestionTypeForLog) => {
    if (!userContent.trim() || !problem) return

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

    const userMessage: Message = {
      role: 'user',
      content: userContent,
      mode: gradingMode ? 'grading' : 'normal',
      questionType: qType,
    }
    const current = [...(allMessages[problem.id] || []), userMessage]
    setAllMessages({ ...allMessages, [problem.id]: current })

    const summary = buildSummary(current)
    const langGuess = detectLang(userContent, problem)
    const lang = langGuess || 'java'
    const modeDesc = describeQuestionMode(qType)

    let promptForLLM = ''

    if (qType === 'error' || qType === 'review') {
      const exemplarForPrompt = (problem.solution_files || [])
        .map((f) => {
          const l = (f.language && f.language.trim()) || detectLang(f.code)
          return `// ${f.filename || '(no name)'}\n\`\`\`${l}\n${f.code}\n\`\`\``
        })
        .join('\n\n')

      const abstractionRules = buildAbstractionRulesForExample(lang)

      promptForLLM = String.raw`
      # 役割
      あなたは、プログラミングを正しく教えられる教員です。
      ${BASE_TEACHER_PROMPT(lang)}

      # 指導のスコープ（重要）
      以下の「模範コード」で使われている文法・アルゴリズムのみを正解の範囲としています。
      これに含まれない高度な記法（Stream APIやLambdaなど）は、学生が未修得の可能性があるため、絶対に使用しないでください。

      # インプットデータ
      - 相談モード: ${modeDesc}
      - 教員メモ: ${CURRENT_LESSON_DESCRIPTION}
      - 今回の問題: ${problem.title} / ${problem.description}
      - 模範コード（正解の基準）: 
      ${exemplarForPrompt || '(この問題には模範コードが設定されていません)'}

      - 履歴要約: ${summary}
      - 学生の提出内容:
      ${userContent}

      ---
      # 回答における絶対制約
      1. **結論ファースト**: 冒頭の1文目で、必ず質問に対する直接的な答え（バグの原因や修正方針）を述べてください。
      2. **完全抽象化**: 「コード例:」の中では、具体的な数値、文字列リテラル、複雑な演算式を一切出さないでください。必ずTODOコメント（例：// TODO: 演算式を書く）に置き換えてください。
      3. **文法制限**: アドバイスおよびコード例は、上記の「模範コード」で使用されている範囲の文法のみで構成してください。

      # フォーマット指定
      ${abstractionRules}
      ${outputRule(lang)}`
    } else if (qType === 'task') {
      promptForLLM = String.raw`
あなたは、プログラミング課題の「読み解き」と「作業工程の整理」を手伝う教員です。

【文章構成ルール（最重要）】
- 全ての回答は必ず「結論ファースト（結論→理由・説明）」の順序で記述してください。
- 最初の1文目で、質問に対する直接的な答えや最も重要なポイント（結論）を端的に述べてください。

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

【学生の状況・考え（コード全体を含む）】
${userContent}

[出力形式（長文禁止・可読性重視）]
以下の順序と制限を守り、パッと見て読める簡潔な文章で出力すること。
1) 結論：課題のゴールの言い換え（1〜2文で端的に）
2) 作業工程のステップ（番号付きで3〜5ステップ程度に絞る。重要なキーワードは**太字**にする）
3) 「今すぐできそうな最初の一歩」を1〜2文で提案
※ 各項目の間には空行を入れて視覚的な余白を作ること。

`.trim()
    } else if (qType === 'free' || qType === 'basic') {
      promptForLLM = String.raw`${FREE_TEXT_PROMPT}

【相談モード】
${modeDesc}

【これまでの履歴要約】
${summary}

【学生の相談内容】
${userContent}
`
    } else {
      const bannedIdList = extractIdentifiersFromSolutionFiles(problem.solution_files || [])
      const bannedSection = bannedIdList.length
        ? `\n【禁止識別子リスト（重要）】
以下の名前は現在の課題の模範コードで使われています。これらと同じ名前を新しく出すコード例に使ってはいけません：
${bannedIdList.join(', ')}

【今回扱っている問題】
${problem.title}
${problem.description}
`
        : ''

      const abstractionRules = buildAbstractionRulesForExample(lang)

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

【コード例の抽象化ルール】
${abstractionRules}

${outputRule(lang)}`
    }

    setLoading(true)

    const isAbstract =
      qType === 'error' ||
      qType === 'review' ||
      qType === 'syntax' ||
      qType === 'algo'

    createStreamingAssistant('', { isAbstractTemplate: isAbstract })

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
    const qType: QuestionTypeForLog = questionMode === 'none' ? 'unknown' : questionMode

    await sendWithContext(text, qType)

    switch (questionMode) {
      case 'task':
        setTaskWhere('')
        setTaskUnderstand('')
        setTaskStuck('')
        setTaskCode('')
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
      case 'basic':
        setBasicQuestion('')
        break
    }
    setQuestionMode('none')
  }

  const persistChatLog = async (resolved: boolean) => {
    try {
      if (!problem) return
      const seatRaw = getSeatNumberFromStorage() ?? seatNumber ?? null
      const seat = normalizeSeatNumber(seatRaw)
      const user = auth.currentUser
      const classId = localStorage.getItem('classId') || localStorage.getItem('class') || null;

      const msgs = allMessages[problem.id] || []
      let assistantMessage = ''
      let userMessage = ''
      let userMode: 'normal' | 'grading' | null = null
      let userQuestionType: QuestionTypeForLog | null = null

      let aIdx = -1

      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i]
        if (m.role === 'assistant' && !m.isNudge) {
          aIdx = i
          assistantMessage = m.content
          break
        }
      }

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

      if (aIdx === -1) {
        console.warn('[Firestore] no assistant message found, skip.persistChatLog')
        return
      }

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
      const ms = accum + (runningAt ? Date.now() - runningAt : 0)
      const durationSec = Math.max(0, Math.floor(ms / 1000))

      await addDoc(collection(db, 'chatLogs'), {
        userMessage,
        assistantMessage,
        resolved,
        seatNumber: seat ?? null,
        studentId: studentId ?? null,
        classId: classId,
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

  const [uploads, setUploads] = useState<{ name: string; size: number; text: string }[]>([])
  const [gradingSaving, setGradingSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function handlePickFiles(files: FileList | null) {
    if (!files) return
    const exts = ['.java', '.c', '.cpp', '.py', '.cs', '.kt', '.js', '.ts', '.tsx']
    const readers = Array.from(files).map(async (f) => {
      if (!exts.some((ext) => f.name.toLowerCase().endsWith(ext))) return null
      const text = await f.text()
      return { name: f.name, size: f.size, text }
    })
    Promise.all(readers).then((list) => {
      const add = list.filter(Boolean) as any[]
      setUploads((prev) => [...prev, ...add])
    })
  }
  function removeUpload(idx: number) {
    setUploads((prev) => prev.filter((_, i) => i !== idx))
  }

  function handleDropOnFileZone(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    if (e.dataTransfer?.files?.length) handlePickFiles(e.dataTransfer.files)
  }

  function resolveStudentDocId(): string | null {
    // 1. useState の値をチェック（最も確実な最新の状態）
    if (studentId) return studentId;
    if (studentDocId) return studentDocId;

    // 2. localStorage をチェック（リロードした瞬間に Auth より速く値を拾うため）
    const savedId = typeof window !== 'undefined' ? localStorage.getItem('studentId') : null;
    if (savedId) return savedId;

    // 3. Firebase Auth の現在の状態をチェック
    const user = auth.currentUser;
    if (user?.email) {
      const fromEmail = guessStudentIdFromEmail(user.email);
      if (fromEmail) return fromEmail;
    }
    return null;
  }

  async function safeGetDownloadURL(
    r: ReturnType<typeof sRef>,
    timeoutMs = 8000
  ): Promise<string> {
    return await Promise.race<string>([
      getDownloadURL(r),
      new Promise((_, rej) => setTimeout(() => rej(new Error('getDownloadURL timeout')), timeoutMs)) as any,
    ])
  }

  async function safeUploadString(
    r: ReturnType<typeof sRef>,
    content: string,
    timeoutMs = 15015
  ) {
    console.time(`[UPLOAD] ${r.fullPath}`)
    const res = await Promise.race([
      uploadString(r, content, 'raw', { contentType: 'text/plain; charset=utf-8' }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('uploadString timeout')), timeoutMs)),
    ])
    console.timeEnd(`[UPLOAD] ${r.fullPath}`)
    return res
  }

  async function handleGradingSubmit() {
    if (!problem) return
    if (gradingInputMode === 'files' && uploads.length === 0) return
    if (gradingInputMode === 'paste' && !gradingPaste.trim()) return

    setLoading(true)
    setGradingSaving(true)

    const filesForPrompt =
      gradingInputMode === 'paste'
        ? `// pasted_all.txt\n\`\`\`\n${gradingPaste}\n\`\`\``
        : uploads.map((u) => `// ${u.name}\n\`\`\`\n${u.text}\n\`\`\``).join('\n\n')

    const exemplarForPrompt =
      (problem.solution_files || [])
        .map((f) => `// ${f.filename}\n\`\`\`\n${f.code}\n\`\`\``)
        .join('\n\n') || '(なし)'

    const prompt = `${GRADING_PROMPT}

【問題文】
${problem.description}

【模範コード（参考）】
${exemplarForPrompt}

【学生提出ファイル（全文）】
${filesForPrompt}
`

    let fullGradingResult = ''

    createStreamingAssistant('')
    try {
      await streamChat(prompt, (delta) => {
        fullGradingResult += delta
        updateLastAssistant((prev) => (prev || '') + delta)
      })
    } catch (e) {
      console.error('grading failed', e)
      updateLastAssistant('採点中にエラーが発生しました。もう一度お試しください。')
    }

    let saveOk = false
    try {
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
    const ms = accum + (runningAt ? Date.now() - runningAt : 0)
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
      pushAssistant(
        '保存でエラーが発生しました。ネットワーク/ログイン状態/Storage ルールをご確認ください。もう一度お試しください。'
      )
      return false
    } finally {
      clearTimeout(watchdog)
      console.groupEnd()
    }
  }

  const sendDisabled = !problem || loading || waitingFeedback || !isQuestionValid

  const handleTimerRestartClick = async () => {
    if (!problem || waitingFeedback) return
    pauseTimer(problem.id)
    resumeTimer(problem.id)
    await updateStudentTimerForProblem(problem, { resetTimer: true })
  }

  return (
    <>
      <main className="flex h-screen bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
        {/* 左：問題リスト */}
        <div className="w-1/3 border-r p-4 overflow-y-auto
                        bg-gray-50 text-gray-900 border-gray-200
                        dark:bg-gray-900 dark:text-gray-100 dark:border-gray-800">
          <h2 className="font-bold mb-2">問題を選択</h2>
          {visibleProblems.map((p) => (
            <button
              key={p.id}
              onClick={() => handleSelectProblem(p)}
              className={`block w-full text-left p-2 mb-2 rounded border
                ${problem?.id === p.id
                  ? 'bg-blue-100 border-blue-200 dark:bg-blue-900/35 dark:border-blue-800'
                  : 'bg-transparent border-transparent hover:bg-blue-50 dark:hover:bg-gray-800'
                }`}
            >
              {p.title}
            </button>
          ))}
          <div className="mt-4 border-t pt-3 border-gray-200 dark:border-gray-800">
            <h3 className="font-semibold text-sm text-gray-700 dark:text-gray-200 mb-2">選択中の問題</h3>
            {problem ? (
              <div className="bg-white border rounded p-3 border-gray-200
                              dark:bg-gray-950 dark:border-gray-800">
                <div className="text-sm font-bold mb-2">{problem.title}</div>
                {renderHighlightedDescription(problem.description || '（問題文が未設定です）')}
              </div>
            ) : (
              <div className="text-xs text-gray-500 dark:text-gray-400">左のリストから問題を選んでください。</div>
            )}
          </div>
        </div>

        {/* 右：チャット */}
        <div className="flex-1 p-4 flex flex-col bg-white dark:bg-gray-950">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-xl font-bold">{problem?.title || '問題未選択'}</h1>
            <div className="flex items-center gap-3">
              {/* theme toggle */}
              {studentId && (
                <span className="text-xs px-2 py-1 rounded border
                                 bg-white text-gray-700 border-gray-200
                                 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700">
                  学籍: {studentId}
                </span>
              )}

              {seatNumber && (
                <span className="text-xs px-2 py-1 rounded border
                                 bg-white text-gray-700 border-gray-200
                                 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700">
                  座席: {seatNumber}
                </span>
              )}

              {problem && (
                <span className="text-xs px-2 py-1 rounded border
                                 bg-white text-gray-700 border-gray-200
                                 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700">
                  ⏱ 継続: {fmtHMS(elapsedSec)}
                </span>
              )}

              {problem && elapsedSec >= TA_CALL_THRESHOLD_SEC && (
                <button
                  type="button"
                  className={`border px-2 py-1 rounded text-xs
                    dark:border-gray-700
                    ${taRequested
                      ? 'bg-rose-100 text-rose-700 border-rose-200 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-200 dark:hover:bg-rose-900/45'
                      : 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100 dark:bg-rose-900/20 dark:text-rose-200 dark:hover:bg-rose-900/35'
                    }`}
                  onClick={handleToggleTa}
                >
                  {taRequested ? '👋 TA呼び出し中（クリックでキャンセル）' : 'TAを呼ぶ'}
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              <span className={!gradingMode ? 'font-bold' : 'text-gray-400 dark:text-gray-500'}>通常モード</span>
              <label className="mx-2 relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={gradingMode}
                  onChange={(e) => {
                    setGradingMode(e.target.checked)
                    setQuestionMode('none')
                  }}
                  disabled={waitingFeedback}
                />
                <div
                  className={`w-11 h-6 rounded-full transition-all ${
                    waitingFeedback ? 'bg-gray-300 dark:bg-gray-700' : 'bg-gray-200 dark:bg-gray-700 peer-checked:bg-green-500'
                  }`}
                />
                <div
                  className={`absolute left-0.5 top-0.5 w-5 h-5 bg-white dark:bg-gray-100 rounded-full shadow transition-all ${
                    gradingMode ? 'translate-x-full' : ''
                  }`}
                />
              </label>
              <span className={gradingMode ? 'font-bold' : 'text-gray-400 dark:text-gray-500'}>採点モード</span>
            </div>

            {waitingFeedback && (
              <span className="text-xs text-rose-600 dark:text-rose-300">
                ※ 解決確認に回答するまで送信できません
              </span>
            )}
          </div>

          {/* メッセージ表示 */}
          <div className="flex-1 space-y-4 overflow-y-auto">
            {messages.map((msg: Message, idx: number) => {
              const bubble = (
                <div
                  className={`p-3 rounded max-w-[75%] whitespace-pre-wrap break-words border
                    ${
                      msg.role === 'user'
                        ? 'bg-blue-100 text-gray-900 border-blue-200 dark:bg-blue-900/35 dark:text-gray-100 dark:border-blue-800'
                        : 'bg-emerald-50 text-gray-900 border-emerald-100 dark:bg-emerald-900/20 dark:text-gray-100 dark:border-emerald-800/40'
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

                        let rawCode = m[1] ?? ''

                        if (msg.role === 'assistant' && msg.isAbstractTemplate) {
                          rawCode = ensureAbstractComment(rawCode)
                        }

                        res.push({ code: prettyCodeAuto(rawCode) })
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
                          className="p-2 rounded overflow-x-auto text-sm border
                                     bg-gray-100 border-gray-200
                                     dark:bg-gray-900 dark:border-gray-800"
                        >
                          <code>{p.code}</code>
                        </pre>
                      )
                    )
                  })()}
                </div>
              )

              if (
                msg.role === 'assistant' &&
                !msg.isNudge &&
                waitingFeedback &&
                (lastAssistantIndex === null || idx >= (lastAssistantIndex ?? 0))
              ) {
                return (
                  <div key={idx} className="space-y-2">
                    <div className="flex justify-start">{bubble}</div>

                    <div className="flex justify-start">
                      <div className="border rounded px-3 py-2 text-sm flex items-center gap-2
                                      bg-amber-50 border-amber-200 text-amber-900
                                      dark:bg-amber-900/25 dark:border-amber-800 dark:text-amber-100">
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

          {/* 採点モードUI */}
          {problem && !waitingFeedback && gradingMode && (
            <div
              className="mb-3 border rounded p-3 bg-slate-50 space-y-3
                        dark:bg-gray-900 dark:border-gray-800"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">採点モード：提出を入力</div>
                <div className="text-xs text-gray-600 dark:text-gray-300">
                  {gradingSaving ? '保存中…' : loading ? '採点中…' : ''}
                </div>
              </div>

              {/* 入力方式切替 */}
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  className={`px-2 py-1 rounded border ${
                    gradingInputMode === 'files'
                      ? 'bg-emerald-200 border-emerald-300'
                      : 'bg-white border-gray-200 hover:bg-gray-50 dark:bg-gray-950 dark:border-gray-700 dark:hover:bg-gray-800'
                  }`}
                  onClick={() => setGradingInputMode('files')}
                  disabled={loading || gradingSaving}
                >
                  📁 ファイル提出
                </button>
                <button
                  type="button"
                  className={`px-2 py-1 rounded border ${
                    gradingInputMode === 'paste'
                      ? 'bg-emerald-200 border-emerald-300'
                      : 'bg-white border-gray-200 hover:bg-gray-50 dark:bg-gray-950 dark:border-gray-700 dark:hover:bg-gray-800'
                  }`}
                  onClick={() => setGradingInputMode('paste')}
                  disabled={loading || gradingSaving}
                >
                  📋 貼り付け提出
                </button>

                <div className="ml-auto text-xs text-gray-600 dark:text-gray-300">
                  ※ ここで送信すると「採点＋提出保存」まで行います
                </div>
              </div>

              {/* files */}
              {gradingInputMode === 'files' && (
                <div className="space-y-2">
                  <div
                    className="border-2 border-dashed rounded p-4 text-sm
                              bg-white border-gray-200 text-gray-700
                              dark:bg-gray-950 dark:border-gray-700 dark:text-gray-200"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDropOnFileZone}
                  >
                    <div className="font-semibold mb-1">ここに .java / .c / .cpp / .py / .ts などをドラッグ&ドロップ</div>
                    <div className="text-xs mb-2 text-gray-600 dark:text-gray-300">
                      または「ファイル選択」から追加できます（複数可）
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          handlePickFiles(e.target.files)
                          // 同じファイルを再選択できるようにする
                          e.currentTarget.value = ''
                        }}
                      />
                      <button
                        type="button"
                        className="px-3 py-2 rounded bg-blue-600 text-white text-xs hover:opacity-90 disabled:opacity-50"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={loading || gradingSaving}
                      >
                        ファイル選択
                      </button>

                      <button
                        type="button"
                        className="px-3 py-2 rounded border text-xs
                                  bg-white border-gray-200 hover:bg-gray-50
                                  dark:bg-gray-950 dark:border-gray-700 dark:hover:bg-gray-800
                                  disabled:opacity-50"
                        onClick={() => setUploads([])}
                        disabled={loading || gradingSaving || uploads.length === 0}
                      >
                        クリア
                      </button>
                    </div>
                  </div>

                  {uploads.length > 0 && (
                    <div className="border rounded p-3 bg-white space-y-2 border-gray-200
                                    dark:bg-gray-950 dark:border-gray-700">
                      <div className="text-xs font-semibold">選択中のファイル</div>
                      <div className="space-y-1">
                        {uploads.map((u, idx) => (
                          <div
                            key={`${u.name}-${idx}`}
                            className="flex items-center justify-between gap-2 text-xs border rounded px-2 py-1
                                      border-gray-200 bg-gray-50
                                      dark:border-gray-700 dark:bg-gray-900"
                          >
                            <div className="truncate">
                              <span className="font-mono">{u.name}</span>
                              <span className="ml-2 text-gray-500 dark:text-gray-300">
                                ({Math.round(u.size / 1024)} KB)
                              </span>
                            </div>
                            <button
                              type="button"
                              className="px-2 py-1 rounded bg-rose-600 text-white hover:opacity-90 disabled:opacity-50"
                              onClick={() => removeUpload(idx)}
                              disabled={loading || gradingSaving}
                            >
                              削除
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* paste */}
              {gradingInputMode === 'paste' && (
                <div className="space-y-2">
                  <div className="text-xs text-gray-700 dark:text-gray-200">
                    複数ファイルでも、区切りを書いてまとめて貼ってOKです（例：// Main.java など）。
                  </div>
                  <AutoGrowTextarea
                    ref={pasteTextareaRef as any}
                    value={gradingPaste}
                    onChange={(e) => setGradingPaste(e.target.value)}
                    placeholder={'例）// Main.java\n...\n\n// Sub.java\n...'}
                    maxVh={45}
                    className="min-h-[12rem] rounded-xl"
                    disabled={loading || gradingSaving}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="px-3 py-2 rounded border text-xs
                                bg-white border-gray-200 hover:bg-gray-50
                                dark:bg-gray-950 dark:border-gray-700 dark:hover:bg-gray-800
                                disabled:opacity-50"
                      onClick={() => setGradingPaste('')}
                      disabled={loading || gradingSaving || !gradingPaste}
                    >
                      クリア
                    </button>
                  </div>
                </div>
              )}

              {/* submit */}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  className="px-4 py-2 rounded bg-emerald-600 text-white text-sm hover:opacity-90 disabled:opacity-50"
                  onClick={handleGradingSubmit}
                  disabled={
                    loading ||
                    gradingSaving ||
                    !problem ||
                    (gradingInputMode === 'files' ? uploads.length === 0 : !gradingPaste.trim())
                  }
                >
                  {loading ? '採点中…' : '採点して保存'}
                </button>
              </div>
            </div>
          )}

          {/* 通常モード：ステップ入力 UI */}
          {!gradingMode && (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-gray-600 dark:text-gray-300">質問のパターンから選ぶ：</span>

                <button
                  type="button"
                  className={`px-2 py-1 rounded border ${
                    questionMode === 'task'
                      ? 'bg-orange-200 border-orange-300'
                      : 'bg-orange-50 border-orange-200 hover:bg-orange-100'
                  } dark:border-gray-700 ${
                    questionMode === 'task'
                      ? 'dark:bg-orange-900/25'
                      : 'dark:bg-gray-900 dark:hover:bg-gray-800'
                  }`}
                  onClick={() => setQuestionMode('task')}
                  disabled={!problem || waitingFeedback || loading}
                >
                  🟧 課題の読み解き・進め方
                </button>

                <button
                  type="button"
                  className={`px-2 py-1 rounded border ${
                    questionMode === 'syntax'
                      ? 'bg-blue-200 border-blue-300'
                      : 'bg-blue-50 border-blue-200 hover:bg-blue-100'
                  } dark:border-gray-700 ${
                    questionMode === 'syntax'
                      ? 'dark:bg-blue-900/25'
                      : 'dark:bg-gray-900 dark:hover:bg-gray-800'
                  }`}
                  onClick={() => setQuestionMode('syntax')}
                  disabled={!problem || waitingFeedback || loading}
                >
                  🟦 書き方の相談
                </button>

                <button
                  type="button"
                  className={`px-2 py-1 rounded border ${
                    questionMode === 'error'
                      ? 'bg-red-200 border-red-300'
                      : 'bg-red-50 border-red-200 hover:bg-red-100'
                  } dark:border-gray-700 ${
                    questionMode === 'error'
                      ? 'dark:bg-rose-900/25'
                      : 'dark:bg-gray-900 dark:hover:bg-gray-800'
                  }`}
                  onClick={() => setQuestionMode('error')}
                  disabled={!problem || waitingFeedback || loading}
                >
                  🟥 エラー・例外の相談
                </button>

                <button
                  type="button"
                  className={`px-2 py-1 rounded border ${
                    questionMode === 'review'
                      ? 'bg-green-200 border-green-300'
                      : 'bg-green-50 border-green-200 hover:bg-green-100'
                  } dark:border-gray-700 ${
                    questionMode === 'review'
                      ? 'dark:bg-emerald-900/25'
                      : 'dark:bg-gray-900 dark:hover:bg-gray-800'
                  }`}
                  onClick={() => setQuestionMode('review')}
                  disabled={!problem || waitingFeedback || loading}
                >
                  🟩 コードレビュー・バグの相談
                </button>

                <button
                  type="button"
                  className={`px-2 py-1 rounded border ${
                    questionMode === 'algo'
                      ? 'bg-yellow-200 border-yellow-300'
                      : 'bg-yellow-50 border-yellow-200 hover:bg-yellow-100'
                  } dark:border-gray-700 ${
                    questionMode === 'algo'
                      ? 'dark:bg-yellow-900/25'
                      : 'dark:bg-gray-900 dark:hover:bg-gray-800'
                  }`}
                  onClick={() => setQuestionMode('algo')}
                  disabled={!problem || waitingFeedback || loading}
                >
                  🟨 アルゴリズム・理論の相談
                </button>

                <button
                  type="button"
                  className={`px-2 py-1 rounded border ${
                    questionMode === 'free'
                      ? 'bg-purple-200 border-purple-300'
                      : 'bg-purple-50 border-purple-200 hover:bg-purple-100'
                  } dark:border-gray-700 ${
                    questionMode === 'free'
                      ? 'dark:bg-purple-900/25'
                      : 'dark:bg-gray-900 dark:hover:bg-gray-800'
                  }`}
                  onClick={() => setQuestionMode('free')}
                  disabled={!problem || waitingFeedback || loading}
                >
                  🟪 自由記述の相談
                </button>

                <button
                  type="button"
                  className={`px-2 py-1 rounded border ${
                    questionMode === 'basic'
                      ? 'bg-pink-200 border-pink-300'
                      : 'bg-pink-50 border-pink-200 hover:bg-pink-100'
                  } dark:border-gray-700 ${
                    questionMode === 'basic'
                      ? 'dark:bg-pink-900/25'
                      : 'dark:bg-gray-900 dark:hover:bg-gray-800'
                  }`}
                  onClick={() => setQuestionMode('basic')}
                  disabled={!problem || waitingFeedback || loading}
                >
                  🔰 初歩的な質問
                </button>
              </div>

              {questionMode === 'none' && (
                <div className="border rounded p-3 text-xs
                                bg-gray-50 text-gray-700 border-gray-200
                                dark:bg-gray-900 dark:text-gray-200 dark:border-gray-800">
                  まず上のボタンのどれかを選んでください。選んだ内容に応じて、1項目ずつ入力する画面が表示されます。
                </div>
              )}

              {questionMode !== 'none' && (
                <div className="border rounded p-3 bg-white space-y-3 border-gray-200
                                dark:bg-gray-950 dark:border-gray-800">
                  <div className="flex items-center justify-between text-xs">
                    <div className="font-semibold">{questionTitle}</div>
                    <div className="text-gray-600 dark:text-gray-300">
                      入力 {steps.length === 0 ? '0/0' : `${stepIndex + 1}/${steps.length}`}
                    </div>
                  </div>

                  {steps.length > 0 && (() => {
                    const totalSteps = steps.length
                    const clampedIndex = Math.min(stepIndex, totalSteps - 1)
                    const currentStep = steps[clampedIndex]
                    const canGoNext = clampedIndex < totalSteps - 1

                    const labelClass = `text-xs font-semibold whitespace-pre-wrap ${
                      currentStep.highlight ? 'text-red-700 dark:text-rose-300' : ''
                    }`

                    return (
                      <>
                        <div className="space-y-1">
                          <div className={labelClass}>
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
                                const isLast = clampedIndex === total - 1
                                if (isLast) {
                                  if (sendDisabled) return
                                  handleSend()
                                } else {
                                  setStepIndex((i) => Math.min(total - 1, i + 1))
                                }
                              }
                            }}
                          />
                        </div>

                        <div className="flex items-center justify-between text-xs mt-2">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="px-2 py-1 rounded border hover:bg-gray-50
                                         border-gray-200 dark:border-gray-700
                                         dark:hover:bg-gray-900"
                              onClick={() => setQuestionMode('none')}
                            >
                              ← パターン選択に戻る
                            </button>
                            {steps.length > 1 && (
                              <>
                                <button
                                  type="button"
                                  className="px-2 py-1 rounded border hover:bg-gray-50 disabled:opacity-40
                                             border-gray-200 dark:border-gray-700
                                             dark:hover:bg-gray-900"
                                  onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                                  disabled={clampedIndex === 0}
                                >
                                  ◀ 前へ
                                </button>
                                <button
                                  type="button"
                                  className="px-2 py-1 rounded border hover:bg-gray-50 disabled:opacity-40
                                             border-gray-200 dark:border-gray-700
                                             dark:hover:bg-gray-900"
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
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
