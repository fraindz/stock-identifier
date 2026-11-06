type Props = {
  onRefresh: () => void
  refreshing: boolean
}

export default function RefreshButton({ onRefresh, refreshing }: Props) {
  return (
    <button className="refresh-button" type="button" onClick={onRefresh} disabled={refreshing}>
      {refreshing ? 'Refreshing…' : 'Refresh'}
    </button>
  )
}
