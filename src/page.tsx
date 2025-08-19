// src/app/page.tsx
export default function Home() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">Welcome to VTA</h1>
      <p><a href="/chat" className="text-blue-500 underline">Go to Chat</a></p>
      <p><a href="/problem" className="text-blue-500 underline">Go to Problem Management</a></p>
    </main>
  )
}
//dev