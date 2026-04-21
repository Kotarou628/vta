import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

const base64Key = process.env.FIREBASE_ADMIN_KEY_BASE64;

if (!getApps().length) {
  if (base64Key) {
    try {
      const serviceAccount = JSON.parse(
        Buffer.from(base64Key, 'base64').toString('utf8')
      );
      initializeApp({
        credential: cert(serviceAccount),
      });
    } catch (e) {
      console.error("Firebase Admin initialization failed:", e);
    }
  } else {
    console.warn("Firebase Admin Key is missing. Skip initialization.");
  }
}

// 初期化されている場合のみ getFirestore() を呼び出し、
// そうでない場合（ビルド時など）は null またはダミーを返すようにします
export const db: Firestore = getApps().length > 0 
  ? getFirestore() 
  : (null as any);