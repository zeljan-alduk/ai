'use client';

/**
 * Wave-14C — "Take the tour" trigger. Pure client component; fires
 * the same `aldo:tour:start` window event the user-menu link fires.
 */

export function TakeTourLink({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={className ?? 'font-semibold underline text-blue-900 hover:text-blue-700'}
      onClick={() => window.dispatchEvent(new CustomEvent('aldo:tour:start'))}
    >
      Take the 60-second tour →
    </button>
  );
}
