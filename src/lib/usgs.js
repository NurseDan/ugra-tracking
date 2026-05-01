export async function fetchUSGSGauges(ids) {
  const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${ids.join(',')}&parameterCd=00065,00060&period=PT2H`
  const res = await fetch(url)
  const json = await res.json()

  const result = {}

  json.value.timeSeries.forEach(ts => {
    const site = ts.sourceInfo.siteCode[0].value
    const param = ts.variable.variableCode[0].value
    const latest = ts.values[0].value.slice(-1)[0]

    if (!result[site]) result[site] = {}

    if (param === '00065') result[site].height = Number(latest.value)
    if (param === '00060') result[site].flow = Number(latest.value)

    result[site].time = latest.dateTime
  })

  return result
}
