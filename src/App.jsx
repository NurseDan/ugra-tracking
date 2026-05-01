import { useEffect, useState } from 'react'

const GAUGES = [
  { id: '08165300', name: 'North Fork near Hunt' },
  { id: '08165500', name: 'Guadalupe at Hunt' },
  { id: '08166140', name: 'Above Kerrville' },
  { id: '08166200', name: 'Kerrville' },
  { id: '08166250', name: 'Center Point' },
  { id: '08167000', name: 'Comfort' }
]

export default function App() {
  const [data, setData] = useState([])

  useEffect(() => {
    fetchData()
    const i = setInterval(fetchData, 60000)
    return () => clearInterval(i)
  }, [])

  async function fetchData() {
    const ids = GAUGES.map(g => g.id).join(',')
    const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${ids}&parameterCd=00065,00060&period=PT2H`
    const res = await fetch(url)
    const json = await res.json()

    const parsed = json.value.timeSeries.map(ts => ({
      id: ts.sourceInfo.siteCode[0].value,
      value: ts.values[0].value.slice(-1)[0].value,
      time: ts.values[0].value.slice(-1)[0].dateTime
    }))

    setData(parsed)
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Guadalupe Sentinel</h1>
      {GAUGES.map(g => {
        const d = data.find(x => x.id === g.id)
        return (
          <div key={g.id} style={{ marginBottom: 10, border: '1px solid #ccc', padding: 10 }}>
            <strong>{g.name}</strong>
            <div>Level: {d?.value || '—'}</div>
            <div>Updated: {d?.time || '—'}</div>
          </div>
        )
      })}
    </div>
  )
}
