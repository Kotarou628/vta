// src/app/settings/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export default function SettingsPage() {
  const router = useRouter();
  const [uid, setUid] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  // 編集フィールド（学籍番号は Auth/メール依存なので今回は編集不可にしてます）
  const [studentId, setStudentId] = useState(''); // 表示のみ
  const [fullName, setFullName] = useState('');
  const [classCode, setClassCode] = useState('A');
  const [subject, setSubject] = useState('情報処理演習Ⅰ');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace('/login');
        return;
      }
      setUid(user.uid);
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) {
          const d = snap.data() as any;
          setStudentId(d.studentId ?? '');
          setFullName(d.fullName ?? '');
          setClassCode(d.classCode ?? 'A');
          setSubject(d.subject ?? '情報処理演習Ⅰ');
        }
      } catch (e: any) {
        setError(e?.message ?? '読込に失敗しました');
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setOk('');
    try {
      await setDoc(
        doc(db, 'users', uid),
        { fullName, classCode, subject },
        { merge: true } // 既存フィールドは保持
      );
      setOk('更新しました');
      router.push('/chat'); // 保存後はチャットへ戻る
    } catch (e: any) {
      setError(e?.message ?? '更新に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <main className="max-w-md mx-auto p-6">読み込み中…</main>;

  return (
    <main className="max-w-md mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">ユーザ情報の変更</h1>

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block mb-1">学籍番号（変更不可）</label>
          <input value={studentId} disabled className="w-full border p-2 bg-gray-100" />
        </div>

        <div>
          <label className="block mb-1">氏名（フルネーム）</label>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full border p-2"
            required
          />
        </div>

        <div>
          <label className="block mb-1">クラス（A〜L）</label>
          <select
            value={classCode}
            onChange={(e) => setClassCode(e.target.value)}
            className="w-full border p-2"
          >
            {[...'ABCDEFGHIJKL'].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block mb-1">授業の選択</label>
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full border p-2"
          >
            <option value="情報処理演習Ⅰ">情報処理演習Ⅰ</option>
            <option value="プログラミング基礎">プログラミング基礎</option>
          </select>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            className="px-4 py-2 rounded border"
            onClick={() => router.push('/chat')}
            disabled={saving}
          >
            戻る
          </button>
          <button
            type="submit"
            className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
            disabled={saving}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>

        {error && <p className="text-red-600">{error}</p>}
        {ok && <p className="text-green-600">{ok}</p>}
      </form>
    </main>
  );
}
