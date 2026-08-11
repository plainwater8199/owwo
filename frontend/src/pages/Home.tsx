import { Link } from 'react-router-dom'

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between px-8 py-4">
        <span className="text-xl font-semibold">owwo</span>
        <Link
          to="/login"
          className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700"
        >
          登录
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-8 py-20">
        <h1 className="text-4xl font-bold tracking-tight">多智能体协作</h1>
        <p className="mt-4 text-lg text-slate-600">
          owwo 让你登录后访问共享的 Hermes —— 一个具备持久记忆与多智能体协作能力的 AI agent。
        </p>
      </main>
    </div>
  )
}
