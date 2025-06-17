import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
  const problems = await prisma.problem.findMany();
  return NextResponse.json(problems);
}

export async function POST(req: Request) {
  const data = await req.json();
  const newProblem = await prisma.problem.create({ data });
  return NextResponse.json(newProblem);
}
