// src/app/api/problem/route.ts
import { db } from '@/lib/firebase-admin'
import { NextResponse } from 'next/server'

export async function GET() {
  // 🔽 Firestoreの order フィールドで昇順ソート
  const snapshot = await db.collection('problem').orderBy('order').get()
  const problems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
  return NextResponse.json(problems)
}

export async function POST(req: Request) {
  const { title, description, solution_code } = await req.json()

  // 🔽 既存のドキュメント数から order を設定
  const snapshot = await db.collection('problem').get()
  const currentCount = snapshot.size

  const docRef = await db.collection('problem').add({
    title,
    description,
    solution_code,
    order: currentCount
  })

  return NextResponse.json({ id: docRef.id })
}
