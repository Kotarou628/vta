// src/app/chat/page.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

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

type Message = { role: 'user' | 'assistant', content: string }
type Problem = { id: string, title: string, description: string, solution_code: string }

export default function ChatPage() {
  const [input, setInput] = useState('')
  const [allMessages, setAllMessages] = useState<{ [problemId: string]: Message[] }>({})
  const [loading, setLoading] = useState(false)
  const [problems, setProblems] = useState<Problem[]>([])
  const [problem, setProblem] = useState<Problem | null>(null)
  const [gradingMode, setGradingMode] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem('chatMessages')
    if (saved) setAllMessages(JSON.parse(saved))
    fetch('/api/problem')
      .then(res => res.json())
      .then(setProblems)
  }, [])

  useEffect(() => {
    localStorage.setItem('chatMessages', JSON.stringify(allMessages))
  }, [allMessages])

  // ★ 依存が安定するようにメモ化（機能は変わりません）
  const messages: Message[] = useMemo(
    () => (problem ? allMessages[problem.id] || [] : []),
    [problem, allMessages]
  )

  const buildSummary = (messages: Message[]) => {
    const summaryLimit = 500
    const userMessages = messages.filter(m => m.role === 'user').map(m => m.content).join('\n')
    return userMessages.length > summaryLimit
      ? userMessages.slice(-summaryLimit)
      : userMessages
  }

  const handleSend = async () => {
    if (!input.trim() || !problem) return

    const userMessage: Message = { role: 'user', content: input }
    const currentMessages = [...(allMessages[problem.id] || []), userMessage]
    setAllMessages({ ...allMessages, [problem.id]: currentMessages })
    setInput('')
    setLoading(true)

    const summary = buildSummary(currentMessages)

    const contextPrompt = gradingMode
      ? `${GRADING_PROMPT}\n\n【問題文】\n${problem.description}\n\n【模範コード】\n${problem.solution_code}\n\n【学生のコード】\n${userMessage.content}`
      : `${TEACHER_PROMPT}\n\n【問題文】\n${problem.description}\n\n【模範コード】\n${problem.solution_code}\n\n【これまでの履歴要約】\n${summary}\n\n【質問/学生の考え】\n${userMessage.content}`

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
          .filter(line => line.trim().startsWith('data: '))
          .map(line => line.replace(/^data: /, ''))
          .filter(line => line !== '' && line !== '[DONE]')

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
          } catch (err) {
            console.error('ストリームJSON解析エラー:', err)
            console.warn('壊れたJSON:', jsonStr)
          }
        }
      }

    } catch (err) {
      console.error('エラー:', err)
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

  return (
    <main className="flex h-screen">
      <div className="w-1/3 bg-gray-50 border-r p-4 overflow-y-auto">
        <h2 className="font-bold mb-2">問題を選択</h2>
        {problems.map(p => (
          <button key={p.id} onClick={() => setProblem(p)} className={`block w-full text-left p-2 mb-2 rounded ${problem?.id === p.id ? 'bg-blue-100' : 'hover:bg-blue-50'}`}>
            {p.title}
          </button>
        ))}
      </div>

      <div className="flex-1 p-4 flex flex-col">
        <h1 className="text-xl font-bold mb-2">{problem?.title || 'これはdev'}</h1>

        <div className="flex items-center mb-4">
          <span className={!gradingMode ? 'font-bold' : 'text-gray-400'}>通常モード</span>
          <label className="mx-2 relative inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only peer" checked={gradingMode} onChange={e => setGradingMode(e.target.checked)} />
            <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:bg-green-500 transition-all" />
            <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow peer-checked:translate-x-full transition-all" />
          </label>
          <span className={gradingMode ? 'font-bold' : 'text-gray-400'}>採点モード</span>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto">
          {messages.map((msg: Message, idx: number) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`p-3 rounded max-w-[75%] whitespace-pre-wrap break-words ${msg.role === 'user' ? 'bg-blue-100' : 'bg-green-50'}`}>
                {formatMessageContent(msg.content).map((part, i) =>
                  typeof part === 'string'
                    ? <p key={i}>{part}</p>
                    : <pre key={i} className="bg-gray-200 p-2 rounded"><code>{part.code}</code></pre>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="mt-4">
          <textarea
            className="w-full border p-2 rounded h-24 resize-none"
            value={input}
            placeholder={problem ? '質問やコードを入力（Enterで送信、Shift+Enterで改行）' : 'まず問題を選んでください'}
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
            <button className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50" onClick={handleSend} disabled={!input || loading || !problem}>
              {loading ? '送信中...' : '送信'}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
