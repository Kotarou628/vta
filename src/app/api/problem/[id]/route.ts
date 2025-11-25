// src/app/api/problem/[id]/route.ts
import { db } from '@/lib/firebase-admin'
import { NextRequest, NextResponse } from 'next/server'

type SolutionFile = {
  filename: string
  language?: string
  code: string
}

// 改行正規化
const normalizeNewlines = (s: string) => s.replace(/\r\n?/g, '\n')

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

    return NextResponse.json({
      id: doc.id,
      title: data?.title ?? '',
      description: data?.description ?? '',
      order: data?.order ?? 0,
      solution_code: data?.solution_code ?? '',
      solution_files,
      visibleInChat,
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

    const {
      title,
      description,
      solution_files,
      solution_code,
      visibleInChat,
      visible_in_chat,
      order,
    } = body as {
      title?: string
      description?: string
      solution_files?: SolutionFile[]
      solution_code?: string
      visibleInChat?: boolean
      visible_in_chat?: boolean
      order?: number
    }

    // solution_files / solution_code を正規化
    let normalized_files: SolutionFile[] | undefined
    if (Array.isArray(solution_files)) {
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

    const updateData: any = {}

    if (typeof title === 'string') {
      updateData.title = title
    }
    if (typeof description === 'string') {
      updateData.description = description
    }
    if (typeof order === 'number') {
      updateData.order = order
    }
    if (normalized_files) {
      updateData.solution_files = normalized_files
    }
    if (typeof solution_code === 'string') {
      // 旧 UI 互換のため solution_code も保持
      updateData.solution_code = normalizeNewlines(solution_code)
    }

    // visibleInChat の更新（camel / snake どちらでも受ける）
    if (typeof visibleInChat === 'boolean') {
      updateData.visibleInChat = visibleInChat
    } else if (typeof visible_in_chat === 'boolean') {
      updateData.visibleInChat = visible_in_chat
    }

    console.log('PUT /api/problem/[id] id:', id, 'updateData:', updateData)

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
