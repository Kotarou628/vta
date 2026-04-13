'use client'

import { useEffect, useState, useCallback, DragEvent, ChangeEvent } from 'react'
// --- 追加ライブラリ ---
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
// ----------------------
import ProblemList from '@/components/ProblemList'
import type { Problem as ProblemType, SolutionFile } from '@/types/problem'

const DEBUG = true
const dlog = (...args: any[]) => {
  if (DEBUG) console.log('[ProblemPage DEBUG]', ...args)
}

type ProblemWithVisible = ProblemType & {
  visibleInChat?: boolean | null
  visible_in_chat?: boolean | 0 | 1 | '0' | '1' | null
}

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
  return ''
}

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

function normalizeVisibleFlag(raw: any): boolean {
  if (raw === undefined || raw === null) return true
  if (raw === true || raw === false) return raw
  if (raw === 1 || raw === '1') return true
  if (raw === 0 || raw === '0') return false
  return Boolean(raw)
}

export default function ProblemPage() {
  const [problems, setProblems] = useState<ProblemWithVisible[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editSolutionCode, setEditSolutionCode] = useState('')

  const emptyFile = (): SolutionFile => ({ filename: '', language: '', code: '' })
  const [editSolutionFiles, setEditSolutionFiles] = useState<SolutionFile[]>([emptyFile()])

  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newSolutionCode, setNewSolutionCode] = useState('') 
  const [newFiles, setNewFiles] = useState<SolutionFile[]>([emptyFile()])
  const [newVisibleInChat, setNewVisibleInChat] = useState<boolean>(true)

  const fetchProblems = async () => {
    dlog('--- fetchProblems START ---')
    const res = await fetch('/api/problem')
    const data: any[] = await res.json()
    const sorted = data.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const normalized: ProblemWithVisible[] = sorted.map((p) => {
      const norm = normalizeVisibleFlag((p as any).visibleInChat ?? (p as any).visible_in_chat)
      return { ...p, visibleInChat: norm }
    })
    setProblems(normalized)
  }

  const handleSubmit = async () => {
    const filesPayload = newFiles.filter((f) => f.filename || f.code)
    const body = {
      title: newTitle,
      description: newDescription,
      solution_files: filesPayload,
      solution_code: newSolutionCode,
      visibleInChat: newVisibleInChat,
      visible_in_chat: newVisibleInChat,
    }
    await fetch('/api/problem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setNewTitle('')
    setNewDescription('')
    setNewSolutionCode('')
    setNewFiles([emptyFile()])
    setNewVisibleInChat(true)
    fetchProblems()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('この問題を削除しますか？')) return
    await fetch(`/api/problem/${id}`, { method: 'DELETE' })
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
      const files = problem.solution_files && problem.solution_files.length > 0
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
      solution_code: editSolutionCode,
    }
    await fetch(`/api/problem/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setExpandedId(null)
    fetchProblems()
  }

  const handleToggleVisible = async (id: string, next: boolean) => {
    const targetBefore = problems.find((p) => p.id === id)
    setProblems((prev) => prev.map((p) => (p.id === id ? { ...p, visibleInChat: next } : p)))
    const body = {
      title: targetBefore?.title ?? '',
      description: targetBefore?.description ?? '',
      solution_files: targetBefore?.solution_files ?? [],
      solution_code: targetBefore?.solution_code ?? '',
      visibleInChat: next,
      visible_in_chat: next,
    }
    try {
      await fetch(`/api/problem/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      await fetchProblems()
    } catch (e) {
      console.error('更新失敗', e)
    }
  }

  const handleReorder = async (newList: ProblemType[]) => {
    setProblems(newList as ProblemWithVisible[])
    await fetch('/api/problem/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        problems: newList.map((p, index) => ({ id: p.id, order: index })),
      }),
    })
    fetchProblems()
  }

  useEffect(() => { fetchProblems() }, [])

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

  const handleDropNew = useCallback(async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const dtFiles = Array.from(e.dataTransfer.files || [])
    if (dtFiles.length === 0) return
    const sf = await filesToSolutionFiles(dtFiles)
    setNewFiles((prev) => [...prev.filter((f) => f.filename || f.code), ...sf])
  }, [])

  const handleSelectNew = async (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList || fileList.length === 0) return
    const sf = await filesToSolutionFiles(Array.from(fileList))
    setNewFiles((prev) => [...prev.filter((f) => f.filename || f.code), ...sf])
    e.target.value = ''
  }

  const preventDefault = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <main className="p-4 max-w-4xl mx-auto"> {/* 数式が見やすいよう幅を広げました */}
      <h1 className="text-2xl font-bold mb-4">問題の管理</h1>

      <div className="space-y-4 mb-6 bg-white border p-4 rounded shadow-sm">
        <h2 className="text-lg font-semibold border-b pb-2">新規登録</h2>
        
        <input
          className="w-full border p-2 rounded"
          placeholder="タイトル"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />

        {/* --- 説明文 + プレビューエリア --- */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-500 uppercase">説明 (Markdown / LaTeX)</label>
            <textarea
              className="w-full border p-2 rounded h-64 font-mono text-sm"
              placeholder="例: $x_{n+1} = \frac{2x_n}{3}$"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-500 uppercase">ライブプレビュー</label>
            <div className="w-full border p-3 rounded h-64 overflow-auto bg-gray-50 prose prose-blue max-w-none shadow-inner">
              <ReactMarkdown
                remarkPlugins={[remarkMath]}
                rehypePlugins={[rehypeKatex]}
              >
                {newDescription || '*ここにプレビューが表示されます。数式は `$x^2$` や `$$公式$$` で記述できます。画像は `![alt](url)` で表示可能です。*'}
              </ReactMarkdown>
            </div>
          </div>
        </div>
        {/* ------------------------------- */}

        <div
          className="border-2 border-dashed rounded p-4 text-center text-sm text-gray-400 bg-gray-50 hover:border-blue-400 hover:text-blue-500 transition-colors"
          onDragOver={preventDefault}
          onDragEnter={preventDefault}
          onDrop={handleDropNew}
        >
          ここに模範解答ファイルをドラッグ＆ドロップ（複数可）
          <div className="mt-2 text-xs">
            <label className="cursor-pointer underline">
              クリックしてファイルを選択
              <input type="file" multiple className="hidden" accept=".java,.c,.cpp,.py,.js,.ts,.txt" onChange={handleSelectNew} />
            </label>
          </div>
        </div>

        <div className="space-y-3 border rounded p-3 bg-gray-50">
          <div className="font-semibold text-sm flex justify-between">
            <span>解答ファイル</span>
            <button type="button" className="text-blue-600 hover:underline text-xs" onClick={addNewFile}>＋ 追加</button>
          </div>
          {newFiles.map((f, i) => (
            <div key={i} className="border bg-white rounded p-2 space-y-2 relative">
              <div className="flex gap-2">
                <input className="flex-1 border p-1 text-sm rounded" placeholder="Main.java" value={f.filename} onChange={(e) => updateNewFile(i, 'filename', e.target.value)} />
                <select className="border p-1 text-sm rounded" value={f.language ?? ''} onChange={(e) => updateNewFile(i, 'language', e.target.value)}>
                  <option value="">言語</option>
                  <option value="java">Java</option>
                  <option value="c">C</option>
                  <option value="python">Python</option>
                  <option value="javascript">JavaScript</option>
                </select>
                <button type="button" className="text-red-500 text-xs px-2" onClick={() => removeNewFile(i)}>削除</button>
              </div>
              <textarea className="w-full border p-1 text-xs font-mono rounded bg-gray-50" rows={4} placeholder="コードを入力" value={f.code} onChange={(e) => updateNewFile(i, 'code', e.target.value)} />
            </div>
          ))}
        </div>

        <textarea
          className="w-full border p-2 text-sm rounded bg-gray-50"
          placeholder="（互換用）単一ファイル解答コード"
          value={newSolutionCode}
          onChange={(e) => setNewSolutionCode(e.target.value)}
        />

        <div className="flex items-center justify-between">
          <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={newVisibleInChat} onChange={(e) => setNewVisibleInChat(e.target.checked)} />
            <span>Chat画面に表示する</span>
          </label>
          <button onClick={handleSubmit} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded font-bold transition-colors shadow">
            問題を追加
          </button>
        </div>
      </div>

      <hr className="my-8" />

      {/* ※注: ProblemList コンポーネント側でも ReactMarkdown を使って description を表示するように
          修正すると、管理画面の一覧でも数式が綺麗に表示されるようになります。
      */}
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
        onToggleVisible={handleToggleVisible}
      />
      
      {/* 編集モード（expandedIdがある時）のプレビューも表示させたい場合は、
          ProblemListに渡している setEditDescription 等の先でプレビューを表示するよう
          ProblemList.tsx 側の修正をお勧めします。 */}
    </main>
  )
}