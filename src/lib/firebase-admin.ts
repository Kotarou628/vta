import { cert, getApps, initializeApp, App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

let app: App;

// 環境変数があるかチェック
const base64Key = process.env.FIREBASE_ADMIN_KEY_BASE64;

if (!getApps().length) {
  if (base64Key) {
    // 環境変数がある場合のみ初期化を実行
    const serviceAccount = JSON.parse(
      Buffer.from(base64Key, 'base64').toString('utf8')
    );
    app = initializeApp({
      credential: cert(serviceAccount),
    });
  } else {
    // ビルド時など、キーがない場合は警告を出す（または何もしない）
    console.warn("Firebase Admin Key is missing. Skip initialization.");
  }
}

export const db = getFirestore();