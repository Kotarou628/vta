// src/app/login/page.tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { idToEmail } from '@/lib/nameToEmail';
import { doc, setDoc } from 'firebase/firestore';

/** 全角→半角・前後空白除去・英字大文字化 */
const normalizeSeat = (raw: string) =>
  (raw || '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) =>
      String.fromCharCode(s.charCodeAt(0) - 0xfee0)
    )
    .trim()
    .toUpperCase();

/** A〜L + 01〜08 のみ許可（必要に応じて調整） */
const isValidSeat = (seat: string) => /^[A-L](0[1-8])$/.test(seat);

/** できるだけ多くの場所に保存（chat 画面の探索ロジックと互換） */
async function saveSeatEverywhere(seat: string) {
  try {
    // local/sessionStorage
    localStorage.setItem('seatNumber', seat);
    localStorage.setItem('seat', seat);
    localStorage.setItem('userSettings', JSON.stringify({ seatNumber: seat }));
    sessionStorage.setItem('seat', seat);

    // セッションAPI（サーバー側で使うなら）
    await fetch('/api/session/seat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seat }),
    });
  } catch {
    // Storageやfetch失敗は致命的でないので握りつぶす
  }

  // Firestore の /users/{uid} にも書いておく（Settings なし運用のため）
  try {
    const user = auth.currentUser;
    if (user) {
      await setDoc(
        doc(db, 'users', user.uid),
        { seatNumber: seat },
        { merge: true }
      );
    }
  } catch {
    // ここで失敗してもチャット保存は localStorage 経由で動くため継続
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [studentId, setStudentId] = useState('');
  const [seat, setSeat] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const seatNormalized = normalizeSeat(seat);

    if (!isValidSeat(seatNormalized)) {
      setLoading(false);
      setError('席番号は A01〜L08 の形式で入力してください。');
      return;
    }

    try {
      const email = idToEmail(studentId.trim());
      await signInWithEmailAndPassword(auth, email, password);

      // 席番号をクライアント/サーバー/Firestore に保存
      await saveSeatEverywhere(seatNormalized);

      // ✅ ログイン成功でチャットへ
      router.push('/chat');
    } catch {
      setError('学籍番号またはパスワードが正しくありません');
    } finally {
      setLoading(false);
    }
  };

  const seatHelp =
    seat && !isValidSeat(normalizeSeat(seat))
      ? '例: A01 / B08（英字+2桁）。全角でもOK。'
      : '';

  return (
    <main className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">ログイン</h1>
      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label className="block text-sm mb-1">学籍番号</label>
          <input
            type="text"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            className="w-full border p-2 rounded"
            required
          />
        </div>

        <div>
          <label className="block text-sm mb-1">席番号（A01 など）</label>
          <input
            type="text"
            value={seat}
            onChange={(e) => setSeat(e.target.value)}
            onBlur={(e) => setSeat(normalizeSeat(e.target.value))}
            placeholder="A01"
            inputMode="text"
            className="w-full border p-2 rounded"
            required
          />
          {seatHelp && <p className="text-xs text-gray-500 mt-1">{seatHelp}</p>}
        </div>

        <div>
          <label className="block text-sm mb-1">パスワード</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border p-2 rounded"
            required
          />
        </div>

        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
          disabled={loading}
        >
          {loading ? 'ログイン中...' : 'ログイン'}
        </button>
        {error && <p className="text-red-500 mt-2">{error}</p>}
      </form>

      <div className="mt-4">
        <Link href="/register" className="text-blue-600 underline">
          新規登録はこちら
        </Link>
      </div>
    </main>
  );
}
