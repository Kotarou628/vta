'use client'

import { useState } from 'react'

export default function ChatPage() {
  const [input, setInput] = useState('')
  const [response, setResponse] = useState('')

  const handleSend = async () => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: input }),
    })
    const data = await res.json()
    setResponse(data.reply)
  }

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold">Chat</h1>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="w-full border p-2"
        rows={4}
      />
      <button onClick={handleSend} className="mt-2 px-4 py-2 bg-blue-500 text-white rounded">
        送信
      </button>
        {response && (
        <div className="mt-4 p-2 border rounded bg-gray-100">
            <strong>AIの応答:</strong>
            <pre className="mt-2 whitespace-pre-wrap">{response}</pre>
        </div>
        )}
    </div>
  )
}
// このコードは、ユーザーが入力したメッセージをOpenAIのAPIに送信し、AIからの応答を表示するシンプルなチャットインターフェースを提供します。
// ユーザーがメッセージを入力し、送信ボタンをクリックすると、APIにリクエストが送信され、AIの応答が取得されて表示されます。
// スタイルはTailwind CSSを使用しており、シンプルで使いやすいデザインになっています。
//// このコードは、Next.jsのクライアントコンポーネントとして実装されており、状態管理にはReactのuseStateフックを使用しています。
// ユーザーが入力したメッセージを保持するための状態と、AIからの応答を保持するための状態を定義しています。
// ユーザーがメッセージを入力し、送信ボタンをクリックすると、handleSend関数が呼び出されます。
// この関数は、APIエンドポイントにPOSTリクエストを送り、