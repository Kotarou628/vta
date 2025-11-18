// src/app/login/page.tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { db, auth } from '@/lib/firebase';
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';

/** 全角→半角・前後空白除去・英字大文字化 */
const normalizeSeat = (raw: string) =>
  (raw || '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) =>
      String.fromCharCode(s.charCodeAt(0) - 0xfee0)
    )
    .trim()
    .toUpperCase();

/** A〜L + 01〜08 のみ許可（必要なら変更可能） */
const isValidSeat = (seat: string) => /^[A-L](0[1-8])$/.test(seat);

/** ローカル保存（chat ページの互換維持） */
async function saveSeatLocal(seat: string, studentId: string) {
  try {
    localStorage.setItem('seatNumber', seat);
    localStorage.setItem('studentId', studentId);

    localStorage.setItem(
      'userSettings',
      JSON.stringify({ seatNumber: seat, studentId })
    );

    sessionStorage.setItem('seat', seat);
    sessionStorage.setItem('studentId', studentId);

    await fetch('/api/session/seat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seat, studentId }),
    });
  } catch (e) {
    console.warn('[login] saveSeatLocal failed:', e);
  }
}

/** students コレクションを upsert */
async function upsertStudent(studentId: string, seat: string) {
  const ref = doc(db, 'students', studentId);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    await setDoc(
      ref,
      {
        seatNumber: seat,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } else {
    await setDoc(ref, {
      studentId,
      seatNumber: seat,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [studentId, setStudentId] = useState('');
  const [seat, setSeat] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const sid = studentId.trim();
    const seatNormalized = normalizeSeat(seat);

    if (!sid) {
      setLoading(false);
      setError('学籍番号を入力してください。');
      return;
    }
    if (!isValidSeat(seatNormalized)) {
      setLoading(false);
      setError('席番号は A01〜L08 の形式で入力してください。');
      return;
    }

    try {
      console.group('[LOGIN] handleLogin');
      console.log('[LOGIN] input studentId =', sid);
      console.log('[LOGIN] input seat      =', seat, '→', seatNormalized);

      // 1) 匿名ログイン（既にログイン済みなら同じ user が返る）
      const cred = await signInAnonymously(auth);
      const user = cred.user;
      console.log('[LOGIN] signed in anonymously. uid =', user.uid);

      // 2) users/{uid} に学籍・座席を紐づけ（ChatPage の onAuthStateChanged 用）
      const userRef = doc(db, 'users', user.uid);
      await setDoc(
        userRef,
        {
          studentId: sid,
          seatNumber: seatNormalized,
          role: 'student',
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
      console.log('[LOGIN] users doc upserted');

      // 3) students/{studentId} にも upsert（先生側ダッシュボード用）
      await upsertStudent(sid, seatNormalized);
      console.log('[LOGIN] students doc upserted');

      // 4) localStorage / sessionStorage に保存（既存チャット互換）
      await saveSeatLocal(seatNormalized, sid);
      console.log('[LOGIN] localStorage/sessionStorage 保存完了');

      console.groupEnd();

      // 5) チャット画面へ
      router.push('/chat');
    } catch (err: any) {
      console.error('[LOGIN] error:', err);
      if (err?.code === 'auth/operation-not-allowed') {
        setError('Firebase 側で匿名ログインが無効になっています。コンソールの Authentication 設定を確認してください。');
      } else {
        setError('ログイン処理でエラーが発生しました。');
      }
    } finally {
      setLoading(false);
    }
  };

  const seatHelp =
    seat && !isValidSeat(normalizeSeat(seat))
      ? '例: A01 / B08（英字+2桁、全角可）'
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
            className="w-full border p-2 rounded"
            required
          />
          {seatHelp && <p className="text-xs text-gray-500">{seatHelp}</p>}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {loading ? '処理中...' : 'ログイン'}
        </button>

        {error && <p className="text-red-500 mt-2">{error}</p>}
      </form>
    </main>
  );
}
