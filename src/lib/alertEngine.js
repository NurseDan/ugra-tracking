export function calculateRates(history, now) {
  function delta(minutes) {
    const past = history.find(h => (now - new Date(h.time)) / 60000 >= minutes)
    if (!past) return 0
    return now.height - past.height
  }

  return {
    rise5m: delta(5),
    rise15m: delta(15),
    rise60m: delta(60)
  }
}

export function getAlertLevel(rise60m, rise15m) {
  if (rise60m > 10) return 'BLACK'
  if (rise60m > 5) return 'RED'
  if (rise60m > 2 || rise15m > 1.5) return 'ORANGE'
  if (rise15m > 0.5) return 'YELLOW'
  return 'GREEN'
}
