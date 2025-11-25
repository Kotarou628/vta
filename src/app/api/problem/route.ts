// src/app/api/problem/route.ts
import { db } from '@/lib/firebase-admin'
import { NextResponse } from 'next/server'
import admin from 'firebase-admin' // ★ 互換のため残しておく（未使用でもOK）

type SolutionFile = {
  filename: string
  language?: string
  code: string
}

// 改行正規化（構造は維持されます）
const normalizeNewlines = (s: string) => s.replace(/\r\n?/g, '\n')

/** ---- GET: 問題一覧 ---- */
export async function GET() {
  const snapshot = await db.collection('problem').orderBy('order').get()

  const problems = snapshot.docs.map((doc) => {
    const data = doc.data() as any

    // solution_files があればそれを優先
    // なければ solution_code を 1件に畳み込む
    const solution_files: SolutionFile[] =
      Array.isArray(data?.solution_files) && data.solution_files.length > 0
        ? data.solution_files
        : typeof data?.solution_code === 'string' && data.solution_code.length > 0
          ? [{ filename: '', language: '', code: data.solution_code }]
          : []

    // visibleInChat（camel / snake 両対応・デフォルト true）
    const camel = typeof data?.visibleInChat === 'boolean' ? data.visibleInChat : undefined
    const snake = typeof data?.visible_in_chat === 'boolean' ? data.visible_in_chat : undefined
    const visibleInChat =
      typeof camel === 'boolean'
        ? camel
        : typeof snake === 'boolean'
          ? snake
          : true

    return {
      id: doc.id,
      title: data?.title ?? '',
      description: data?.description ?? '',
      order: data?.order ?? 0,
      solution_code: data?.solution_code ?? '',
      solution_files,
      visibleInChat,
    }
  })

  return NextResponse.json(problems)
}

/** ---- POST: 問題を新規作成 ---- */
export async function POST(req: Request) {
  const body = await req.json()

  const {
    title,
    description,
    solution_files,
    solution_code,
    visibleInChat,
    visible_in_chat,
  } = body as {
    title: string
    description: string
    solution_files?: SolutionFile[]
    solution_code?: string
    visibleInChat?: boolean
    visible_in_chat?: boolean
  }

  // solution_files / solution_code から canonical な配列を作成
  let normalized_files: SolutionFile[] = []

  if (Array.isArray(solution_files) && solution_files.length > 0) {
    normalized_files = solution_files.map((f) => ({
      filename: f.filename ?? '',
      language: f.language ?? '',
      code: typeof f.code === 'string' ? normalizeNewlines(f.code) : '',
    }))
  } else if (typeof solution_code === 'string' && solution_code.trim().length > 0) {
    normalized_files = [
      {
        filename: '',
        language: '',
        code: normalizeNewlines(solution_code),
      },
    ]
  }

  // 並び順: 現在の件数を元に決定
  const snapshot = await db.collection('problem').get()
  const currentCount = snapshot.size

  // visibleInChat の決定（body になければ true）
  const visibleFlag =
    typeof visibleInChat === 'boolean'
      ? visibleInChat
      : typeof visible_in_chat === 'boolean'
        ? visible_in_chat
        : true

  const payload: any = {
    title,
    description,
    solution_files: normalized_files,
    order: currentCount,
    solution_code:
      typeof solution_code === 'string' ? normalizeNewlines(solution_code) : '',
    visibleInChat: visibleFlag,
  }

  console.log('[API /problem POST] payload', payload)

  const docRef = await db.collection('problem').add(payload)

  // 物理削除したいなら↓を有効化
  // await docRef.update({ solution_code: admin.firestore.FieldValue.delete() })

  return NextResponse.json({ id: docRef.id })
}
