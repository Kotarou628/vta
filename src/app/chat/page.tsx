'use client'

import { useEffect, useRef, useState } from 'react'

type Message = {
  role: 'user' | 'assistant'
  content: string
}

export default function ChatPage() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const handleSend = async () => {
    if (!input.trim()) return

    const userMessage: Message = { role: 'user', content: input }
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input }),
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
      <h1 className="text-2xl font-bold mb-4">ChatGPT風チャット</h1>

      {/* 会話ログ（枠なし、余白だけ） */}
      <div className="flex-1 overflow-y-auto space-y-4 px-1 py-2">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`w-full flex mb-2 ${
              msg.role === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`p-3 rounded-lg whitespace-pre-wrap break-words max-w-[75%] ${
                msg.role === 'user'
                  ? 'bg-blue-100 text-right'
                  : 'bg-gray-100 text-left'
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
          placeholder="メッセージを入力（Enterで送信、Shift+Enterで改行）"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          onClick={handleSend}
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 mt-2 rounded disabled:opacity-50"
        >
          {loading ? '送信中...' : '送信'}
        </button>
      </div>
    </main>
  )
}
