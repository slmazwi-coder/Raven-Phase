export function formatLastSeen(date?: string | null): string {
  if (!date) return 'last seen recently';
  const d = new Date(date);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'last seen just now';
  if (mins < 60) return `last seen ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `last seen ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `last seen ${days}d ago`;
}
