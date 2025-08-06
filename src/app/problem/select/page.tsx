'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Problem = {
  id: string
  title: string
}

export default function ProblemSelectPage() {
  const [problems, setProblems] = useState<Problem[]>([])
  const router = useRouter()

  useEffect(() => {
    const fetchProblems = async () => {
      const res = await fetch('/api/problem')
      const data = await res.json()
      setProblems(data)
    }
    fetchProblems()
  }, [])

    const handleSelect = (problemId: string) => {
    router.push(`/chat?id=${problemId}`)
    }

  return (
    <main className="p-4 max-w-xl mx-auto">
      <h1 className="text-xl font-bold mb-4">問題を選択してください</h1>
      <ul className="space-y-2">
        {problems.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => handleSelect(p.id)}
              className="w-full text-left p-2 border rounded hover:bg-gray-100"
            >
              {p.title}
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}
