import synaptic from 'synaptic'
import { query } from './db.js'
import { GAUGES } from '../src/config/gauges.js'

const { Architect, Trainer } = synaptic
const LSTMs = {}

// Format data for time-series: 
// input: [t-4 height, t-4 flow, t-3 height, t-3 flow, t-2 height, t-2 flow, t-1 height, t-1 flow]
// output: [t height]
const WINDOW_SIZE = 4

function normalize(val, max) {
  return Math.min(Math.max(val / max, 0), 1)
}
function denormalize(val, max) {
  return val * max
}

export async function trainGaugeModels() {
  console.log('[ml-engine] Starting daily LSTM training...')
  
  for (const gauge of GAUGES) {
    const res = await query(
      `SELECT height_ft, flow_cfs FROM gauge_readings 
       WHERE gauge_id = $1 AND height_ft IS NOT NULL 
       ORDER BY observed_at ASC LIMIT 1000`, 
       [gauge.id]
    )
    
    if (res.rows.length < 50) continue // Need enough data to train

    // Find max values for normalization
    const maxHeight = Math.max(...res.rows.map(r => r.height_ft || 0.1)) * 1.5
    const maxFlow = Math.max(...res.rows.map(r => r.flow_cfs || 0.1)) * 1.5

    const trainingSet = []
    
    // Build sliding window
    for (let i = WINDOW_SIZE; i < res.rows.length; i++) {
      const input = []
      for (let j = i - WINDOW_SIZE; j < i; j++) {
        input.push(normalize(res.rows[j].height_ft || 0, maxHeight))
        input.push(normalize(res.rows[j].flow_cfs || 0, maxFlow))
      }
      const output = [normalize(res.rows[i].height_ft || 0, maxHeight)]
      trainingSet.push({ input, output })
    }

    // Create and train LSTM
    const myLSTM = new Architect.LSTM(WINDOW_SIZE * 2, 6, 1)
    const trainer = new Trainer(myLSTM)
    
    trainer.train(trainingSet, {
      rate: 0.1,
      iterations: 200,
      error: 0.005,
      shuffle: false, // keep sequential integrity
      log: 0,
      cost: Trainer.cost.MSE
    })
    
    LSTMs[gauge.id] = {
      network: myLSTM,
      maxHeight,
      maxFlow
    }
    console.log(`[ml-engine] Trained LSTM for ${gauge.id}. Max Height scale: ${maxHeight.toFixed(1)}`)
  }
  
  console.log('[ml-engine] Finished training all models.')
}

export async function generateLocalForecasts() {
  const forecasts = {}
  
  for (const gauge of GAUGES) {
    if (!LSTMs[gauge.id]) continue
    
    const { network, maxHeight, maxFlow } = LSTMs[gauge.id]
    
    const res = await query(
      `SELECT height_ft, flow_cfs FROM gauge_readings 
       WHERE gauge_id = $1 AND height_ft IS NOT NULL 
       ORDER BY observed_at DESC LIMIT $2`, 
       [gauge.id, WINDOW_SIZE]
    )
    
    if (res.rows.length < WINDOW_SIZE) continue
    
    // Rows are DESC, so reverse to ASC
    const history = res.rows.reverse()
    
    let currentInput = []
    for (const r of history) {
      currentInput.push(normalize(r.height_ft || 0, maxHeight))
      currentInput.push(normalize(r.flow_cfs || 0, maxFlow))
    }

    const predictions = []
    let t = Date.now()
    
    // Predict next 12 hours (assume 1 hr intervals for the rolling prediction)
    for (let hr = 1; hr <= 12; hr++) {
      const output = network.activate(currentInput)
      const predictedHeight = denormalize(output[0], maxHeight)
      
      predictions.push({
        time: new Date(t + hr * 3600000).toISOString(),
        height: predictedHeight
      })
      
      // Slide window: remove oldest (2 values), add new predicted height and an estimated flow
      currentInput.shift() // remove old height
      currentInput.shift() // remove old flow
      
      currentInput.push(output[0]) // push new predicted height
      // Estimate flow based on previous ratio
      const lastFlow = currentInput[currentInput.length - 2]
      currentInput.push(lastFlow) // push estimated flow
    }
    
    forecasts[gauge.id] = predictions
  }
  
  return forecasts
}
