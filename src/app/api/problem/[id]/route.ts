// src/app/api/problem/[id]/route.ts
import { db } from '@/lib/firebase-admin'
import { NextRequest, NextResponse } from 'next/server'

type SolutionFile = {
  filename: string
  language?: string
  code: string
}

/** URL から [id] を取り出す共通関数（末尾スラッグを採用） */
function extractId(req: NextRequest): string | null {
  // /api/problem/xxx の xxx を取得
  const slug = req.nextUrl.pathname.split('/').pop()
  // searchParams ?id=xxx をフォールバックとして許可
  const q = req.nextUrl.searchParams.get('id')
  return (slug && slug.length > 0 ? slug : null) ?? (q && q.length > 0 ? q : null)
}

/** ---- GET: 問題を取得 ---- */
export async function GET(req: NextRequest) {
  try {
    const id = extractId(req)
    if (!id) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
    }

    const doc = await db.collection('problem').doc(id).get()
    if (!doc.exists) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 })
    }

    const data = doc.data() as any

    // 後方互換: solution_files がない場合は solution_code を 1 要素に畳み込んで返す
    const solution_files: SolutionFile[] =
      Array.isArray(data?.solution_files) && data.solution_files.length > 0
        ? data.solution_files
        : (typeof data?.solution_code === 'string' && data.solution_code.length > 0
            ? [{ filename: '', language: '', code: data.solution_code }]
            : [])

    return NextResponse.json({
      id: doc.id,
      title: data?.title ?? '',
      description: data?.description ?? '',
      order: data?.order ?? 0,
      solution_code: data?.solution_code ?? '',
      solution_files,
    })
  } catch (e) {
    console.error('GET /api/problem/[id] failed:', e)
    return NextResponse.json({ error: 'Failed to fetch problem' }, { status: 500 })
  }
}

/** ---- PUT: 問題を更新 ---- */
export async function PUT(req: NextRequest) {
  try {
    const id = extractId(req)
    if (!id) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
    }

    const body = await req.json()

    let { solution_files, solution_code } = body as {
      solution_files?: SolutionFile[]
      solution_code?: string
    }

    // 後方互換:
    // - solution_files が未指定または空なら、solution_code を 1 要素配列に畳み込む
    if (!Array.isArray(solution_files) || solution_files.length === 0) {
      if (typeof solution_code === 'string' && solution_code.length > 0) {
        solution_files = [{ filename: '', language: '', code: solution_code }]
      } else {
        solution_files = []
      }
    }

    // 既存の挙動（body をそのまま update）を維持しつつ、正規化した配列を上書き
    const updateData = {
      ...body,
      solution_files,
      // 旧 UI 互換のため solution_code も保持（あれば）
      solution_code: typeof solution_code === 'string' ? solution_code : (body.solution_code ?? ''),
    }

    await db.collection('problem').doc(id).update(updateData)
    return NextResponse.json({ message: 'Updated successfully' })
  } catch (e) {
    console.error('PUT /api/problem/[id] failed:', e)
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
}

/** ---- DELETE: 問題を削除 ---- */
export async function DELETE(req: NextRequest) {
  try {
    const id = extractId(req)
    if (!id) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
    }

    await db.collection('problem').doc(id).delete()
    return NextResponse.json({ message: 'Deleted successfully' })
  } catch (e) {
    console.error('DELETE /api/problem/[id] failed:', e)
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
}
