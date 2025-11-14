// src/lib/firebase.ts
import { initializeApp, getApps, getApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  // 既定バケット（appspot.com のほう）
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
}

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const auth = getAuth(app)

// 追加のアップロード用バケット（gs://virtualta-916ce-uploads）を明示指定
export const storage = getStorage(app, process.env.NEXT_PUBLIC_FIREBASE_UPLOADS_BUCKET)
