// DISCUS DISASTER - venues. Pure data so the start screen and the tests can share it.
// Both are fictional: no real stadium, event, sponsor or logo is depicted.
export const VENUES = [
  { id: 'college', name: 'College Night Meet', short: 'COLLEGE MEET', blurb: 'Home stand, bleachers, floodlight masts' },
  { id: 'world', name: 'World Championships Stadium', short: 'WORLD STADIUM', blurb: 'A full 360-degree bowl under a roof ring' },
];
export const DEFAULT_VENUE = 'college';
export const venueOf = (id) => VENUES.find((v) => v.id === id) || VENUES[0];
export const isVenue = (id) => VENUES.some((v) => v.id === id);
export const nextVenue = (id) => VENUES[(VENUES.findIndex((v) => v.id === id) + 1) % VENUES.length].id;
