'use client'
import { PatchNote } from '@/data/patchNotes'

interface Props {
  patches: PatchNote[]
  onDismiss: () => void
}

export default function PatchNotesModal({ patches, onDismiss }: Props) {
  if (patches.length === 0) return null

  // Show the most recent patch prominently, older ones collapsed
  const latest = patches[patches.length - 1]
  const older  = patches.slice(0, -1)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4">
      <div className="bg-[var(--bg-card-2)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🆕</span>
            <div>
              <h2 className="text-lg font-bold text-white">What&apos;s New</h2>
              <p className="text-xs text-gray-500">{latest.title} · {latest.date}</p>
            </div>
          </div>
        </div>

        {/* Changes list */}
        <div className="px-6 py-4 overflow-y-auto flex-1">
          <ul className="space-y-3">
            {latest.changes.map((change, i) => (
              <li key={i} className="text-sm text-gray-300 leading-relaxed">
                {change}
              </li>
            ))}
          </ul>

          {older.length > 0 && (
            <div className="mt-5 pt-4 border-t border-[var(--border)]">
              <p className="text-xs text-gray-600 font-semibold uppercase tracking-wider mb-3">Previous Updates</p>
              {older.reverse().map((p) => (
                <div key={p.id} className="mb-3">
                  <p className="text-xs font-semibold text-gray-500 mb-1">{p.title} · {p.date}</p>
                  <ul className="space-y-1">
                    {p.changes.map((c, i) => (
                      <li key={i} className="text-xs text-gray-600">{c}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 pt-4 border-t border-[var(--border)]">
          <button
            onClick={onDismiss}
            className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-sm transition-colors"
          >
            Got it!
          </button>
        </div>
      </div>
    </div>
  )
}
