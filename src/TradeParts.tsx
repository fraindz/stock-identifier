import { inr, signed } from './format'
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
