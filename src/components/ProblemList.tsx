'use client'

import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

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
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: problem.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="border p-4 rounded bg-gray-100"
    >
      <button
        onClick={() => toggleExpand(problem)}
        className="text-left w-full font-semibold text-lg text-blue-800 hover:underline"
      >
        {problem.title}
      </button>

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

  const handleDragEnd = (event: any) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = props.problems.findIndex((p) => p.id === active.id)
    const newIndex = props.problems.findIndex((p) => p.id === over.id)
    const newList = arrayMove(props.problems, oldIndex, newIndex)
    props.onReorder(newList)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={props.problems.map((p) => p.id)} strategy={verticalListSortingStrategy}>
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
