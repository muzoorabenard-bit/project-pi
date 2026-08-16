import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Today from '@/pages/Today'
import History from '@/pages/History'

const queryClient = new QueryClient()

function Nav() {
  const base = 'px-4 py-2 text-sm font-medium rounded-lg transition-colors'
  const active = `${base} bg-slate-800 text-white`
  const inactive = `${base} text-slate-600 hover:text-slate-900`
  return (
    <nav className="border-b border-slate-200 bg-white sticky top-0 z-10">
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link to="/" className="font-bold text-slate-900 tracking-tight">⚽ Project Pi</Link>
        <div className="flex gap-1">
          <NavLink to="/" end className={({ isActive }) => isActive ? active : inactive}>Today</NavLink>
          <NavLink to="/history" className={({ isActive }) => isActive ? active : inactive}>History</NavLink>
        </div>
      </div>
    </nav>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="min-h-screen bg-slate-50">
          <Nav />
          <Routes>
            <Route path="/" element={<Today />} />
            <Route path="/history" element={<History />} />
          </Routes>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
