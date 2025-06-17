import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const data = await req.json();
  const updated = await prisma.problem.update({
    where: { id: parseInt(params.id) },
    data,
  });
  return NextResponse.json(updated);
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  await prisma.problem.delete({
    where: { id: parseInt(params.id) },
  });
  return NextResponse.json({ success: true });
}
