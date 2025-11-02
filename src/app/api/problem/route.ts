// src/app/api/problem/route.ts
import { db } from '@/lib/firebase-admin'
import { NextResponse } from 'next/server'
import admin from 'firebase-admin' // ★追加：FieldValue.delete を使う場合に必要

type SolutionFile = {
  filename: string
  language?: string
  code: string
}

// 改行正規化（構造は維持されます）
const normalizeNewlines = (s: string) => s.replace(/\r\n?/g, '\n')

export async function GET() {
  const snapshot = await db.collection('problem').orderBy('order').get()

  const problems = snapshot.docs.map((doc) => {
    const data = doc.data() as any

    const solution_files: SolutionFile[] =
      Array.isArray(data.solution_files) && data.solution_files.length > 0
        ? data.solution_files
        : (typeof data.solution_code === 'string' && data.solution_code.length > 0
            ? [{ filename: '', language: '', code: data.solution_code }]
            : [])

    return {
      id: doc.id,
      title: data.title ?? '',
      description: data.description ?? '',
      order: data.order ?? 0,
      // 読み取り互換は維持（UIで使っているなら）
      solution_code: data.solution_code ?? '',
      solution_files,
    }
  })

  return NextResponse.json(problems)
}

export async function POST(req: Request) {
  const body = await req.json()

  const { title, description } = body as {
    title: string
    description: string
  }

  // ここからは **solution_files を正** とします
  let { solution_files } = body as {
    solution_files?: SolutionFile[]
  }

  // 空配列なら空配列で保存（solution_code は使わない）
  if (!Array.isArray(solution_files)) solution_files = []

  // 改行正規化のみ（構造は保持）
  const normalized_files: SolutionFile[] = solution_files.map((f) => ({
    filename: f.filename ?? '',
    language: f.language ?? '',
    code: typeof f.code === 'string' ? normalizeNewlines(f.code) : '',
  }))

  // order
  const snapshot = await db.collection('problem').get()
  const currentCount = snapshot.size

  const payload: any = {
    title,
    description,
    solution_files: normalized_files,
    order: currentCount,
    // ★ 互換フィールドは保存しない（新規は常に空／または削除）
    solution_code: '',
  }

  const docRef = await db.collection('problem').add(payload)

  // ★オプション：互換フィールドを「物理削除」したい場合は以下を有効化
  // await docRef.update({ solution_code: admin.firestore.FieldValue.delete() })

  return NextResponse.json({ id: docRef.id })
}
