//C:\Users\Admin\vta\src\app\chat\page.tsx
'use client'

import { useEffect, useRef, useState } from 'react'

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

  // Load problems and chat history from localStorage
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

  // Save chat history to localStorage when updated
  useEffect(() => {
    localStorage.setItem('chatMessages', JSON.stringify(allMessages))
  }, [allMessages])

  const messages = problem ? allMessages[problem.id] || [] : []

  const handleSend = async () => {
    if (!input.trim() || !problem) return

    const userMessage: Message = { role: 'user', content: input }
    const updatedMessages = [...(allMessages[problem.id] || []), userMessage]
    setAllMessages({ ...allMessages, [problem.id]: updatedMessages })
    setInput('')
    setLoading(true)

    const contextPrompt =
      gradingMode
        ? `次のプログラム課題に対して、以下の学生のコードを採点し、改善点とアドバイス、完成度（100点満点）を提示してください。\n\n【問題文】\n${problem.description}\n\n【模範解答】\n${problem.solution_code}\n\n【学生のコード】\n${input}\n\n---\nアドバイス:\n<ここに改善点や次にやるべきこと>\n\n点数:\n<ここに数値（例: 85点）>`
        : `以下のプログラミング課題に関する質問です。\n\n【問題文】\n${problem.description}\n\n【模範解答】\n${problem.solution_code}\n\n【質問】\n${input}`

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

  return (
    <main className="flex h-screen">
      {/* 左側のサイドバー */}
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

      {/* 右側のチャット画面 */}
      <div className="flex flex-col flex-1 p-4">
        <h1 className="text-xl font-bold mb-2">{problem ? problem.title : '問題未選択'}</h1>

        {/* モード切り替え */}
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

        {/* 問題未選択時の案内 */}
        {!problem && (
          <div className="mb-4 p-4 bg-yellow-100 text-yellow-800 rounded">
            まず左の一覧から問題を選択してください。選択後、質問やコードを入力できます。
          </div>
        )}

        {/* チャット表示 */}
        <div className="flex-1 overflow-y-auto space-y-4">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`w-full flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`p-3 rounded-lg whitespace-pre-wrap break-words max-w-[75%] ${
                  msg.role === 'user' ? 'bg-blue-100 text-right' : 'bg-gray-100 text-left'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* 入力欄 */}
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
