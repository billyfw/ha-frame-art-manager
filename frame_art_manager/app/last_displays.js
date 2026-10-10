/**
 * The displays each home had the last time it answered, kept in memory.
 *
 * When a home stops answering, the TV list has nothing of it: the page marks the home
 * unreachable (a red dot) and names these, so it is clear which dots are missing (the Maui
 * wall tablet on 2026-10-10, when ha-lau was off the tailnet for a day). In memory only:
 * after a restart the names come back with that home's first answer.
 */
const lastByHouse = new Map();

function remember(houseId, tvs) {
  lastByHouse.set(houseId, (tvs || []).map((tv) => tv.name).filter(Boolean));
}

function get(houseId) {
  return lastByHouse.get(houseId) || [];
}

function reset() {
  lastByHouse.clear();
}

module.exports = { remember, get, reset };
