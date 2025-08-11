// src/app/api/chat/route.ts
import { NextRequest } from 'next/server'

export const runtime = 'edge' // Edge Functions を有効にする

export async function POST(req: NextRequest) {
  const { message } = await req.json()

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return new Response('OpenAI APIキーが未設定です', { status: 500 })
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      stream: true,
      messages: [
        { role: 'system', content: 'あなたは学習者に思考を促す質問を投げかけるプロのプログラミング教員です。' },
        { role: 'user', content: message },
      ],
    }),
  })

  return new Response(response.body, {
    headers: {
      'Content-Type': 'text/event-stream',
    },
  })
}
