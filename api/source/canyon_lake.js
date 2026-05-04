const INVALID_VALUE_FLOOR = -900000

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > INVALID_VALUE_FLOOR ? n : null
}

function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const USGS = (id) => `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${id}&parameterCd=00060&period=PT6H&siteStatus=all`
  async function getFlow(id) {
    try {
      const r = await fetch(USGS(id))
      if (!r.ok) return null
      const j = await r.json()
      const vals = j?.value?.timeSeries?.[0]?.values?.[0]?.value || []
      if (!vals.length) return null
      const latest = vals.sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime)).at(-1)
      const n = num(latest?.value)
      return n === null ? null : { cfs: n, time: latest.dateTime }
    } catch { return null }
  }

  async function getTwdb() {
    try {
      const r = await fetch('https://www.waterdatafortexas.org/reservoirs/individual/canyon.csv')
      if (!r.ok) return null
      const text = await r.text()
      const lines = text.split(/\r?\n/).filter(l => l && !l.startsWith('#'))
      if (lines.length < 2) return null
      const header = parseCsvLine(lines[0]).map(s => s.trim())
      const last = parseCsvLine(lines.at(-1))
      const row = {}
      header.forEach((h, i) => { row[h] = last[i] })
      return {
        timestamp: row.date || row.timestamp || null,
        elevationFt: num(row.water_level) ?? num(row.elevation),
        volumeAcreFt: num(row.reservoir_storage) ?? num(row.volume),
        percentFull: num(row.percent_full)
      }
    } catch { return null }
  }

  try {
    const [release, inflow, twdb] = await Promise.all([
      getFlow('08167900'),
      getFlow('08167500'),
      getTwdb()
    ])

    res.status(200).json({
      name: 'Canyon Lake',
      poolElevationFt: twdb?.elevationFt ?? null,
      percentFull: twdb?.percentFull ?? null,
      volumeAcreFt: twdb?.volumeAcreFt ?? null,
      conservationPoolElevationFt: 909,
      floodPoolElevationFt: 943,
      releaseCfs: release?.cfs ?? null,
      releaseTime: release?.time ?? null,
      inflowCfs: inflow?.cfs ?? null,
      inflowTime: inflow?.time ?? null,
      updated: new Date().toISOString()
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
