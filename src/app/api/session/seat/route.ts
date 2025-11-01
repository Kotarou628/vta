// src/app/api/session/seat/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { seat } = await req.json();

    if (typeof seat !== 'string' || !/^[A-L](0[1-8])$/.test(seat)) {
      return NextResponse.json({ ok: false, error: 'invalid seat' }, { status: 400 });
    }

    // セッションクッキー（= maxAge/expires を指定しない）
    const res = NextResponse.json({ ok: true });
    res.cookies.set('seat', seat, {
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    });
    return res;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}

/** ログアウトなどで席情報を消す */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set('seat', '', {
    path: '/',
    expires: new Date(0), // 即時失効
    sameSite: 'lax',
  });
  return res;
}
