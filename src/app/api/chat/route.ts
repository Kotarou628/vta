// src/app/api/chat/route.ts
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { message } = await req.json()

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'OpenAI APIキーが未設定です' }, { status: 500 })
  }

  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: message }],
    }),
  })

  const data = await openaiRes.json()
  const reply = data.choices?.[0]?.message?.content ?? '応答が取得できませんでした'

  return NextResponse.json({ reply })
}
// このコードは、OpenAIのAPIを使用してチャット応答を生成するためのエンドポイントを定義しています。
// POSTリクエストを受け取り、リクエストボディからメッセージを取得します。
// OpenAIのAPIキーが設定されていない場合はエラーレスポンスを返します。
// OpenAIのAPIにリクエストを送り、応答を取得します。