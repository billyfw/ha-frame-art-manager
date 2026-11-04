/**
 * Plain words for a failed Show on TV.
 *
 * The shuffler's reasons reach the manager over the WebSocket API (ha_ws.js) as the text the
 * integration raised. Two of them are everyday states, not faults, and the owner asked that
 * the page say what they mean and what to do (2026-11-03, after three bare 500s at the second
 * house): a picture the house has not pulled yet, and a TV in the middle of another upload (the
 * 15-minute shuffle). Every other reason is shown as the shuffler worded it.
 *
 * The matching keys on the shuffler's message text (frame-art-shuffler `frame_tv.py`
 * "Art file not found", `__init__.py` "another upload is already in progress"); its CLAUDE.md
 * names both phrases as a contract with this file.
 */

const NOT_AT_HOUSE = /Art file not found/i;
const TV_BUSY = /another upload is already in progress/i;

/** "The Great Room TV", or "The Great Room Frame" when the name already says what it is. */
function displayLabel(tvName) {
  if (!tvName) return 'That TV';
  return /\b(tv|frame|tablet|display)\b/i.test(tvName) ? `The ${tvName}` : `The ${tvName} TV`;
}

/**
 * @param {object} failure
 * @param {string} failure.message  the error text as HA reported it
 * @param {string} [failure.code]   the WebSocket error code (service_validation_error, ...)
 * @param {string} [failure.houseName]  the house's display name (HOUSES_JSON)
 * @param {string} [failure.tvName]     the display's name as the page shows it
 * @param {boolean} [failure.unpushed]  true when the library has commits GitHub does not have yet
 * @returns {{reason: string, status: number, text: string}}
 */
function explainDisplayFailure({ message, code, houseName, tvName, unpushed }) {
  const text = message || '';
  const house = houseName ? `the ${houseName} house` : 'the house';

  if (NOT_AT_HOUSE.test(text)) {
    if (unpushed) {
      return {
        reason: 'not_pushed',
        status: 409,
        text: `That picture has not been pushed to GitHub yet (the git badge shows the push), so ${house} cannot fetch it. Once the push goes through, the house pulls it within about 30 seconds.`,
      };
    }
    return {
      reason: 'not_at_house',
      status: 409,
      text: `That picture hasn't reached ${house} yet. Try again in about 30 seconds.`,
    };
  }

  if (TV_BUSY.test(text)) {
    return {
      reason: 'tv_busy',
      status: 409,
      text: `${displayLabel(tvName)} is busy putting up another picture. Try again in about 30 seconds.`,
    };
  }

  return {
    reason: code || 'failed',
    status: 500,
    text: text || 'Failed to send command to TV',
  };
}

module.exports = { explainDisplayFailure, displayLabel };
