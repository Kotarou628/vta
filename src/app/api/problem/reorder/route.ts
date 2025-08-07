//C:\Users\Admin\vta\src\app\api\problem\reorder
import { NextResponse } from 'next/server'
import { db } from '@/lib/firebase-admin'

export async function PUT(req: Request) {
  try {
    const body = await req.json()
    const problems: { id: string; order: number }[] = body.problems

    const batch = db.batch()
    for (const { id, order } of problems) {
      const docRef = db.collection('problem').doc(id)
      batch.update(docRef, { order })
    }

    await batch.commit()

    return NextResponse.json({ success: true, message: 'Order updated successfully' })
  } catch (error) {
    console.error('Error updating order:', error)
    return NextResponse.json({ success: false, message: 'Failed to update order' }, { status: 500 })
  }
}
// api/problem/[id]/route.ts - 問題の取得・更新・削除
// api/problem/reorder/route.ts - 並び順更新API
// api/problem/route.ts - 問題一覧と新規追加
