'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

export default function EditProblemPage() {
  const params = useParams()
  const router = useRouter()

  // パラメータからIDを取り出す（文字列 → 数字ではなく、文字列で問題ない）
  const id = params?.id?.toString() ?? ''

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [solutionCode, setSolutionCode] = useState('')

  useEffect(() => {
    const fetchProblem = async () => {
      const res = await fetch(`/api/problem/${id}`)
      if (!res.ok) {
        console.error('問題の取得に失敗しました')
        return
      }
      const data = await res.json()
      setTitle(data.title ?? '')
      setDescription(data.description ?? '')
      setSolutionCode(data.solution_code ?? '')
    }

    if (id) fetchProblem()
  }, [id])

  const handleUpdate = async () => {
    if (!title.trim()) {
      alert('タイトルは必須です')
      return
    }

    const res = await fetch(`/api/problem/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description,
        solution_code: solutionCode,
      }),
    })

    if (res.ok) {
      router.push('/problem')
    } else {
      alert('更新に失敗しました')
    }
  }

  return (
    <main className="p-4 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-4">問題を編集</h1>

      <input
        className="w-full border p-2 mb-2"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="タイトル"
      />
      <textarea
        className="w-full border p-2 mb-2"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="説明"
      />
      <textarea
        className="w-full border p-2 mb-2"
        value={solutionCode}
        onChange={(e) => setSolutionCode(e.target.value)}
        placeholder="解答コード"
      />

      <button
        onClick={handleUpdate}
        className="bg-green-600 text-white px-4 py-2 rounded"
      >
        更新
      </button>
    </main>
  )
}
