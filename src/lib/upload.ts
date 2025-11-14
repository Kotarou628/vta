//C:\Users\Admin\vta\src\lib\upload.ts
// アップロード + Firestoreにメタデータ保存（戻り値は保存したドキュメントID）
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { storage, db } from './firebase'
import { getAuth } from 'firebase/auth'

export type SubmissionMeta = {
  uid: string
  problemId: string
  classCode?: string
  seatNumber?: string
  fileName: string
  contentType: string | null
  size: number
  path: string
  downloadURL: string
  createdAt: any // Firestore Timestamp
}

export async function uploadSubmission(
  file: File,
  opts: {
    problemId: string
    classCode?: string
    seatNumber?: string
  }
) {
  const auth = getAuth()
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error('Not signed in')

  // 例: uploads/{class}/{problemId}/{uid}/{ts}-{name}
  const ts = Date.now()
  const safeName = file.name.replace(/[^\w.\-]+/g, '_')
  const classPart = opts.classCode ?? 'unknown'
  const path = `uploads/${classPart}/${opts.problemId}/${uid}/${ts}-${safeName}`

  const fileRef = ref(storage, path)
  const task = uploadBytesResumable(fileRef, file)

  await new Promise<void>((resolve, reject) => {
    task.on('state_changed', undefined, reject, () => resolve())
  })

  const downloadURL = await getDownloadURL(fileRef)

  // Firestoreにメタデータを保存
  const docRef = await addDoc(collection(db, 'submissions'), {
    uid,
    problemId: opts.problemId,
    classCode: opts.classCode ?? null,
    seatNumber: opts.seatNumber ?? null,
    fileName: file.name,
    contentType: file.type || null,
    size: file.size,
    path,
    downloadURL,
    createdAt: serverTimestamp(),
  } as SubmissionMeta)

  return docRef.id
}
