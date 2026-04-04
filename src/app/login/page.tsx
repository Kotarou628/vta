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

/** 全角→半角・前後空白除去・英字大文字化 + 1桁番号を0埋め */
const normalizeSeat = (raw: string) => {
  let s =
    (raw || '')
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) =>
        String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
      )
      .trim()
      .toUpperCase();

  const m = s.match(/^([A-Z])\s*0?(\d{1,2})$/);
  if (m) {
    const letter = m[1];
    const num2 = m[2].padStart(2, '0');
    s = `${letter}${num2}`;
  }
  return s;
};

/** 全角→半角・前後空白除去・英字大文字化（クラス用） */
const normalizeClass = (raw: string) => {
  return (raw || '')
    .replace(/[Ａ-Ｚａ-ｚ]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    )
    .trim()
    .toUpperCase();
};

/** A〜N + 01〜08 を許可 */
const isValidSeat = (seat: string) => /^[A-O](0[1-7])$/.test(seat);

/** クラスが A〜F, J, K のいずれかであるかチェック */
const isValidClass = (studentClass: string) => /^[A-FJK]$/.test(studentClass);

/** ローカル保存 */
async function saveSeatLocal(seat: string, studentId: string, studentClass: string) {
  try {
    localStorage.setItem('seatNumber', seat);
    localStorage.setItem('studentId', studentId);
    localStorage.setItem('studentClass', studentClass);

    localStorage.setItem(
      'userSettings',
      JSON.stringify({ seatNumber: seat, studentId, studentClass })
    );

    sessionStorage.setItem('seat', seat);
    sessionStorage.setItem('studentId', studentId);
    sessionStorage.setItem('studentClass', studentClass);

    await fetch('/api/session/seat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seat, studentId, studentClass }),
    });
  } catch (e) {
    console.warn('[login] saveSeatLocal failed:', e);
  }
}

/** students コレクションを upsert */
async function upsertStudent(studentId: string, seat: string, studentClass: string) {
  const ref = doc(db, 'students', studentId);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    // 既存データがある場合は createdAt は更新しない
    await setDoc(
      ref,
      {
        seatNumber: seat,
        class: studentClass, 
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } else {
    // 新規作成時
    await setDoc(ref, {
      studentId,
      seatNumber: seat,
      class: studentClass, 
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [studentId, setStudentId] = useState('');
  const [studentClass, setStudentClass] = useState(''); // クラス用State
  const [seat, setSeat] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const sid = studentId.trim();
    const classNormalized = normalizeClass(studentClass);
    const seatNormalized = normalizeSeat(seat);

    if (!sid) {
      setLoading(false);
      setError('学籍番号を入力してください。');
      return;
    }

    if (!isValidClass(classNormalized)) {
      setLoading(false);
      setError('クラスは A〜F、J、K のいずれかを入力してください。');
      return;
    }

    if (!isValidSeat(seatNormalized)) {
      setLoading(false);
      setError('席番号は A02〜O07 の形式で入力してください。（例: K05 / M02）');
      return;
    }
    
    try {
      console.group('[LOGIN] handleLogin');

      // 1) 匿名ログイン
      const cred = await signInAnonymously(auth);
      const user = cred.user;
      console.log('[LOGIN] signed in anonymously. uid =', user.uid);

      // 2) users/{uid} に学籍・座席・クラスを紐づけ
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        // 既に存在するユーザーの場合は createdAt は上書きせず、class等を追加・更新する
        await setDoc(
          userRef,
          {
            studentId: sid,
            class: classNormalized,
            seatNumber: seatNormalized,
            role: 'student',
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        // 全くの新規ユーザーの場合
        await setDoc(userRef, {
          studentId: sid,
          class: classNormalized,
          seatNumber: seatNormalized,
          role: 'student',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      console.log('[LOGIN] users doc upserted');

      // 3) students/{studentId} にも upsert
      await upsertStudent(sid, seatNormalized, classNormalized);
      console.log('[LOGIN] students doc upserted');

      // 4) localStorage / sessionStorage に保存
      await saveSeatLocal(seatNormalized, sid, classNormalized);
      console.log('[LOGIN] localStorage/sessionStorage 保存完了');

      console.groupEnd();

      // 5) チャット画面へ
      router.push('/chat');
    } catch (err: any) {
      console.error('[LOGIN] error:', err);
      setError('ログイン処理でエラーが発生しました。');
    } finally {
      setLoading(false);
    }
  };

  const classHelp = 
    studentClass && !isValidClass(normalizeClass(studentClass))
      ? 'A〜F、J、K のいずれかを入力してください（全角可）'
      : '';

  const seatHelp =
    seat && !isValidSeat(normalizeSeat(seat))
      ? '例: A01 / B08 / K05 / M02（英字+2桁、全角可）'
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

        {/* 新しく追加したクラス入力欄 */}
        <div>
          <label className="block text-sm mb-1">クラス（A〜F、J、K）</label>
          <input
            type="text"
            value={studentClass}
            onChange={(e) => setStudentClass(e.target.value)}
            onBlur={(e) => setStudentClass(normalizeClass(e.target.value))}
            placeholder="A"
            maxLength={1}
            className="w-full border p-2 rounded uppercase"
            required
          />
          {classHelp && <p className="text-xs text-red-500 mt-1">{classHelp}</p>}
        </div>

        <div>
          <label className="block text-sm mb-1">席番号（A02 など）</label>
          <input
            type="text"
            value={seat}
            onChange={(e) => setSeat(e.target.value)}
            onBlur={(e) => setSeat(normalizeSeat(e.target.value))}
            placeholder="A02"
            className="w-full border p-2 rounded uppercase"
            required
          />
          {seatHelp && <p className="text-xs text-red-500 mt-1">{seatHelp}</p>}
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