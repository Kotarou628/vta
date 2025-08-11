// src/app/chat/page.tsx
// src/app/chat/page.tsx
'use client'

import { useEffect, useRef, useState } from 'react'

// ===== 短い教員/採点プロンプト（先頭に付与するだけ） =====
const TEACHER_PROMPT = `
[役割] プログラミングを正しく教えられる教員。
[禁止] 解答コードは絶対に出さない（必要最小限の断片は可）。
[方針] 逆質問（ソクラテス式）でヒント提示。
[出力] 簡潔に、質問にだけ答える（最大5行）。`.trim()

const GRADING_PROMPT = `
[役割] 教員として採点・助言を行う。
[比較] 模範コードと学生コードを比較し、未達箇所を抽出。
[出力]
1) 完成度: XX%（根拠を短く）
2) 未達/不正確: 問題文の該当箇所を指摘（短く列挙）
3) 次の一手: 次に実装/修正すべき箇所を1〜3点
4) 良ければ短くほめる
[禁止] 模範コードの全文貼付は禁止。`.trim()

// Type definitions
type Message = {
  role: 'user' | 'assistant'
  content: string
}

type Problem = {
  id: string
  title: string
  description: string
  solution_code: string
}

export default function ChatPage() {
  const [input, setInput] = useState('')
  const [allMessages, setAllMessages] = useState<{ [problemId: string]: Message[] }>({})
  const [loading, setLoading] = useState(false)
  const [problems, setProblems] = useState<Problem[]>([])
  const [problem, setProblem] = useState<Problem | null>(null)
  const [gradingMode, setGradingMode] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  // 問題一覧とローカル履歴の読み込み
  useEffect(() => {
    const fetchProblems = async () => {
      const res = await fetch('/api/problem')
      const data = await res.json()
      setProblems(data)
    }

    const savedMessages = localStorage.getItem('chatMessages')
    if (savedMessages) {
      setAllMessages(JSON.parse(savedMessages))
    }

    fetchProblems()
  }, [])

  // 問題別のチャット履歴を localStorage に保存
  useEffect(() => {
    localStorage.setItem('chatMessages', JSON.stringify(allMessages))
  }, [allMessages])

  const messages = problem ? allMessages[problem.id] || [] : []

  const handleSend = async () => {
    if (!input.trim() || !problem) return

    // 送信メッセージを現在選択中の問題IDのスレッドに保存
    const userMessage: Message = { role: 'user', content: input }
    const updatedMessages = [...(allMessages[problem.id] || []), userMessage]
    setAllMessages({ ...allMessages, [problem.id]: updatedMessages })
    setInput('')
    setLoading(true)

    // 教員モード/採点モードの指示を先頭に付与し、問題文・模範コード・入力を含めて送信
    const contextPrompt =
      gradingMode
        ? `${GRADING_PROMPT}\n\n【問題文】\n${problem.description}\n\n【模範コード】\n${problem.solution_code}\n\n【学生のコード】\n${userMessage.content}`
        : `${TEACHER_PROMPT}\n\n【問題文】\n${problem.description}\n\n【模範コード】\n${problem.solution_code}\n\n【質問/学生の考え】\n${userMessage.content}`

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: contextPrompt })
      })
      const data = await res.json()
      const assistantMessage: Message = { role: 'assistant', content: data.reply }
      setAllMessages((prev) => ({
        ...prev,
        [problem.id]: [...(prev[problem.id] || []), assistantMessage]
      }))

      // 念のため即時スクロール
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 0)
    } catch (e) {
      const errorMessage: Message = { role: 'assistant', content: 'エラーが発生しました。' }
      setAllMessages((prev) => ({
        ...prev,
        [problem.id]: [...(prev[problem.id] || []), errorMessage]
      }))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ```コードブロック``` を検出してそのまま表示する（インデント・空白を保持）
  function formatMessageContent(content: string): (string | { code: string })[] {
    const codeBlockRegex = /```(?:[a-z]*)?\n([\s\S]*?)```/g
    const parts: (string | { code: string })[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = codeBlockRegex.exec(content))) {
      const index = match.index
      const code = match[1]
      if (index > lastIndex) parts.push(content.slice(lastIndex, index))
      parts.push({ code })
      lastIndex = codeBlockRegex.lastIndex
    }

    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex))
    }
    return parts
  }

  return (
    <main className="flex h-screen">
      {/* Sidebar */}
      <div className="w-1/3 bg-gray-50 border-r overflow-y-auto p-4">
        <h2 className="font-bold mb-2">問題を選択してください</h2>
        {problems.map((p) => (
          <button
            key={p.id}
            className={`w-full text-left p-2 mb-2 border rounded hover:bg-blue-50 ${problem?.id === p.id ? 'bg-blue-100' : ''}`}
            onClick={() => setProblem(p)}
          >
            {p.title}
          </button>
        ))}
      </div>

      {/* Chat section */}
      <div className="flex flex-col flex-1 p-4">
        <h1 className="text-xl font-bold mb-2">{problem ? problem.title : '問題未選択'}</h1>

        <div className="flex items-center space-x-2 mb-4">
          <span className={!gradingMode ? 'font-bold' : 'text-gray-400'}>通常モード</span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={gradingMode}
              onChange={(e) => setGradingMode(e.target.checked)}
            />
            <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:bg-green-500 transition-all"></div>
            <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow peer-checked:translate-x-full transition-all"></div>
          </label>
          <span className={gradingMode ? 'font-bold' : 'text-gray-400'}>採点モード</span>
        </div>

        {!problem && (
          <div className="mb-4 p-4 bg-yellow-100 text-yellow-800 rounded">
            まず左の一覧から問題を選択してください。選択後、質問やコードを入力できます。
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-4">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`w-full flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`p-3 rounded-lg whitespace-pre-wrap break-words max-w-[75%] ${
                  msg.role === 'user'
                    ? 'bg-blue-100 ml-auto'      // ユーザー: 青系（右寄せ）
                    : 'bg-green-50 mr-auto'      // アシスタント: 緑系（左寄せ）
                }`}
              >
                {formatMessageContent(msg.content).map((part, i) =>
                  typeof part === 'string' ? (
                    <p key={i} className="mb-2 text-left">{part}</p>
                  ) : (
                    <pre
                      key={i}
                      className="overflow-x-auto bg-gray-200 text-sm p-2 rounded mb-2 text-left"
                    >
                      <code className="text-left">{part.code}</code>
                    </pre>
                  )
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="mt-4">
          <textarea
            className="w-full border p-2 rounded resize-none h-24"
            placeholder={problem ? 'メッセージを入力（Enterで送信、Shift+Enterで改行）' : 'まず問題を選択してください'}
            value={input}
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
              onClick={handleSend}
              disabled={loading || !input.trim() || !problem}
              className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
            >
              {loading ? '送信中...' : '送信'}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
