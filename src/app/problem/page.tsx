'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function ProblemPage() {
  const [problems, setProblems] = useState([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [solutionCode, setSolutionCode] = useState('')
  const router = useRouter()

  const fetchProblems = async () => {
    const res = await fetch('/api/problem')
    const data = await res.json()
    setProblems(data)
  }

  const handleSubmit = async () => {
    await fetch('/api/problem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description,
        solution_code: solutionCode,
      }),
    })
    setTitle('')
    setDescription('')
    setSolutionCode('')
    fetchProblems()
  }

  const handleDelete = async (id: number) => {
    const ok = confirm('この問題を削除しますか？')
    if (!ok) return
    await fetch(`/api/problem/${id}`, {
      method: 'DELETE',
    })
    fetchProblems()
  }

  useEffect(() => {
    fetchProblems()
  }, [])

  return (
    <main className="p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">問題の管理</h1>

      <div className="space-y-2 mb-6">
        <input
          className="w-full border p-2"
          placeholder="タイトル"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="w-full border p-2"
          placeholder="説明"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <textarea
          className="w-full border p-2"
          placeholder="解答コード"
          value={solutionCode}
          onChange={(e) => setSolutionCode(e.target.value)}
        />
        <button
          onClick={handleSubmit}
          className="bg-blue-600 text-white px-4 py-2 rounded"
        >
          問題を追加
        </button>
      </div>

      <hr className="my-6" />

      <ul className="space-y-4">
        {problems.map((p: any) => (
          <li key={p.id} className="border p-4 rounded bg-gray-100">
            <h2 className="font-semibold text-lg">{p.title}</h2>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{p.description}</p>
            <pre className="mt-2 bg-white border p-2 text-sm overflow-x-auto">{p.solution_code}</pre>
            <div className="mt-2 space-x-2">
              <Link
                href={`/problem/${p.id}/edit`}
                className="text-blue-600 hover:underline"
              >
                編集
              </Link>
              <button
                onClick={() => handleDelete(p.id)}
                className="text-red-600 hover:underline"
              >
                削除
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  )
}
