// src/app/settings/page.tsx
'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

/** 座席番号を正規化（英字1 + 数字2桁に限定／大文字化）。不正は null を返す */
function normalizeSeatNumber(input: string | null | undefined): string | null {
  const s = (input ?? '').trim().toUpperCase();
  if (!s) return null;
  return /^[A-Z][0-9]{2}$/.test(s) ? s : null; // 例: A01, B12
}

export default function SettingsPage() {
  const router = useRouter();
  const [uid, setUid] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  // 表示/編集フィールド
  const [studentId, setStudentId] = useState(''); // 表示のみ
  const [fullName, setFullName] = useState('');
  const [classCode, setClassCode] = useState('A');
  const [subject, setSubject] = useState('情報処理演習Ⅰ');

  // 座席番号（編集可）
  const [seatNumber, setSeatNumber] = useState('');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace('/login');
        return;
      }
      setUid(user.uid);
      try {
        const ref = doc(db, 'users', user.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const d = snap.data() as any;
          setStudentId(d.studentId ?? '');
          setFullName(d.fullName ?? '');
          setClassCode(d.classCode ?? 'A');
          setSubject(d.subject ?? '情報処理演習Ⅰ');

          // Firestore → localStorage → '' の順で拾い、正規化して表示
          const fromFsOrLs = (d.seatNumber ?? localStorage.getItem('seatNumber') ?? '') + '';
          const normalized = normalizeSeatNumber(fromFsOrLs);
          setSeatNumber(normalized ?? '');
        } else {
          const normalized = normalizeSeatNumber(localStorage.getItem('seatNumber'));
          setSeatNumber(normalized ?? '');
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

    // 入力値を正規化（例: 'a01 ' -> 'A01'）
    const normalized = normalizeSeatNumber(seatNumber);

    // 未入力は null 保存を許容。入力があるが不正ならエラー
    if (seatNumber.trim() !== '' && !normalized) {
      setError('座席番号は「英字＋2桁の数字（例: A01）」で入力してください。');
      setSaving(false);
      return;
    }

    try {
      await setDoc(
        doc(db, 'users', uid),
        {
          fullName,
          classCode,
          subject,
          // 正規化した値（未入力なら null）
          seatNumber: normalized ?? null,
          updatedAt: new Date(),
        },
        { merge: true }
      );

      // localStorage も正規化値だけ保存
      if (normalized) {
        localStorage.setItem('seatNumber', normalized);
      } else {
        localStorage.removeItem('seatNumber');
      }

      setOk('更新しました');
      router.push('/chat'); // 保存後にチャットへ
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

        {/* 座席番号（英字＋2桁数字、表示時は自動で大文字化） */}
        <div>
          <label className="block mb-1">座席番号</label>
          <input
            type="text"
            value={seatNumber}
            onChange={(e) => setSeatNumber(e.target.value)}
            className="w-full border p-2 uppercase"
            placeholder="例: A01"
            // ブラウザ側バリデーション（英字1 + 数字2桁）
            pattern="[A-Za-z][0-9]{2}"
            title="先頭が英字、続いて2桁の数字（例: A01）"
          />
          <p className="text-xs text-gray-500 mt-1">
            チャットログ保存時に seatNumber として記録されます（自動で大文字化）。
          </p>
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
