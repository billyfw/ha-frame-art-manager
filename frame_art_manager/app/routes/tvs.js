const express = require('express');
const router = express.Router();
const MetadataHelper = require('../metadata_helper');

// GET all TVs
router.get('/', async (req, res) => {
  try {
    const helper = new MetadataHelper(req.frameArtPath);
    const tvs = await helper.getAllTVs();
    res.json(tvs);
  } catch (error) {
    console.error('Error getting TVs:', error);
    res.status(500).json({ error: 'Failed to retrieve TVs' });
  }
});

// POST add new TV
router.post('/', async (req, res) => {
  try {
    const { name, ip } = req.body;

    if (!name || !ip) {
      return res.status(400).json({ error: 'Name and IP are required' });
    }

    const helper = new MetadataHelper(req.frameArtPath);
    const tv = await helper.addTV(name, ip);
    res.json({ success: true, tv });
  } catch (error) {
    console.error('Error adding TV:', error);
    res.status(500).json({ error: 'Failed to add TV' });
  }
});

// DELETE TV
router.delete('/:tvId', async (req, res) => {
  try {
    const helper = new MetadataHelper(req.frameArtPath);
    await helper.removeTV(req.params.tvId);
    res.json({ success: true, message: 'TV removed successfully' });
  } catch (error) {
    console.error('Error removing TV:', error);
    res.status(500).json({ error: 'Failed to remove TV' });
  }
});

// POST test TV connection
router.post('/:tvId/test', async (req, res) => {
  try {
    const helper = new MetadataHelper(req.frameArtPath);
    const tvs = await helper.getAllTVs();
    const tv = tvs.find(t => t.id === req.params.tvId);

    if (!tv) {
      return res.status(404).json({ error: 'TV not found' });
    }

    // TODO: Implement actual TV connection test
    // For now, just return success
    res.json({ 
      success: true, 
      message: 'Connection test not yet implemented',
      tv 
    });
  } catch (error) {
    console.error('Error testing TV connection:', error);
    res.status(500).json({ error: 'Failed to test TV connection' });
  }
});

// PUT update TV tags
router.put('/:tvId/tags', async (req, res) => {
  try {
    const { tags } = req.body;

    if (!Array.isArray(tags)) {
      return res.status(400).json({ error: 'Tags must be an array' });
    }

    const helper = new MetadataHelper(req.frameArtPath);
    const tv = await helper.updateTVTags(req.params.tvId, tags);
    res.json({ success: true, tv });
  } catch (error) {
    console.error('Error updating TV tags:', error);
    res.status(500).json({ error: error.message || 'Failed to update TV tags' });
  }
});

// PUT update TV details
router.put('/:tvId', async (req, res) => {
  try {
    const { name, ip } = req.body;

    if (!name || !ip) {
      return res.status(400).json({ error: 'Name and IP are required' });
    }

    const helper = new MetadataHelper(req.frameArtPath);
    const tv = await helper.updateTV(req.params.tvId, name, ip);
    res.json({ success: true, tv });
  } catch (error) {
    console.error('Error updating TV:', error);
    res.status(500).json({ error: error.message || 'Failed to update TV' });
  }
});

module.exports = router;
