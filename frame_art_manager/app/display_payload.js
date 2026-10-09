const path = require('path');

/**
 * Body of the frame_art_shuffler.display_image call that shows one library picture.
 *
 * The central manager (HOUSES_JSON, `house` set) and each house's integration run on
 * different machines, so the one thing both agree on is the filename: the integration
 * resolves it inside its own copy of the library. `image_path` and `image_url` are add-on
 * era fields, valid only while manager and integration shared /config/www. Sent from Fly
 * they named /data/frame_art/library/<file>, a path that exists on no HA box, and the
 * integration takes image_path first, so every Show on TV at Madrone since the cutover
 * failed with "Art file not found" (2026-10-09). The add-on deployment (no house) keeps
 * sending them for the integrations other people run.
 */
function displayPayload({ house, frameArtPath, filename, matte, filter, device_id, entity_id }) {
  const payload = { filename };
  if (!house) {
    const imagePath = path.join(frameArtPath, 'library', filename);
    payload.image_path = imagePath;
    payload.image_url = `/local/${path.relative('/config/www', imagePath)}`;
  }
  if (matte) payload.matte = matte;
  if (filter) payload.filter = filter;
  if (device_id) payload.device_id = device_id;
  else payload.entity_id = entity_id;
  return payload;
}

module.exports = { displayPayload };
