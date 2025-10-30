'use client'

import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useCallback, type DragEvent, type ChangeEvent, type CSSProperties, type Dispatch, type SetStateAction } from 'react'

import type { Problem as ProblemType, SolutionFile } from '@/types/problem'

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
    return { filename: f.name, language: inferLanguage(f.name), code } as SolutionFile
  })
  return Promise.all(tasks)
}

interface ProblemListProps {
  problems: ProblemType[]
  onReorder: (newList: ProblemType[]) => void
  expandedId: string | null
  toggleExpand: (problem: ProblemType) => void

  // 既存編集用
  editTitle: string
  setEditTitle: (value: string) => void
  editDescription: string
  setEditDescription: (value: string) => void
  editSolutionCode: string
  setEditSolutionCode: (value: string) => void

  // 複数ファイル編集用（← ここを React の Setter 型に変更）
  editSolutionFiles: SolutionFile[]
  setEditSolutionFiles: Dispatch<SetStateAction<SolutionFile[]>>

  handleUpdate: (id: string) => void
  handleDelete: (id: string) => void
}

/* ------- 並べ替え1件分 ------- */
function SortableItem({
  problem,
  expandedId,
  toggleExpand,
  editTitle,
  setEditTitle,
  editDescription,
  setEditDescription,
  editSolutionCode,
  setEditSolutionCode,
  editSolutionFiles,
  setEditSolutionFiles,
  handleUpdate,
  handleDelete,
}: {
  problem: ProblemType
  expandedId: string | null
  toggleExpand: (problem: ProblemType) => void
  editTitle: string
  setEditTitle: (value: string) => void
  editDescription: string
  setEditDescription: (value: string) => void
  editSolutionCode: string
  setEditSolutionCode: (value: string) => void
  editSolutionFiles: SolutionFile[]
  setEditSolutionFiles: Dispatch<SetStateAction<SolutionFile[]>>
  handleUpdate: (id: string) => void
  handleDelete: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: problem.id as UniqueIdentifier,
  })

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const safeFiles = Array.isArray(editSolutionFiles) ? editSolutionFiles : []
  const updateFile = (i: number, field: keyof SolutionFile, value: string) => {
    setEditSolutionFiles((prev: SolutionFile[]) => {
      const list = [...(Array.isArray(prev) ? prev : [])]
      list[i] = { ...list[i], [field]: value }
      return list
    })
  }
  const addFile = () =>
    setEditSolutionFiles((prev: SolutionFile[]) => [
      ...(Array.isArray(prev) ? prev : []),
      { filename: '', language: '', code: '' },
    ])
  const removeFile = (i: number) =>
    setEditSolutionFiles((prev: SolutionFile[]) => {
      const list = [...(Array.isArray(prev) ? prev : [])]
      list.splice(i, 1)
      return list.length ? list : [{ filename: '', language: '', code: '' }]
    })

  // === 編集フォームへのドラッグ＆ドロップ ===
  const preventDefault = (e: DragEvent) => { e.preventDefault(); e.stopPropagation() }

  const handleDropEdit = useCallback(async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const dtFiles = Array.from(e.dataTransfer.files || [])
    if (dtFiles.length === 0) return
    const sf = await filesToSolutionFiles(dtFiles)
    setEditSolutionFiles((prev: SolutionFile[]) => {
      const base = (Array.isArray(prev) ? prev : []).filter(f => f?.filename || f?.code)
      return [...base, ...sf]
    })
  }, [setEditSolutionFiles])

  const handleSelectEdit = async (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList || fileList.length === 0) return
    const sf = await filesToSolutionFiles(Array.from(fileList))
    setEditSolutionFiles((prev: SolutionFile[]) => {
      const base = (Array.isArray(prev) ? prev : []).filter(f => f?.filename || f?.code)
      return [...base, ...sf]
    })
    e.target.value = ''
  }

  const fileBadge =
    (problem.solution_files && problem.solution_files.length > 0)
      ? `${problem.solution_files.length} file(s)`
      : (problem.solution_code ? '1 file (legacy)' : 'no answer')

  return (
    <li ref={setNodeRef} style={style} className="border p-4 rounded bg-gray-100">
      <div onClick={() => toggleExpand(problem)} className="cursor-pointer">
        <div className="flex justify-between items-center">
          <div className="flex flex-col">
            <span className="font-semibold text-lg text-blue-800">{problem.title}</span>
            <span className="text-xs text-gray-500">{fileBadge}</span>
          </div>
          <span
            {...attributes}
            {...listeners}
            className="cursor-move text-gray-500"
            title="ドラッグで並び替え"
          >
            ☰
          </span>
        </div>
      </div>

      {expandedId === problem.id && (
        <div className="mt-2 space-y-2">
          <input
            className="w-full border p-2"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="タイトル"
          />
          <textarea
            className="w-full border p-2"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder="説明"
          />

          {/* ★ ドラッグ＆ドロップでファイル追加（編集） */}
          <div
            className="space-y-2 border-2 border-dashed rounded p-3 bg-white"
            onDragOver={preventDefault}
            onDragEnter={preventDefault}
            onDrop={handleDropEdit}
          >
            <div className="font-semibold">解答ファイル（複数可）</div>
            <div className="text-xs text-gray-600 text-center">
              ここに模範解答ファイルをドラッグ＆ドロップ（複数可）
              <div className="mt-1">
                <label className="cursor-pointer underline">
                  クリックしてファイルを選択
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    accept=".java,.c,.cpp,.cc,.cxx,.py,.js,.ts,.kt,.swift,.rb,.go,.txt"
                    onChange={handleSelectEdit}
                  />
                </label>
              </div>
            </div>

            {safeFiles.map((f, i) => (
              <div key={i} className="border rounded p-2 space-y-2">
                <div className="flex gap-2">
                  <input
                    className="flex-1 border p-2"
                    placeholder="ファイル名（例: Main.java / main.c）"
                    value={f.filename}
                    onChange={(e) => updateFile(i, 'filename', e.target.value)}
                  />
                  <select
                    className="w-40 border p-2"
                    value={f.language ?? ''}
                    onChange={(e) => updateFile(i, 'language', e.target.value)}
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
                    onClick={() => removeFile(i)}
                    title="このファイルを削除"
                  >
                    削除
                  </button>
                </div>
                <textarea
                  className="w-full border p-2"
                  rows={8}
                  placeholder="このファイルの解答コード"
                  value={f.code}
                  onChange={(e) => updateFile(i, 'code', e.target.value)}
                />
              </div>
            ))}
            <button type="button" className="border px-3 py-1 rounded" onClick={addFile}>
              ＋ ファイルを追加
            </button>
          </div>

          {/* 既存：単一ファイルの互換入力欄（残す） */}
          <textarea
            className="w-full border p-2"
            value={editSolutionCode}
            onChange={(e) => setEditSolutionCode(e.target.value)}
            placeholder="（互換）単一ファイルの解答コード"
          />

          <div className="space-x-2">
            <button
              onClick={() => handleUpdate(problem.id)}
              className="bg-green-600 text-white px-4 py-1 rounded"
            >
              更新
            </button>
            <button
              onClick={() => handleDelete(problem.id)}
              className="text-red-600 hover:underline"
            >
              削除
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

/* ------- リスト本体 ------- */
export default function ProblemList(props: ProblemListProps) {
  const sensors = useSensors(useSensor(PointerSensor))

  const problems = Array.isArray(props?.problems) ? props.problems : []
  const onReorder =
    typeof props?.onReorder === 'function' ? props.onReorder : () => {}
  const expandedId = props?.expandedId ?? null
  const toggleExpand =
    typeof props?.toggleExpand === 'function' ? props.toggleExpand : () => {}

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return

    const activeId = String(active.id)
    const overId = String(over.id)
    if (activeId === overId) return

    const oldIndex = problems.findIndex((p) => p.id === activeId)
    const newIndex = problems.findIndex((p) => p.id === overId)
    if (oldIndex === -1 || newIndex === -1) return

    const newList = arrayMove(problems, oldIndex, newIndex)
    onReorder(newList)
  }

  const items: UniqueIdentifier[] = problems.map((p) => p.id)

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <ul className="space-y-4">
          {problems.map((p) => (
            <SortableItem
              key={p.id}
              problem={p}
              expandedId={expandedId}
              toggleExpand={toggleExpand}
              editTitle={props.editTitle}
              setEditTitle={props.setEditTitle}
              editDescription={props.editDescription}
              setEditDescription={props.setEditDescription}
              editSolutionCode={props.editSolutionCode}
              setEditSolutionCode={props.setEditSolutionCode}
              editSolutionFiles={props.editSolutionFiles ?? []}
              setEditSolutionFiles={props.setEditSolutionFiles}
              handleUpdate={props.handleUpdate}
              handleDelete={props.handleDelete}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}
