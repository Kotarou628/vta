// src/lib/prisma.ts
import { PrismaClient } from '@/generated/prisma' // 出力先に合わせて修正

const prisma = new PrismaClient()

export { prisma }
