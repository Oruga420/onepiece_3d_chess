const fs = require(''fs'');
const path = require(''path'');

module.exports = (req, res) => {
  try {
    const dir = path.join(process.cwd(), 'assets', 'bg_images');
    fs.readdir(dir, (err, files) => {
      if (err) {
        res.status(200).json([]);
        return;
      }
      const exts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
      const urls = files
        .filter((f) => exts.has(path.extname(f).toLowerCase()))
        .map((f) => `/assets/bg_images/${encodeURIComponent(f)}`);
      res.status(200).json(urls);
    });
  } catch (_) {
    res.status(200).json([]);
  }
};
