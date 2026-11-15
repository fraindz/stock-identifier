import { formatDay, inr, signed } from './format'
import { ACTION_LABEL, MODE_LABEL, type Action } from './tracking'
import type { MarketRegime } from './types'

const REGIME_LABELS = { 'risk-on': 'Risk-on', caution: 'Caution', 'risk-off': 'Risk-off' }

export function RegimeBanner({ regime }: { regime: MarketRegime }) {
  return (
    <section className={`regime regime-${regime.regime}`} aria-label="Market regime">
      <strong>Market: {REGIME_LABELS[regime.regime]}</strong>
      <span>
        Nifty {inr.format(regime.niftyClose)} · {signed(regime.niftyVs50Pct, 1)}% vs 50-DMA{regime.sma50Rising ? ' (rising)' : ''} ·{' '}
        {signed(regime.niftyVs200Pct, 1)}% vs 200-DMA · {regime.breadthPct.toFixed(0)}% of stocks above 50-DMA
      </span>
      <span className="regime-note">{regime.note}</span>
    </section>
  )
}

export function OrdersList({ actions, date, showMode = true }: { actions: Action[]; date: string; showMode?: boolean }) {
  return (
    <section aria-label="Orders today">
      <h2>Orders for {formatDay(date)}</h2>
      {actions.length ? (
        <ul className="criteria action-list">
          {actions.map(({ t, kind, text }) => (
            <li key={`${t.id}-${kind}`} className={`action-${kind}`}>
              <strong>{t.symbol}</strong>{' '}
              <span className="muted">
                {showMode ? `${MODE_LABEL[t.mode]} · ` : ''}
                {t.grade}
              </span>{' '}
              · {ACTION_LABEL[kind]}: {text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="meta">No changes today. Pending orders and stops stay as they are.</p>
      )}
    </section>
  )
}
