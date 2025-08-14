//C:\Users\Admin\vta\src\components\ProblemList.tsx
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
import type { CSSProperties } from 'react'

/** 型定義 */
type Problem = {
  id: string
  title: string
  description: string
  solution_code: string
  order?: number
}

interface ProblemListProps {
  problems: Problem[]
  onReorder: (newList: Problem[]) => void
  expandedId: string | null
  toggleExpand: (problem: Problem) => void
  editTitle: string
  setEditTitle: (value: string) => void
  editDescription: string
  setEditDescription: (value: string) => void
  editSolutionCode: string
  setEditSolutionCode: (value: string) => void
  handleUpdate: (id: string) => void
  handleDelete: (id: string) => void
}

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
  handleUpdate,
  handleDelete,
}: {
  problem: Problem
  expandedId: string | null
  toggleExpand: (problem: Problem) => void
  editTitle: string
  setEditTitle: (value: string) => void
  editDescription: string
  setEditDescription: (value: string) => void
  editSolutionCode: string
  setEditSolutionCode: (value: string) => void
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

  return (
    <li ref={setNodeRef} style={style} className="border p-4 rounded bg-gray-100">
      <div onClick={() => toggleExpand(problem)} className="cursor-pointer">
        <div className="flex justify-between items-center">
          <span className="font-semibold text-lg text-blue-800">{problem.title}</span>
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
          />
          <textarea
            className="w-full border p-2"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
          />
          <textarea
            className="w-full border p-2"
            value={editSolutionCode}
            onChange={(e) => setEditSolutionCode(e.target.value)}
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

export default function ProblemList(props: ProblemListProps) {
  const sensors = useSensors(useSensor(PointerSensor))

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return

    const activeId = String(active.id)
    const overId = String(over.id)
    if (activeId === overId) return

    const oldIndex = props.problems.findIndex((p) => p.id === activeId)
    const newIndex = props.problems.findIndex((p) => p.id === overId)
    if (oldIndex === -1 || newIndex === -1) return

    const newList = arrayMove(props.problems, oldIndex, newIndex)
    props.onReorder(newList)
  }

  const items: UniqueIdentifier[] = props.problems.map((p) => p.id)

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <ul className="space-y-4">
          {props.problems.map((p) => (
            <SortableItem
              key={p.id}
              problem={p}
              expandedId={props.expandedId}
              toggleExpand={props.toggleExpand}
              editTitle={props.editTitle}
              setEditTitle={props.setEditTitle}
              editDescription={props.editDescription}
              setEditDescription={props.setEditDescription}
              editSolutionCode={props.editSolutionCode}
              setEditSolutionCode={props.setEditSolutionCode}
              handleUpdate={props.handleUpdate}
              handleDelete={props.handleDelete}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}
