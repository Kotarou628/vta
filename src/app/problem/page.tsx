// src/app/problem/page.tsx
'use client'

import { useEffect, useState, useCallback, DragEvent, ChangeEvent } from 'react'
import ProblemList from '@/components/ProblemList'
import type { Problem as ProblemType, SolutionFile } from '@/types/problem'

const DEBUG = true
const dlog = (...args: any[]) => {
  if (DEBUG) console.log('[ProblemPage DEBUG]', ...args)
}

/** この画面用に Chat 表示フラグを足した型 */
type ProblemWithVisible = ProblemType & {
  visibleInChat?: boolean | null
  // バックエンド側が snake_case の場合にも備える
  visible_in_chat?: boolean | 0 | 1 | '0' | '1' | null
}

/** 拡張子から言語を推定 */
function inferLanguage(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.java')) return 'java'
  if (lower.endsWith('.c')) return 'c'
  if (lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.cxx')) return 'cpp'
  if (lower.endsWith('.py')) return 'python'
  if (lower.endsWith('.js')) return 'javascript'
  if (lower.endsWith('.ts')) return 'typescript'
  if (lower.endsWith('.kt')) return 'kotlin'
  if (lower.endsWith('.swift')) return 'swift'
  if (lower.endsWith('.rb')) return 'ruby'
  if (lower.endsWith('.go')) return 'go'
  return '' // 不明は空
}

/** File[] -> SolutionFile[] に変換（テキスト読み込み） */
async function filesToSolutionFiles(files: File[]): Promise<SolutionFile[]> {
  const tasks = files.map(async (f) => {
    const code = await f.text()
    return {
      filename: f.name,
      language: inferLanguage(f.name),
      code,
    } as SolutionFile
  })
  return Promise.all(tasks)
}

/** DB から返ってきた値を確実に boolean にする */
function normalizeVisibleFlag(raw: any): boolean {
  if (raw === undefined || raw === null) return true // 未設定は ON 扱い
  if (raw === true || raw === false) return raw
  if (raw === 1 || raw === '1') return true
  if (raw === 0 || raw === '0') return false
  return Boolean(raw)
}

export default function ProblemPage() {
  const [problems, setProblems] = useState<ProblemWithVisible[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // 既存：単一コード編集（互換維持）
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editSolutionCode, setEditSolutionCode] = useState('')

  // 新：複数ファイル編集
  const emptyFile = (): SolutionFile => ({ filename: '', language: '', code: '' })
  const [editSolutionFiles, setEditSolutionFiles] = useState<SolutionFile[]>([emptyFile()])

  // 新規作成フォーム
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newSolutionCode, setNewSolutionCode] = useState('') // 互換
  const [newFiles, setNewFiles] = useState<SolutionFile[]>([emptyFile()])

  // ★ 新規問題の Chat 表示フラグ（デフォルト ON）
  const [newVisibleInChat, setNewVisibleInChat] = useState<boolean>(true)

  const fetchProblems = async () => {
    dlog('--- fetchProblems START ---')
    const res = await fetch('/api/problem')
    const data: any[] = await res.json()
    dlog('/api/problem raw response:', data)

    const sorted = data.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

    const normalized: ProblemWithVisible[] = sorted.map((p, idx) => {
      const rawCamel = (p as any).visibleInChat
      const rawSnake = (p as any).visible_in_chat
      const norm = normalizeVisibleFlag(rawCamel ?? rawSnake)
      dlog('normalize item', idx, {
        id: p.id,
        title: p.title,
        rawCamel,
        rawSnake,
        norm,
      })
      return {
        ...p,
        visibleInChat: norm,
      }
    })

    dlog('setProblems(normalized):', normalized.map(p => ({
      id: p.id,
      title: p.title,
      visibleInChat: p.visibleInChat,
      visible_in_chat: (p as any).visible_in_chat,
    })))

    setProblems(normalized)
    dlog('--- fetchProblems END ---')
  }

  const handleSubmit = async () => {
    // solution_files: 手動入力 + D&D
    const filesPayload = newFiles.filter((f) => f.filename || f.code)

    const body = {
      title: newTitle,
      description: newDescription,
      solution_files: filesPayload,
      // 互換用：単一コードも別フィールドで送る（サーバ側で使うかは任意）
      solution_code: newSolutionCode,
      // ★ どちらの名前でもサーバが拾えるように両方送る
      visibleInChat: newVisibleInChat,
      visible_in_chat: newVisibleInChat,
    }
    dlog('POST /api/problem body:', body)

    const res = await fetch('/api/problem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    dlog('POST /api/problem status:', res.status, 'ok:', res.ok)

    setNewTitle('')
    setNewDescription('')
    setNewSolutionCode('')
    setNewFiles([emptyFile()])
    setNewVisibleInChat(true)

    fetchProblems()
  }

  const handleDelete = async (id: string) => {
    const ok = confirm('この問題を削除しますか？')
    if (!ok) return
    dlog('DELETE /api/problem/', id)
    const res = await fetch(`/api/problem/${id}`, { method: 'DELETE' })
    dlog('DELETE status:', res.status, 'ok:', res.ok)
    fetchProblems()
  }

  const toggleExpand = (problem: ProblemWithVisible) => {
    if (expandedId === problem.id) {
      setExpandedId(null)
    } else {
      setExpandedId(problem.id)
      setEditTitle(problem.title ?? '')
      setEditDescription(problem.description ?? '')
      setEditSolutionCode(problem.solution_code ?? '')

      const files =
        problem.solution_files && problem.solution_files.length > 0
          ? problem.solution_files
          : problem.solution_code
            ? [{ filename: '', language: '', code: problem.solution_code }]
            : [emptyFile()]
      setEditSolutionFiles(files)
    }
  }

  const handleUpdate = async (id: string) => {
    const body = {
      title: editTitle,
      description: editDescription,
      solution_files: editSolutionFiles.filter((f) => f.filename || f.code),
      solution_code: editSolutionCode, // 互換
      // visibleInChat はヘッダのチェックボックスで別更新するのでここでは触らない
    }
    dlog('PUT /api/problem (update core fields) id:', id, 'body:', body)

    const res = await fetch(`/api/problem/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    dlog('PUT core status:', res.status, 'ok:', res.ok)

    setExpandedId(null)
    fetchProblems()
  }

  // ★ Chat 表示フラグの切り替え
  const handleToggleVisible = async (id: string, next: boolean) => {
    dlog('handleToggleVisible called:', { id, next })

    const targetBefore = problems.find((p) => p.id === id)
    dlog('targetBefore:', targetBefore)

    // 画面側を先に更新（楽観的更新）
    setProblems((prev) => {
      const updated = prev.map((p) => (p.id === id ? { ...p, visibleInChat: next } : p))
      dlog('optimistic problems state after toggle:', updated.map(p => ({
        id: p.id,
        title: p.title,
        visibleInChat: p.visibleInChat,
        visible_in_chat: (p as any).visible_in_chat,
      })))
      return updated
    })

    const body = {
      title: targetBefore?.title ?? '',
      description: targetBefore?.description ?? '',
      solution_files: targetBefore?.solution_files ?? [],
      solution_code: targetBefore?.solution_code ?? '',
      // ★ どちらの名前でもサーバが拾えるように両方送る
      visibleInChat: next,
      visible_in_chat: next,
    }
    dlog('PUT /api/problem (toggle visible) id:', id, 'body:', body)

    try {
      const res = await fetch(`/api/problem/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      dlog('PUT toggle status:', res.status, 'ok:', res.ok)

      // 念のため再取得（サーバ側の値を反映）
      await fetchProblems()
    } catch (e) {
      console.error('問題の表示フラグ更新に失敗しました', e)
    }
  }

  const handleReorder = async (newList: ProblemType[]) => {
    dlog('handleReorder newList:', newList.map(p => ({
      id: p.id,
      title: p.title,
    })))

    setProblems(newList as ProblemWithVisible[])
    const body = {
      problems: newList.map((p, index) => ({ id: p.id, order: index })),
    }
    dlog('PUT /api/problem/reorder body:', body)

    const res = await fetch('/api/problem/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    dlog('PUT /api/problem/reorder status:', res.status, 'ok:', res.ok)

    fetchProblems()
  }

  useEffect(() => {
    fetchProblems()
  }, [])

  // problems が変わるたびに状態をダンプ
  useEffect(() => {
    dlog('++ problems state changed ++')
    problems.forEach((p, idx) => {
      dlog(`  [${idx}]`, {
        id: p.id,
        title: p.title,
        visibleInChat: p.visibleInChat,
        visible_in_chat: (p as any).visible_in_chat,
      })
    })
  }, [problems])

  // 新規フォーム：手動入力ユーティリティ
  const updateNewFile = (i: number, field: keyof SolutionFile, value: string) => {
    const list = [...newFiles]
    list[i] = { ...list[i], [field]: value }
    setNewFiles(list)
  }
  const addNewFile = () => setNewFiles((prev) => [...prev, emptyFile()])
  const removeNewFile = (i: number) => {
    const list = [...newFiles]
    list.splice(i, 1)
    setNewFiles(list.length ? list : [emptyFile()])
  }

  // === ドラッグ＆ドロップ（新規） ===
  const handleDropNew = useCallback(async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const dtFiles = Array.from(e.dataTransfer.files || [])
    if (dtFiles.length === 0) return
    const sf = await filesToSolutionFiles(dtFiles)
    setNewFiles((prev) => {
      const base = prev.filter((f) => f.filename || f.code) // 空行除去
      return [...base, ...sf]
    })
  }, [])

  const handleSelectNew = async (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList || fileList.length === 0) return
    const sf = await filesToSolutionFiles(Array.from(fileList))
    setNewFiles((prev) => {
      const base = prev.filter((f) => f.filename || f.code)
      return [...base, ...sf]
    })
    e.target.value = '' // 同じファイルでも再選択可能に
  }

  const preventDefault = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <main className="p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">問題の管理</h1>

      {/* 新規登録フォーム */}
      <div className="space-y-2 mb-6">
        <input
          className="w-full border p-2"
          placeholder="タイトル"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <textarea
          className="w-full border p-2"
          placeholder="説明"
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
        />

        {/* ★ ドラッグ＆ドロップでファイル追加（新規） */}
        <div
          className="border-2 border-dashed rounded p-4 text-center text-sm text-gray-600 bg-gray-50"
          onDragOver={preventDefault}
          onDragEnter={preventDefault}
          onDrop={handleDropNew}
        >
          ここに模範解答ファイルをドラッグ＆ドロップ（複数可）
          <div className="mt-2">
            <label className="cursor-pointer underline">
              クリックしてファイルを選択
              <input
                type="file"
                multiple
                className="hidden"
                accept=".java,.c,.cpp,.cc,.cxx,.py,.js,.ts,.kt,.swift,.rb,.go,.txt"
                onChange={handleSelectNew}
              />
            </label>
          </div>
        </div>

        {/* 複数ファイル入力ゾーン（手動編集も併用可能） */}
        <div className="space-y-3 border rounded p-3">
          <div className="font-semibold">解答ファイル</div>
          {newFiles.map((f, i) => (
            <div key={i} className="border rounded p-2 space-y-2">
              <div className="flex gap-2">
                <input
                  className="flex-1 border p-2"
                  placeholder="ファイル名（例: Main.java / main.c）"
                  value={f.filename}
                  onChange={(e) => updateNewFile(i, 'filename', e.target.value)}
                />
                <select
                  className="w-40 border p-2"
                  value={f.language ?? ''}
                  onChange={(e) => updateNewFile(i, 'language', e.target.value)}
                >
                  <option value="">言語(任意)</option>
                  <option value="c">C</option>
                  <option value="cpp">C++</option>
                  <option value="java">Java</option>
                  <option value="python">Python</option>
                  <option value="javascript">JavaScript</option>
                  <option value="typescript">TypeScript</option>
                </select>
                <button
                  type="button"
                  className="border px-2 rounded"
                  onClick={() => removeNewFile(i)}
                >
                  削除
                </button>
              </div>
              <textarea
                className="w-full border p-2"
                rows={8}
                placeholder="このファイルの解答コード"
                value={f.code}
                onChange={(e) => updateNewFile(i, 'code', e.target.value)}
              />
            </div>
          ))}
          <button type="button" className="border px-3 py-1 rounded" onClick={addNewFile}>
            ＋ ファイルを追加
          </button>
        </div>

        {/* 互換：従来の単一入力（送信は solution_files / solution_code を併用） */}
        <textarea
          className="w-full border p-2"
          placeholder="（互換）解答コード（単一ファイル）"
          value={newSolutionCode}
          onChange={(e) => setNewSolutionCode(e.target.value)}
        />

        {/* ★ Chat 表示フラグ */}
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={newVisibleInChat}
            onChange={(e) => setNewVisibleInChat(e.target.checked)}
          />
          <span>Chat画面の問題一覧に表示する</span>
        </label>

        <button
          onClick={handleSubmit}
          className="bg-blue-600 text-white px-4 py-2 rounded"
        >
          問題を追加
        </button>
      </div>

      <hr className="my-6" />

      {/* 並べ替え可能なリスト */}
      <ProblemList
        problems={problems ?? []}
        onReorder={handleReorder}
        expandedId={expandedId}
        toggleExpand={toggleExpand}
        editTitle={editTitle}
        setEditTitle={setEditTitle}
        editDescription={editDescription}
        setEditDescription={setEditDescription}
        editSolutionCode={editSolutionCode}
        setEditSolutionCode={setEditSolutionCode}
        editSolutionFiles={editSolutionFiles ?? []}
        setEditSolutionFiles={setEditSolutionFiles}
        handleUpdate={handleUpdate}
        handleDelete={handleDelete}
        // ★ Chat 表示フラグ切り替え
        onToggleVisible={handleToggleVisible}
      />
    </main>
  )
}
