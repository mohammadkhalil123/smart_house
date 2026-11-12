/**
 * Display-only thresholds drawn as dotted red lines on the charts.
 *
 * Humidity has no threshold on purpose: the previous prototype used 75 (%), but the database
 * stores raw numbers such as 258 whose unit is not defined, so a % limit would be meaningless.
 * Set `humidityMax` to a value in the stored unit to bring the line back.
 */
export const THRESHOLDS: { temperatureMax: number | undefined; humidityMax: number | undefined } = {
  temperatureMax: 30,
  humidityMax: undefined,
};
