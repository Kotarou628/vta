//C:\Users\Admin\vta\src\app\login\page.tsx
// src/app/login/page.tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { idToEmail } from '@/lib/nameToEmail';

export default function LoginPage() {
  const router = useRouter();
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const email = idToEmail(studentId.trim());
      await signInWithEmailAndPassword(auth, email, password);
      // ✅ ログイン成功でチャットへ
      router.push('/chat');
    } catch {
      setError('学籍番号またはパスワードが正しくありません');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">ログイン</h1>
      <form onSubmit={handleLogin} className="space-y-4">
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
          <label>パスワード</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border p-2"
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
