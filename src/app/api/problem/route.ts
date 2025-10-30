// src/app/api/problem/route.ts
import { db } from '@/lib/firebase-admin'
import { NextResponse } from 'next/server'

type SolutionFile = {
  filename: string
  language?: string
  code: string
}

export async function GET() {
  // Firestore の order フィールドで昇順ソートして取得
  const snapshot = await db.collection('problem').orderBy('order').get()

  const problems = snapshot.docs.map((doc) => {
    const data = doc.data() as any

    // 後方互換: solution_files がなければ solution_code を 1 要素配列に変換して返す
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
      // 旧フィールドは残す（既存UI互換）
      solution_code: data.solution_code ?? '',
      // 新フィールドを常に返す
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

  let { solution_code, solution_files } = body as {
    solution_code?: string
    solution_files?: SolutionFile[]
  }

  // 後方互換:
  // - solution_files が未指定/空のとき、solution_code があれば 1 要素に畳み込む
  if (!Array.isArray(solution_files) || solution_files.length === 0) {
    if (typeof solution_code === 'string' && solution_code.length > 0) {
      solution_files = [{ filename: '', language: '', code: solution_code }]
    } else {
      solution_files = []
    }
  }

  // 既存ドキュメント数から order を設定
  const snapshot = await db.collection('problem').get()
  const currentCount = snapshot.size

  const docRef = await db.collection('problem').add({
    title,
    description,
    // 旧フィールドも保存（過去画面互換のため）
    solution_code: typeof solution_code === 'string' ? solution_code : '',
    // 新フィールドを正として保存
    solution_files,
    order: currentCount,
  })

  return NextResponse.json({ id: docRef.id })
}
