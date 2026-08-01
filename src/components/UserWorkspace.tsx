import { BriefcaseBusiness } from 'lucide-react';

export default function UserWorkspace() {
  return (
    <div className="flex flex-col items-center justify-center h-full bg-[var(--surface)] rounded-lg border border-[var(--border)] text-[var(--text-soft)] text-sm gap-2" style={{ boxShadow: 'var(--shadow-sm)' }}>
      <BriefcaseBusiness className="w-10 h-10 text-[var(--ink-300)]" />
      <h1 className="text-lg font-semibold text-[var(--text)]">User Workspace</h1>
      <p>Under construction.</p>
    </div>
  );
}
