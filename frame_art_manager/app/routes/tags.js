const express = require('express');
const router = express.Router();
const MetadataHelper = require('../metadata_helper');

// GET all tags
router.get('/', async (req, res) => {
  try {
    const helper = new MetadataHelper(req.frameArtPath);
    const tags = await helper.getAllTags();
    res.json(tags);
  } catch (error) {
    console.error('Error getting tags:', error);
    res.status(500).json({ error: 'Failed to retrieve tags' });
  }
});

// POST add new tag
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Tag name is required' });
    }

    const helper = new MetadataHelper(req.frameArtPath);
    const tags = await helper.addTag(name);
    res.json({ success: true, tags });
  } catch (error) {
    console.error('Error adding tag:', error);
    res.status(500).json({ error: 'Failed to add tag' });
  }
});

// DELETE tag
router.delete('/:tagName', async (req, res) => {
  try {
    const helper = new MetadataHelper(req.frameArtPath);
    const tags = await helper.removeTag(req.params.tagName);
    res.json({ success: true, tags });
  } catch (error) {
    console.error('Error removing tag:', error);
    res.status(500).json({ error: 'Failed to remove tag' });
  }
});

module.exports = router;
