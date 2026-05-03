import { ArrowDownRight, ArrowUpRight, Droplet, Minus, RefreshCw } from 'lucide-react'
import { useReservoirStatus } from '../lib/useReservoirStatus.js'
import { useSentinel } from '../contexts/SentinelContext.jsx'
import { formatCDT } from '../lib/formatTime.js'
import './ReservoirCard.css'

function formatNumber(value, { digits = 0, suffix = '' } = {}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}${suffix}`
}

function elevationToPercent(value, min, max) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return null
  }
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
}

function FlowDelta({ release, inflow }) {
  if (!Number.isFinite(release) || !Number.isFinite(inflow)) {
    return (
      <span className="reservoir-flow__arrow" title="Insufficient data">
        <Minus size={14} /> —
      </span>
    )
  }
  const delta = inflow - release
  if (Math.abs(delta) < 25) {
    return (
      <span className="reservoir-flow__arrow" title="Inflow ≈ release">
        <Minus size={14} /> Steady
      </span>
    )
  }
  if (delta > 0) {
    return (
      <span
        className="reservoir-flow__arrow reservoir-flow__arrow--rising"
        title="Inflow exceeds release — lake is rising"
      >
        <ArrowUpRight size={14} /> Rising
      </span>
    )
  }
  return (
    <span
      className="reservoir-flow__arrow reservoir-flow__arrow--falling"
      title="Release exceeds inflow — lake is falling"
    >
      <ArrowDownRight size={14} /> Falling
    </span>
  )
}

function Skeleton() {
  return (
    <div className="reservoir-skeleton" aria-busy="true" aria-label="Loading reservoir status">
      <div className="reservoir-skeleton__bar" style={{ width: '60%' }} />
      <div className="reservoir-skeleton__bar reservoir-skeleton__bar--lg" />
      <div className="reservoir-skeleton__bar" style={{ width: '90%' }} />
      <div className="reservoir-skeleton__bar" style={{ width: '75%' }} />
    </div>
  )
}

const STALE_AFTER_MS = 30 * 60 * 1000

export default function ReservoirCard({ className = '' } = {}) {
  const ctx = useSentinel()
  const status = ctx.reservoirStatus
  const loading = ctx.reservoirLoading
  const error = ctx.reservoirError
  const lastUpdated = ctx.reservoirLastUpdated
  const refresh = ctx.refreshReservoir

  const isInitialLoading = loading && !status
  const hasData = !!status
  const lastUpdatedMs = lastUpdated ? new Date(lastUpdated).getTime() : null
  const isStale =
    !!error ||
    (lastUpdatedMs !== null && Date.now() - lastUpdatedMs > STALE_AFTER_MS)

  let elevPct = null
  if (status) {
    const min = status.deadPoolElevationFt ?? 800
    const max = status.floodPoolElevationFt ?? 943
    elevPct = elevationToPercent(status.poolElevationFt, min, max)
  }

  const consElev = status?.conservationPoolElevationFt
  const floodElev = status?.floodPoolElevationFt
  const deadElev = status?.deadPoolElevationFt ?? 800

  const consLinePct =
    Number.isFinite(consElev) && Number.isFinite(floodElev) && floodElev > deadElev
      ? ((consElev - deadElev) / (floodElev - deadElev)) * 100
      : null
  const floodLinePct = 100

  const partial =
    status &&
    (!status.sources?.twdb || !status.sources?.release || !status.sources?.inflow)

  return (
    <section className={`reservoir-card ${className}`.trim()} aria-label="Canyon Lake reservoir status">
      <header className="reservoir-card__header">
        <div>
          <div className="reservoir-card__title">
            <Droplet size={16} aria-hidden="true" />
            {status?.name || 'Canyon Lake'}
          </div>
          <div className="reservoir-card__subtitle">Reservoir status</div>
        </div>
        {error && !hasData ? (
          <span className="reservoir-card__pill reservoir-card__pill--err" title={error}>
            Offline
          </span>
        ) : isStale && hasData ? (
          <span
            className="reservoir-card__pill reservoir-card__pill--warn"
            title={
              error
                ? `Last refresh failed — showing cached values. ${error}`
                : 'Data has not refreshed recently — showing cached values.'
            }
          >
            Stale
          </span>
        ) : partial ? (
          <span
            className="reservoir-card__pill reservoir-card__pill--warn"
            title={status?.warnings?.join(' · ') || 'Some sources unavailable'}
          >
            Partial data
          </span>
        ) : hasData ? (
          <span className="reservoir-card__pill" title="All sources reporting">
            Live
          </span>
        ) : null}
      </header>

      {isInitialLoading ? (
        <Skeleton />
      ) : !hasData ? (
        <div className="reservoir-empty">
          Reservoir data is temporarily unavailable.
          {error ? <div style={{ marginTop: 6, opacity: 0.8 }}>{error}</div> : null}
        </div>
      ) : (
        <>
          <div className="reservoir-card__body">
            <div
              className="reservoir-elev"
              role="img"
              aria-label={`Pool elevation ${formatNumber(status.poolElevationFt, {
                digits: 1,
                suffix: ' ft'
              })}`}
            >
              <div
                className="reservoir-elev__fill"
                style={{ height: `${elevPct ?? 0}%` }}
              />
              {consLinePct !== null ? (
                <div
                  className="reservoir-elev__line reservoir-elev__line--cons"
                  style={{ bottom: `${consLinePct}%` }}
                  title={`Conservation pool ${consElev} ft`}
                >
                  <span>Cons</span>
                </div>
              ) : null}
              <div
                className="reservoir-elev__line reservoir-elev__line--flood"
                style={{ bottom: `${floodLinePct}%` }}
                title={`Flood pool ${floodElev} ft`}
              >
                <span>Flood</span>
              </div>
            </div>

            <div className="reservoir-stats">
              <div className="reservoir-stat">
                <span className="reservoir-stat__label">Pool elevation</span>
                <span className="reservoir-stat__value">
                  {formatNumber(status.poolElevationFt, { digits: 1, suffix: ' ft' })}
                </span>
                <span className="reservoir-stat__sub">
                  Cons {formatNumber(consElev, { digits: 0, suffix: ' ft' })} · Flood{' '}
                  {formatNumber(floodElev, { digits: 0, suffix: ' ft' })}
                </span>
              </div>

              <div className="reservoir-stat">
                <span className="reservoir-stat__label">Storage</span>
                <span className="reservoir-stat__value">
                  {formatNumber(status.volumeAcreFt, { digits: 0 })}
                </span>
                <span className="reservoir-stat__sub">acre-ft</span>
              </div>

              <div className="reservoir-pctbar">
                <div className="reservoir-pctbar__row">
                  <span>Conservation pool</span>
                  <span>
                    {formatNumber(status.percentFull, { digits: 1, suffix: '%' })} full
                  </span>
                </div>
                <div className="reservoir-pctbar__track" aria-hidden="true">
                  <div
                    className="reservoir-pctbar__fill"
                    style={{
                      width: Number.isFinite(status.percentFull)
                        ? `${Math.max(0, Math.min(100, status.percentFull))}%`
                        : '0%'
                    }}
                  />
                </div>
                <div className="reservoir-pctbar__row">
                  <span>0</span>
                  <span>
                    Capacity{' '}
                    {formatNumber(status.conservationCapacity, { digits: 0, suffix: ' AF' })}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="reservoir-flow">
            <div className="reservoir-flow__cell">
              <span className="reservoir-flow__label">Inflow</span>
              <span className="reservoir-flow__value">
                {formatNumber(status.inflowCfs, { digits: 0, suffix: ' cfs' })}
              </span>
            </div>
            <FlowDelta release={status.releaseCfs} inflow={status.inflowCfs} />
            <div className="reservoir-flow__cell" style={{ textAlign: 'right' }}>
              <span className="reservoir-flow__label">Release</span>
              <span className="reservoir-flow__value">
                {formatNumber(status.releaseCfs, { digits: 0, suffix: ' cfs' })}
              </span>
            </div>
          </div>
        </>
      )}

      <footer className="reservoir-card__footer">
        <span title={status?.updated ? new Date(status.updated).toString() : ''}>
          Updated {status?.updated ? formatCDT(status.updated) : '—'}
        </span>
        <button
          className="reservoir-card__refresh"
          onClick={refresh}
          disabled={loading}
          title="Refresh reservoir data"
        >
          <RefreshCw
            size={11}
            style={{
              marginRight: 4,
              verticalAlign: 'middle',
              animation: loading ? 'spin 1s linear infinite' : 'none'
            }}
          />
          {loading ? 'Refreshing' : 'Refresh'}
        </button>
      </footer>
    </section>
  )
}

export { ReservoirCard }
