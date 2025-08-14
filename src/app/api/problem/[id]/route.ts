// src/app/api/problem/[id]/route.ts
import { db } from '@/lib/firebase-admin'
import { NextRequest, NextResponse } from 'next/server'

// ---- GET: 問題を取得 ----
export async function GET(req: NextRequest, context: any) {
  try {
    const id: string | undefined =
      context?.params?.id ??
      req.nextUrl.searchParams.get('id') ??
      req.nextUrl.pathname.split('/').pop() ??
      undefined

    if (!id) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
    }

    const doc = await db.collection('problem').doc(id).get()
    if (!doc.exists) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 })
    }

    const data = doc.data()
    return NextResponse.json({
      id: doc.id,
      title: data?.title || '',
      description: data?.description || '',
      solution_code: data?.solution_code || '',
    })
  } catch (e) {
    console.error('GET /api/problem/[id] failed:', e)
    return NextResponse.json({ error: 'Failed to fetch problem' }, { status: 500 })
  }
}

// ---- PUT: 問題を更新 ----
export async function PUT(req: NextRequest, context: any) {
  try {
    const id: string | undefined =
      context?.params?.id ??
      req.nextUrl.searchParams.get('id') ??
      req.nextUrl.pathname.split('/').pop() ??
      undefined

    if (!id) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
    }

    const data = await req.json()
    await db.collection('problem').doc(id).update(data)
    return NextResponse.json({ message: 'Updated successfully' })
  } catch (e) {
    console.error('PUT /api/problem/[id] failed:', e)
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
}

// ---- DELETE: 問題を削除 ----
export async function DELETE(req: NextRequest, context: any) {
  try {
    const id: string | undefined =
      context?.params?.id ??
      req.nextUrl.searchParams.get('id') ??
      req.nextUrl.pathname.split('/').pop() ??
      undefined

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
