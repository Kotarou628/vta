'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'

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
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [gradingMode, setGradingMode] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const searchParams = useSearchParams()
  const problemId = searchParams.get('id')

  useEffect(() => {
    const fetchProblem = async () => {
      if (!problemId) return
      const res = await fetch(`/api/problem/${problemId}`)
      const data = await res.json()
      setProblem(data)
    }
    fetchProblem()
  }, [problemId])

  const handleSend = async () => {
    if (!input.trim()) return

    const userMessage: Message = { role: 'user', content: input }
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setLoading(true)

    const contextPrompt = gradingMode && problem
      ? `次のプログラム課題に対して、以下の学生のコードを採点し、改善点とアドバイス、完成度（100点満点）を提示してください。\n\n【問題文】\n${problem.description}\n\n【模範解答】\n${problem.solution_code}\n\n【学生のコード】\n${input}\n\n---\nアドバイス:\n<ここに改善点や次にやるべきこと>\n\n点数:\n<ここに数値（例: 85点）>`
      : input

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: contextPrompt }),
      })
      const data = await res.json()
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.reply,
      }
      setMessages((prev) => [...prev, assistantMessage])
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'エラーが発生しました。' },
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <main className="flex flex-col h-screen max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">
        {problem ? `${problem.title}` : '問題を読み込み中...'}
      </h1>

      {/* トグルスイッチ */}
      <div className="flex items-center gap-2 mb-4">
        <span className={gradingMode ? 'text-gray-400 text-sm' : 'text-black font-medium text-sm'}>
          通常モード
        </span>
        <button
          onClick={() => setGradingMode(!gradingMode)}
          className={`w-12 h-6 flex items-center rounded-full p-1 transition-colors duration-300 ${
            gradingMode ? 'bg-green-500' : 'bg-gray-300'
          }`}
        >
          <div
            className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-300 ${
              gradingMode ? 'translate-x-6' : 'translate-x-0'
            }`}
          />
        </button>
        <span className={gradingMode ? 'text-black font-medium text-sm' : 'text-gray-400 text-sm'}>
          採点モード
        </span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 px-1 py-2">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`w-full flex mb-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
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

      <div className="mt-4">
        <textarea
          className="w-full border p-2 rounded resize-none h-24"
          placeholder="メッセージを入力（Enterで送信、Shift+Enterで改行）"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="flex justify-end mt-2">
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
          >
            {loading ? '送信中...' : '送信'}
          </button>
        </div>
      </div>
    </main>
  )
}
