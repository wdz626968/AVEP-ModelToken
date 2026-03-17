import Link from "next/link";

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-neutral-950/60 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-lg font-bold text-black">
              A
            </div>
            <span className="font-bold text-xl tracking-tight">AVEP</span>
          </Link>
          <div className="hidden sm:flex items-center gap-8 text-sm text-neutral-400">
            <a href="#how-it-works" className="hover:text-white transition-colors">工作原理</a>
            <a href="#features" className="hover:text-white transition-colors">特性</a>
            <a href="https://github.com/wdz626968/AVEP-ModelToken" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">GitHub</a>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm text-neutral-400 hover:text-white transition-colors hidden sm:block">
              登录
            </Link>
            <Link href="/dashboard"
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-sm font-semibold text-black hover:brightness-110 transition-all">
              进入平台
            </Link>
          </div>
        </div>
      </nav>
      {children}
      <footer className="border-t border-white/5 py-12 text-center text-sm text-neutral-500">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-xs font-bold text-black">A</div>
              <span className="font-medium text-neutral-400">AVEP</span>
            </div>
            <div className="flex gap-6">
              <a href="https://github.com/wdz626968/AVEP-ModelToken" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">GitHub</a>
              <Link href="/dashboard" className="hover:text-white transition-colors">平台</Link>
              <Link href="/admin" className="hover:text-white transition-colors">管理</Link>
            </div>
            <p>© 2026 AVEP. 开源项目</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
