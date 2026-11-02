// DISCUS DISASTER - weather. Pure module (no DOM / three.js): Node tests import it, the scene and HUD read it.
//
// What weather changes, honestly:
//   - WIND: speed range, cross-wind range and a gust profile (physics.js gustFactor). The headwind quirk still applies.
//   - AIR DENSITY from the temperature (ideal gas, physics.airDensity): hot air is thinner, so a little less lift AND drag.
//   - GRIP (rain only): a wet circle makes the release a touch less precise -> the green window is narrower. Nothing
//     in the aerodynamics is faked for rain.
// Looks (fog, rain, sky, sun) are the scene's business; the numbers here only say how much.
import { airDensity, mulberry32 } from './physics.js';

export const WEATHERS = [
  { id: 'clear', name: 'Clear Night', short: 'CLEAR', icon: '☾', temp: 20, tod: 'night', head: [-2.5, 6], cross: 4, gust: 0.1, grip: 1, fog: 0.0034, rain: 0 },
  { id: 'breezy', name: 'Breezy', short: 'BREEZY', icon: '≈', temp: 13, tod: 'night', head: [-3.5, 9], cross: 6, gust: 0.42, grip: 1, fog: 0.0034, rain: 0 },
  { id: 'rain', name: 'Rain', short: 'RAIN', icon: '☂', temp: 10, tod: 'night', head: [-2, 5], cross: 4.5, gust: 0.2, grip: 0.88, fog: 0.0052, rain: 1 },
  { id: 'fog', name: 'Fog', short: 'FOG', icon: '☁', temp: 7, tod: 'night', head: [-1, 2.5], cross: 1.5, gust: 0.04, grip: 1, fog: 0.016, rain: 0 },
  { id: 'sunset', name: 'Hot Sunset', short: 'SUNSET', icon: '☀', temp: 33, tod: 'sunset', head: [-2, 5], cross: 3, gust: 0.12, grip: 1, fog: 0.0022, rain: 0 },
];
export const DEFAULT_WEATHER = 'clear';
export const WEATHER_CHOICES = ['random', ...WEATHERS.map((w) => w.id)]; // what the start-screen picker cycles through

export const weatherOf = (id) => WEATHERS.find((w) => w.id === id) || WEATHERS[0];
export const isWeatherChoice = (id) => WEATHER_CHOICES.includes(id);

/** Air density (kg/m3) for a weather preset (sea level). */
export const densityOf = (w) => airDensity(weatherOf(w.id || w).temp, 0);

/** A wind for this weather from three uniform draws; { x, z } with the game's convention (x < 0 = headwind). */
export function windFor(weather, r1, r2) {
  const w = weatherOf(weather.id || weather);
  const headwind = w.head[0] + r1 * (w.head[1] - w.head[0]);
  return { x: -headwind, z: -w.cross + r2 * 2 * w.cross };
}

/** Seeded gust profile for a weather (null when there is none to speak of). */
export function gustFor(weather, r) {
  const w = weatherOf(weather.id || weather);
  const g = { amp: w.gust, w1: 1.1 + r() * 0.9, w2: 2.3 + r() * 1.6, ph1: r() * 6.28, ph2: r() * 6.28 };
  return g;
}

/** The Daily Throw's weather: the same for everyone on a given date (from the date seed). */
export function dailyWeather(seed) {
  const h = (Math.imul(seed | 0, 2654435761) >>> 0) % 1000;
  return WEATHERS[h % WEATHERS.length].id;
}

/** 'random' resolves to a real preset (seeded, so tests can reproduce it). */
export function resolveWeather(choice, rnd = Math.random) {
  if (choice === 'random' || !isWeatherChoice(choice)) return WEATHERS[Math.floor(rnd() * WEATHERS.length)].id;
  return choice;
}

/** Multiplier for the green release window (rain = a slightly slippery circle). */
export const gripOf = (weather) => weatherOf(weather && (weather.id || weather)).grip;
export { mulberry32 };
