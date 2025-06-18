'use client'

import { useEffect, useState } from 'react'

export default function ProblemPage() {
  const [problems, setProblems] = useState<any[]>([])
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // 編集用のstate（展開時に使う）
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editSolutionCode, setEditSolutionCode] = useState('')

  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newSolutionCode, setNewSolutionCode] = useState('')

  const fetchProblems = async () => {
    const res = await fetch('/api/problem')
    const data = await res.json()
    setProblems(data)
  }

  const handleSubmit = async () => {
    await fetch('/api/problem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle, description: newDescription, solution_code: newSolutionCode }),
    })
    setNewTitle('')
    setNewDescription('')
    setNewSolutionCode('')
    fetchProblems()
  }

  const handleDelete = async (id: number) => {
    const ok = confirm('この問題を削除しますか？')
    if (!ok) return
    await fetch(`/api/problem/${id}`, { method: 'DELETE' })
    fetchProblems()
  }

  const toggleExpand = (problem: any) => {
    if (expandedId === problem.id) {
      setExpandedId(null)
    } else {
      setExpandedId(problem.id)
      setEditTitle(problem.title ?? '')
      setEditDescription(problem.description ?? '')
      setEditSolutionCode(problem.solution_code ?? '')
    }
  }

  const handleUpdate = async (id: number) => {
    await fetch(`/api/problem/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: editTitle,
        description: editDescription,
        solution_code: editSolutionCode,
      }),
    })
    setExpandedId(null)
    fetchProblems()
  }

  useEffect(() => {
    fetchProblems()
  }, [])

  return (
    <main className="p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">問題の管理</h1>

      {/* 新規登録フォーム */}
      <div className="space-y-2 mb-6">
        <input
          className="w-full border p-2"
          placeholder="タイトル"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <textarea
          className="w-full border p-2"
          placeholder="説明"
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
        />
        <textarea
          className="w-full border p-2"
          placeholder="解答コード"
          value={newSolutionCode}
          onChange={(e) => setNewSolutionCode(e.target.value)}
        />
        <button
          onClick={handleSubmit}
          className="bg-blue-600 text-white px-4 py-2 rounded"
        >
          問題を追加
        </button>
      </div>

      <hr className="my-6" />

      {/* 一覧 */}
      <ul className="space-y-4">
        {problems.map((p) => (
          <li key={p.id} className="border p-4 rounded bg-gray-100">
            {/* タイトル押すと編集モード */}
            <button
              onClick={() => toggleExpand(p)}
              className="text-left w-full font-semibold text-lg text-blue-800 hover:underline"
            >
              {p.title}
            </button>

            {expandedId === p.id && (
              <div className="mt-2 space-y-2">
                <input
                  className="w-full border p-2"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
                <textarea
                  className="w-full border p-2"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                />
                <textarea
                  className="w-full border p-2"
                  value={editSolutionCode}
                  onChange={(e) => setEditSolutionCode(e.target.value)}
                />
                <div className="space-x-2">
                  <button
                    onClick={() => handleUpdate(p.id)}
                    className="bg-green-600 text-white px-4 py-1 rounded"
                  >
                    更新
                  </button>
                  <button
                    onClick={() => handleDelete(p.id)}
                    className="text-red-600 hover:underline"
                  >
                    削除
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  )
}
