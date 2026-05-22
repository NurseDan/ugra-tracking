import { BigQuery } from '@google-cloud/bigquery'
import { GAUGES } from '../src/config/gauges.js'

const bigquery = new BigQuery()
// Default dataset name; can be overridden via environment variables
const DATASET = process.env.BQ_DATASET || 'river_data'

export async function trainGaugeModels() {
  console.log('[ml-engine] Starting BigQuery ML ARIMA_PLUS training...')
  
  for (const gauge of GAUGES) {
    // Train an ARIMA_PLUS model for each gauge directly in BigQuery
    // using the time series of height_ft.
    const modelName = `${DATASET}.gauge_${gauge.id}_model`
    
    // We assume gauge_readings are synced to BigQuery, or we query Cloud SQL 
    // via a BigQuery federated connection (EXTERNAL_QUERY).
    const query = `
      CREATE OR REPLACE MODEL \`${modelName}\`
      OPTIONS(
        model_type='ARIMA_PLUS',
        time_series_timestamp_col='observed_at',
        time_series_data_col='height_ft',
        data_frequency='AUTO_FREQUENCY'
      ) AS
      SELECT 
        observed_at, 
        height_ft 
      FROM \`${DATASET}.gauge_readings\`
      WHERE gauge_id = '${gauge.id}' 
        AND height_ft IS NOT NULL
        AND observed_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
    `
    try {
      console.log(`[ml-engine] Training model for ${gauge.id}...`)
      await bigquery.query(query)
      console.log(`[ml-engine] Successfully trained model for ${gauge.id}`)
    } catch (err) {
      console.error(`[ml-engine] Error training model for ${gauge.id}:`, err.message)
    }
  }
  console.log('[ml-engine] Finished training all models.')
}

export async function generateLocalForecasts() {
  const forecasts = {}
  console.log('[ml-engine] Generating local forecasts via BigQuery ML...')
  
  for (const gauge of GAUGES) {
    const modelName = `${DATASET}.gauge_${gauge.id}_model`
    
    // Forecast the next 12 steps (typically 12 hours depending on input data frequency)
    const query = `
      SELECT
        forecast_timestamp AS time,
        forecast_value AS height
      FROM
        ML.FORECAST(MODEL \`${modelName}\`, STRUCT(12 AS horizon, 0.8 AS confidence_level))
    `
    
    try {
      const [rows] = await bigquery.query(query)
      if (rows && rows.length > 0) {
        forecasts[gauge.id] = rows.map(r => ({
          time: r.time ? (r.time.value || r.time) : new Date().toISOString(),
          height: r.height
        }))
      }
    } catch (err) {
      // It's normal for models to not exist yet on the first run, so we don't crash
      console.warn(`[ml-engine] Could not generate forecast for ${gauge.id}:`, err.message)
    }
  }
  
  return forecasts
}
