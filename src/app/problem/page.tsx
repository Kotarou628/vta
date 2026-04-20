'use client'
export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, DragEvent, ChangeEvent, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import ProblemList from '@/components/ProblemList'
import type { Problem as ProblemType, SolutionFile } from '@/types/problem'


const DEBUG = true
const dlog = (...args: any[]) => {
  if (DEBUG) console.log('[ProblemPage DEBUG]', ...args)
}

/** 画面表示用に型を拡張 */
type ProblemWithVisible = ProblemType & {
  visibleInChat?: boolean | null
  visible_in_chat?: boolean | 0 | 1 | '0' | '1' | null
}

/** 拡張子から言語を推定 (既存機能) */
function inferLanguage(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.java')) return 'java'
  if (lower.endsWith('.c')) return 'c'
  if (lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.cxx')) return 'cpp'
  if (lower.endsWith('.py')) return 'python'
  if (lower.endsWith('.js')) return 'javascript'
  if (lower.endsWith('.ts')) return 'typescript'
  return ''
}

/** File[] -> SolutionFile[] に変換 (既存機能) */
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

/** DBのフラグを正規化 */
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

  // 編集用ステート
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editSolutionCode, setEditSolutionCode] = useState('')
  const [editSolutionFiles, setEditSolutionFiles] = useState<SolutionFile[]>([{ filename: '', code: '' }])

  // 新規登録用ステート
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newSolutionCode, setNewSolutionCode] = useState('') 
  const [newFiles, setNewFiles] = useState<SolutionFile[]>([{ filename: '', code: '' }])
  const [newVisibleInChat, setNewVisibleInChat] = useState<boolean>(true)

  // スクロール同期・リサイズ用のRef
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  // --- スクロール同期ロジック ---
  const handleEditorScroll = () => {
    if (!editorRef.current || !previewRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = editorRef.current
    const scrollRatio = scrollTop / (scrollHeight - clientHeight)
    previewRef.current.scrollTop = scrollRatio * (previewRef.current.scrollHeight - previewRef.current.clientHeight)
  }

  // --- 説明文への画像ドロップ (Base64) ---
  const handleDescriptionImageDrop = async (e: DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    const imageFile = files.find(f => f.type.startsWith('image/'))
    if (imageFile) {
      const reader = new FileReader()
      reader.onload = (event) => {
        const base64 = event.target?.result
        setNewDescription(prev => prev + `\n![image](${base64})\n`)
      }
      reader.readAsDataURL(imageFile)
    }
  }

  // --- 解答ファイル管理ロジック (既存機能復活) ---
  const addNewFile = () => {
    setNewFiles(prev => [...prev, { filename: '', code: '' }])
  }
  const removeNewFile = (index: number) => {
    setNewFiles(prev => {
      const updated = prev.filter((_, i) => i !== index)
      return updated.length > 0 ? updated : [{ filename: '', code: '' }]
    })
  }
  const updateNewFile = (index: number, field: keyof SolutionFile, value: string) => {
    setNewFiles(prev => prev.map((f, i) => i === index ? { ...f, [field]: value } : f))
  }

  // --- 解答ファイルのドラッグ&ドロップ (既存機能復活) ---
  const handleDropSolutionFiles = useCallback(async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const dtFiles = Array.from(e.dataTransfer.files || [])
    if (dtFiles.length === 0) return
    const sf = await filesToSolutionFiles(dtFiles)
    setNewFiles((prev) => [...prev.filter((f) => f.filename || f.code), ...sf])
  }, [])

  const preventDefault = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  // --- API連携ロジック ---
  const fetchProblems = async () => {
    const res = await fetch('/api/problem')
    const data: any[] = await res.json()
    const sorted = data.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    setProblems(sorted.map(p => ({ ...p, visibleInChat: normalizeVisibleFlag(p.visibleInChat ?? p.visible_in_chat) })))
  }

  const handleSubmit = async () => {
    const body = {
      title: newTitle,
      description: newDescription,
      solution_files: newFiles.filter(f => f.filename || f.code),
      solution_code: newSolutionCode,
      visibleInChat: newVisibleInChat,
      visible_in_chat: newVisibleInChat,
    }
    await fetch('/api/problem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setNewTitle(''); setNewDescription(''); setNewFiles([{ filename: '', code: '' }]); fetchProblems()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('削除しますか？')) return
    await fetch(`/api/problem/${id}`, { method: 'DELETE' })
    fetchProblems()
  }

  const toggleExpand = (problem: ProblemWithVisible) => {
    if (expandedId === problem.id) {
      setExpandedId(null)
    } else {
      setExpandedId(problem.id)
      setEditTitle(problem.title || '')
      setEditDescription(problem.description || '')
      setEditSolutionFiles(problem.solution_files?.length ? problem.solution_files : [{ filename: '', code: '' }])
    }
  }

  const handleUpdate = async (id: string) => {
    const body = { title: editTitle, description: editDescription, solution_files: editSolutionFiles.filter(f => f.filename) }
    await fetch(`/api/problem/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setExpandedId(null); fetchProblems()
  }

  const handleToggleVisible = async (id: string, next: boolean) => {
    const target = problems.find(p => p.id === id)
    const body = { ...target, visibleInChat: next, visible_in_chat: next }
    await fetch(`/api/problem/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    fetchProblems()
  }

  const handleReorder = async (newList: ProblemType[]) => {
    setProblems(newList as ProblemWithVisible[])
    await fetch('/api/problem/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problems: newList.map((p, index) => ({ id: p.id, order: index })) }),
    })
  }

  useEffect(() => { fetchProblems() }, [])

  return (
    <main className="p-4 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-gray-800">問題の管理</h1>

      <div className="space-y-6 mb-10 bg-white border shadow-xl rounded-xl p-6">
        <h2 className="text-xl font-bold text-blue-700 border-b pb-2">新規課題登録</h2>
        
        <input 
          className="w-full border-2 p-3 rounded-lg outline-none focus:border-blue-500" 
          placeholder="タイトル" 
          value={newTitle} 
          onChange={e => setNewTitle(e.target.value)} 
        />

        {/* --- Markdownエディタ + プレビュー --- */}
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-bold text-gray-400">説明文 (Markdown / 画像ドロップ対応)</label>
            <textarea
              ref={editorRef}
              onScroll={handleEditorScroll}
              onDrop={handleDescriptionImageDrop}
              className="w-full border-2 p-4 rounded-lg font-mono text-sm min-h-[400px] resize-y outline-none focus:border-blue-500 bg-white shadow-inner"
              placeholder="ここに問題文を記述... (画像をここにドロップすると挿入されます)"
              value={newDescription}
              onChange={e => setNewDescription(e.target.value)}
            />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-bold text-gray-400">ライブプレビュー (スクロール同期)</label>
            <div 
              ref={previewRef} 
              className="w-full border-2 p-5 rounded-lg h-[400px] md:h-full overflow-auto bg-gray-50 prose prose-blue max-w-none shadow-inner whitespace-pre-wrap font-mono"
              style={{ lineHeight: '1.2' }}
            >
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {newDescription || '*プレビューがここに表示されます*'}
              </ReactMarkdown>
            </div>
          </div>
        </div>

        {/* --- 解答ファイル ドラッグ&ドロップエリア (既存機能) --- */}
        <div
          className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center text-sm text-gray-500 bg-gray-50 hover:bg-blue-50 hover:border-blue-400 transition-all cursor-pointer"
          onDragOver={preventDefault}
          onDragEnter={preventDefault}
          onDrop={handleDropSolutionFiles}
        >
          <div className="font-bold text-lg mb-2">ここに模範解答ファイルをドラッグ＆ドロップ</div>
          <p className="mb-4 text-gray-400">（複数ファイルを一度に読み込めます）</p>
          <label className="bg-white border px-4 py-2 rounded shadow-sm cursor-pointer hover:bg-gray-50">
            ファイルを選択
            <input 
              type="file" 
              multiple 
              className="hidden" 
              accept=".java,.c,.cpp,.py,.js,.ts" 
              onChange={async (e) => {
                const sf = await filesToSolutionFiles(Array.from(e.target.files || []))
                setNewFiles(prev => [...prev.filter(f => f.filename), ...sf])
              }} 
            />
          </label>
        </div>

        {/* 解答ファイル個別編集リスト */}
        <div className="space-y-3 bg-gray-50 p-4 rounded-lg border">
          <div className="flex justify-between items-center font-bold text-sm text-gray-600">
            <span>登録解答ファイル一覧</span>
            <button type="button" onClick={addNewFile} className="text-blue-600 hover:underline">＋ 手動で追加</button>
          </div>
          {newFiles.map((f, i) => (
            <div key={i} className="bg-white border p-3 rounded-lg shadow-sm space-y-2">
              <div className="flex gap-2">
                <input className="flex-1 border p-2 text-sm rounded focus:border-blue-300 outline-none" placeholder="ファイル名 (例: CubicRoot.java)" value={f.filename} onChange={e => updateNewFile(i, 'filename', e.target.value)} />
                <button type="button" onClick={() => removeNewFile(i)} className="text-red-500 font-bold px-3 hover:bg-red-50 rounded">✕</button>
              </div>
              <textarea className="w-full border p-2 text-xs font-mono rounded bg-gray-50 outline-none focus:bg-white" rows={6} placeholder="ソースコードを入力..." value={f.code} onChange={e => updateNewFile(i, 'code', e.target.value)} />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t pt-6">
          <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-gray-600">
            <input type="checkbox" className="w-5 h-5" checked={newVisibleInChat} onChange={e => setNewVisibleInChat(e.target.checked)} />
            Chat画面の問題一覧に表示する
          </label>
          <button onClick={handleSubmit} className="bg-blue-600 text-white px-12 py-3 rounded-full font-bold shadow-lg hover:bg-blue-700 transition-all active:scale-95">
            問題を新規登録
          </button>
        </div>
      </div>

      <ProblemList
        problems={problems}
        onReorder={handleReorder}
        expandedId={expandedId}
        toggleExpand={toggleExpand}
        editTitle={editTitle}
        setEditTitle={setEditTitle}
        editDescription={editDescription}
        setEditDescription={setEditDescription}
        editSolutionCode={editSolutionCode}
        setEditSolutionCode={setEditSolutionCode}
        editSolutionFiles={editSolutionFiles}
        setEditSolutionFiles={setEditSolutionFiles}
        handleUpdate={handleUpdate}
        handleDelete={handleDelete}
        onToggleVisible={handleToggleVisible}
      />
    </main>
  )
}