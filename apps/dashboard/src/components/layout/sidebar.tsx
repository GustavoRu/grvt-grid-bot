import Link from 'next/link';
import { LayoutDashboard, Grid3X3, Settings, Activity } from 'lucide-react';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/grids', label: 'Grids', icon: Grid3X3 },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="w-56 border-r border-border bg-card flex flex-col">
      {/* Logo */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <span className="font-semibold text-sm">GRVT Grid Bot</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>

      {/* Environment badge */}
      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-yellow-500" />
          <span className="text-xs text-muted-foreground">Testnet</span>
        </div>
      </div>
    </aside>
  );
}
