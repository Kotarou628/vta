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
