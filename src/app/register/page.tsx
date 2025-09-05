// Firebase Authentication + Firestore 連携
// ユーザー登録画面（Next.js + Firebase）
// src/app/register/page.tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { idToEmail } from '@/lib/nameToEmail';

export default function RegisterPage() {
  const router = useRouter();

  const [studentId, setStudentId] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [classCode, setClassCode] = useState('A');
  const [subject, setSubject] = useState('情報処理演習Ⅰ');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // 確認モーダル表示フラグ
  const [showConfirm, setShowConfirm] = useState(false);

  // 実際の登録処理（OK押下で実行）
  const doRegister = async () => {
    setLoading(true);
    setError('');
    setSuccess(false);

    try {
      // 学籍番号の簡易バリデーション
      if (!/^[a-zA-Z0-9_-]+$/.test(studentId)) {
        setError('学籍番号は英数字と - _ のみ使用できます');
        setLoading(false);
        return;
      }

      const email = idToEmail(studentId.trim());
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const uid = cred.user.uid;

      await cred.user.getIdToken(true);

      await setDoc(doc(db, 'users', uid), {
        uid,
        studentId: studentId.trim(),
        fullName,
        classCode,
        subject,
        emailAlias: email,
        createdAt: serverTimestamp(),
      });

      setSuccess(true);
      // ✅ そのままチャットへ
      router.push('/chat');
    } catch (err: any) {
      if (err?.code === 'auth/email-already-in-use') {
        setError('この学籍番号はすでに登録されています。');
      } else if (err?.code === 'auth/weak-password') {
        setError('パスワードは6文字以上にしてください。');
      } else {
        console.error('登録エラー:', err);
        setError(err?.message ?? '登録に失敗しました');
      }
    } finally {
      setLoading(false);
      setShowConfirm(false);
    }
  };

  // 「登録内容を確認」押下でモーダル表示
  const openConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!studentId || !fullName || !password) {
      setError('入力に不足があります');
      return;
    }
    if (password.length < 6) {
      setError('パスワードは6文字以上にしてください。');
      return;
    }
    setShowConfirm(true);
  };

  return (
    <main className="max-w-md mx-auto p-6">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-2xl font-bold">新規ユーザ登録</h1>
        <Link href="/login" className="text-blue-600 underline">
          ログインへ戻る
        </Link>
      </div>

      <form className="space-y-4" onSubmit={openConfirm}>
        <div>
          <label>学籍番号</label>
          <input
            type="text"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            className="w-full border p-2"
            required
          />
        </div>

        <div>
          <label>氏名（フルネーム）</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full border p-2"
            required
          />
        </div>

        <div>
          <label>パスワード（6文字以上）</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border p-2"
            required
            minLength={6}
            placeholder="6文字以上"
          />
        </div>

        <div>
          <label>クラス（A〜L）</label>
          <select
            value={classCode}
            onChange={(e) => setClassCode(e.target.value)}
            className="w-full border p-2"
          >
            {[...'ABCDEFGHIJKL'].map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>授業の選択</label>
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full border p-2"
          >
            <option value="情報処理演習Ⅰ">情報処理演習Ⅰ</option>
            <option value="プログラミング基礎">プログラミング基礎</option>
          </select>
        </div>

        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
          disabled={loading}
        >
          {loading ? '確認中...' : '登録内容を確認'}
        </button>

        {error && <p className="text-red-500">エラー: {error}</p>}
        {success && <p className="text-green-600">登録が完了しました！</p>}
      </form>

      {/* 確認モーダル */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded shadow-lg w-[90%] max-w-md p-5">
            <h2 className="text-lg font-bold mb-3">登録内容の確認</h2>
            <div className="space-y-2 text-sm">
              <div><span className="font-semibold">学籍番号:</span> {studentId}</div>
              <div><span className="font-semibold">氏名:</span> {fullName}</div>
              <div><span className="font-semibold">クラス:</span> {classCode}</div>
              <div><span className="font-semibold">授業:</span> {subject}</div>
              <div className="text-gray-500 text-xs">※ パスワードは表示しません</div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                className="px-4 py-2 rounded border"
                onClick={() => setShowConfirm(false)}
                disabled={loading}
              >
                戻る
              </button>
              <button
                className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
                onClick={doRegister}
                disabled={loading}
              >
                {loading ? '登録中...' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
