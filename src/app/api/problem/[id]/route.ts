// app/api/problem/[id]/route.ts

import { db } from '@/lib/firebase-admin'; // Firestore 初期化済み
import { NextResponse } from 'next/server';

// GET: 特定の問題を取得
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  if (!id) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  try {
    const doc = await db.collection('problem').doc(id).get();

    if (!doc.exists) {
      return NextResponse.json({ error: 'Problem not found' }, { status: 404 });
    }

    return NextResponse.json(doc.data(), { status: 200 });
  } catch (error) {
    console.error('Error fetching problem:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// 必要なら DELETE メソッドも追加できます（オプション）
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  if (!id) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  try {
    await db.collection('problem').doc(id).delete();
    return NextResponse.json({ message: 'Deleted successfully' });
  } catch (error) {
    console.error('Error deleting problem:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
