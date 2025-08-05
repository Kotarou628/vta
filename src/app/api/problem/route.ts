import { db } from '@/lib/firebase-admin'
import { NextResponse } from 'next/server'

export async function GET() {
  const snapshot = await db.collection('problem').get()
  const problems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
  return NextResponse.json(problems)
}

export async function POST(req: Request) {
  const { title, description, solution_code } = await req.json()

  // 🔽 既存の問題の数を取得して order を決定
  const snapshot = await db.collection('problem').get()
  const currentCount = snapshot.size

  const docRef = await db.collection('problem').add({
    title,
    description,
    solution_code,
    order: currentCount  // ← ここで order を設定
  })

  return NextResponse.json({ id: docRef.id })
}
