'use strict';

/**
 * health-params.js — catalog of transformer health parameters (E6).
 *
 * Single source of truth for the five monitoring categories, their nominal
 * operating ranges, units and warning/critical thresholds. Consumed by:
 *   - the telemetry service (to synthesise realistic readings), and
 *   - the Health Index calculator (to score each parameter and weight it).
 *
 * `direction` describes how a value maps to risk:
 *   high_bad  — higher is worse (temperature, moisture, vibration…)
 *   low_bad   — lower is worse  (oil level, insulation resistance, power factor…)
 *   band      — deviation from `nominal` in either direction is worse (voltage)
 */

const CATEGORIES = ['electrical', 'thermal', 'oil', 'insulation', 'mechanical'];

const PARAMETERS = [
  // ── Electrical ──
  { key: 'primary_voltage_v', label: 'Primary Voltage', category: 'electrical', unit: 'V', direction: 'band', nominal: 11000, min: 10200, max: 11800, warn: 600, crit: 1000, weight: 1 },
  { key: 'secondary_voltage_v', label: 'Secondary Voltage', category: 'electrical', unit: 'V', direction: 'band', nominal: 415, min: 390, max: 440, warn: 20, crit: 35, weight: 1 },
  { key: 'load_current_a', label: 'Load Current', category: 'electrical', unit: 'A', direction: 'high_bad', nominal: 180, min: 40, max: 320, warn: 260, crit: 300, weight: 1 },
  { key: 'load_factor_pct', label: 'Load Factor', category: 'electrical', unit: '%', direction: 'high_bad', nominal: 65, min: 20, max: 100, warn: 85, crit: 95, weight: 1.2 },
  { key: 'power_factor', label: 'Power Factor', category: 'electrical', unit: '', direction: 'low_bad', nominal: 0.95, min: 0.7, max: 1.0, warn: 0.85, crit: 0.8, weight: 1 },

  // ── Thermal ──
  { key: 'top_oil_temperature_c', label: 'Top Oil Temperature', category: 'thermal', unit: '°C', direction: 'high_bad', nominal: 55, min: 25, max: 110, warn: 85, crit: 98, weight: 1.4 },
  { key: 'winding_temperature_c', label: 'Winding Temperature', category: 'thermal', unit: '°C', direction: 'high_bad', nominal: 65, min: 30, max: 130, warn: 105, crit: 120, weight: 1.5 },
  { key: 'hot_spot_temperature_c', label: 'Hot-Spot Temperature', category: 'thermal', unit: '°C', direction: 'high_bad', nominal: 75, min: 35, max: 150, warn: 115, crit: 140, weight: 1.3 },

  // ── Oil ──
  { key: 'oil_level_pct', label: 'Oil Level', category: 'oil', unit: '%', direction: 'low_bad', nominal: 92, min: 40, max: 100, warn: 70, crit: 55, weight: 1.3 },
  { key: 'moisture_in_oil_ppm', label: 'Moisture in Oil', category: 'oil', unit: 'ppm', direction: 'high_bad', nominal: 12, min: 2, max: 60, warn: 25, crit: 35, weight: 1.2 },
  { key: 'dissolved_gas_h2_ppm', label: 'Dissolved Gas (H₂)', category: 'oil', unit: 'ppm', direction: 'high_bad', nominal: 40, min: 5, max: 700, warn: 150, crit: 300, weight: 1.4 },
  { key: 'dielectric_strength_kv', label: 'Dielectric Strength', category: 'oil', unit: 'kV', direction: 'low_bad', nominal: 55, min: 20, max: 75, warn: 40, crit: 30, weight: 1.2 },

  // ── Insulation ──
  { key: 'insulation_resistance_mohm', label: 'Insulation Resistance', category: 'insulation', unit: 'MΩ', direction: 'low_bad', nominal: 1200, min: 50, max: 5000, warn: 500, crit: 200, weight: 1.4 },
  { key: 'moisture_content_pct', label: 'Paper Moisture Content', category: 'insulation', unit: '%', direction: 'high_bad', nominal: 1.5, min: 0.5, max: 6, warn: 3, crit: 4.5, weight: 1.2 },
  { key: 'polarization_index', label: 'Polarization Index', category: 'insulation', unit: '', direction: 'low_bad', nominal: 2.2, min: 1, max: 4, warn: 1.5, crit: 1.1, weight: 1 },

  // ── Mechanical ──
  { key: 'vibration_rms_mms', label: 'Vibration (RMS)', category: 'mechanical', unit: 'mm/s', direction: 'high_bad', nominal: 1.8, min: 0.2, max: 12, warn: 4.5, crit: 7, weight: 1.2 },
  { key: 'bushing_condition_pct', label: 'Bushing Condition', category: 'mechanical', unit: '%', direction: 'low_bad', nominal: 95, min: 40, max: 100, warn: 70, crit: 55, weight: 1.1 },
  { key: 'tap_changer_wear_pct', label: 'Tap Changer Wear', category: 'mechanical', unit: '%', direction: 'high_bad', nominal: 15, min: 0, max: 100, warn: 60, crit: 80, weight: 1.1 }
];

const BY_CATEGORY = CATEGORIES.reduce((acc, c) => {
  acc[c] = PARAMETERS.filter(p => p.category === c);
  return acc;
}, {});

/** Classify a value against a parameter's thresholds → 'normal'|'warning'|'critical'. */
function classify(param, value) {
  if (value == null || Number.isNaN(value)) return 'normal';
  if (param.direction === 'high_bad') {
    if (value >= param.crit) return 'critical';
    if (value >= param.warn) return 'warning';
    return 'normal';
  }
  if (param.direction === 'low_bad') {
    if (value <= param.crit) return 'critical';
    if (value <= param.warn) return 'warning';
    return 'normal';
  }
  // band: deviation from nominal
  const dev = Math.abs(value - param.nominal);
  if (dev >= param.crit) return 'critical';
  if (dev >= param.warn) return 'warning';
  return 'normal';
}

/** Per-parameter health contribution 0..100 (100 = perfectly healthy). */
function paramScore(param, value) {
  if (value == null || Number.isNaN(value)) return 100;
  const status = classify(param, value);
  if (status === 'critical') return 20;
  if (status === 'warning') return 60;
  return 100;
}

module.exports = { CATEGORIES, PARAMETERS, BY_CATEGORY, classify, paramScore };
