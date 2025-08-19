// src/lib/firebase.ts
import { initializeApp, getApps, getApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  // 必要に応じて追加
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig)
export const firestore = getFirestore(app)
export const db = getFirestore(app);