'use client'

import { useEffect, useState } from 'react'
import ProblemList from '@/components/ProblemList'

type Problem = {
  id: string  // FirestoreのドキュメントID
  title: string
  description: string
  solution_code: string
  order?: number
}

export default function ProblemPage() {
  const [problems, setProblems] = useState<Problem[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editSolutionCode, setEditSolutionCode] = useState('')

  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newSolutionCode, setNewSolutionCode] = useState('')

  const fetchProblems = async () => {
    const res = await fetch('/api/problem')
    const data = await res.json()

    const sorted = data.sort((a: Problem, b: Problem) => (a.order ?? 0) - (b.order ?? 0))
    setProblems(sorted)
  }

  const handleSubmit = async () => {
    await fetch('/api/problem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newTitle,
        description: newDescription,
        solution_code: newSolutionCode,
      }),
    })

    setNewTitle('')
    setNewDescription('')
    setNewSolutionCode('')

    fetchProblems()
  }

  const handleDelete = async (id: string) => {
    const ok = confirm('この問題を削除しますか？')
    if (!ok) return

    await fetch(`/api/problem/${id}`, { method: 'DELETE' })
    fetchProblems()
  }

  const toggleExpand = (problem: Problem) => {
    if (expandedId === problem.id) {
      setExpandedId(null)
    } else {
      setExpandedId(problem.id)
      setEditTitle(problem.title ?? '')
      setEditDescription(problem.description ?? '')
      setEditSolutionCode(problem.solution_code ?? '')
    }
  }

  const handleUpdate = async (id: string) => {
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

  const handleReorder = async (newList: Problem[]) => {
    setProblems(newList)

    await fetch('/api/problem/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        problems: newList.map((p, index) => ({
          id: p.id,
          order: index,
        })),
      }),
    })

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

      {/* 並べ替え可能なリスト */}
      <ProblemList
        problems={problems}
        onReorder={handleReorder}
        expandedId={expandedId}
        toggleExpand={toggleExpand}
        editTitle={editTitle}
        setEditTitle={setEditTitle}
        editDescription={editDescription}
        setEditDescription={setEditDescription}
        editSolutionCode={editSolutionCode}
        setEditSolutionCode={setEditSolutionCode}
        handleUpdate={handleUpdate}
        handleDelete={handleDelete}
      />
    </main>
  )
}
