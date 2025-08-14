// src/app/api/problem/[id]/route.ts
import { db } from '@/lib/firebase-admin';
import { NextRequest, NextResponse } from 'next/server';

// GET: 問題を取得
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  if (!id) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  try {
    const doc = await db.collection('problem').doc(id).get();
    if (!doc.exists) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }

    const data = doc.data();
    return NextResponse.json({
      id: doc.id,
      title: data?.title || '',
      description: data?.description || '',
      solution_code: data?.solution_code || '',
    });
  } catch (_e) {
    return NextResponse.json({ error: 'Failed to fetch problem' }, { status: 500 });
  }
}

// PUT: 問題を更新
export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const data = await req.json();

  if (!id) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  try {
    await db.collection('problem').doc(id).update(data);
    return NextResponse.json({ message: 'Updated successfully' });
  } catch (_e) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

// DELETE: 問題を削除
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  if (!id) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  try {
    await db.collection('problem').doc(id).delete();
    return NextResponse.json({ message: 'Deleted successfully' });
  } catch (_e) {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
