const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the current directory
app.use(express.static(__dirname));

// Serve index.html for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// List background images dynamically so client can rotate without code changes
app.get('/bg-images', (req, res) => {
    const dir = path.join(__dirname, 'assets', 'bg_images');
    fs.readdir(dir, (err, files) => {
        if (err) {
            return res.json([]);
        }
        const exts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
        const urls = files
            .filter(f => exts.has(path.extname(f).toLowerCase()))
            .map(f => `/assets/bg_images/${f}`);
        res.json(urls);
    });
});

// List board overlay images dynamically
app.get('/board-overlay', (req, res) => {
    const dir = path.join(__dirname, 'assets', 'board_overlay');
    fs.readdir(dir, (err, files) => {
        if (err) {
            return res.json([]);
        }
        const exts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
        const urls = files
            .filter(f => exts.has(path.extname(f).toLowerCase()))
            .map(f => `/assets/board_overlay/${f}`);
        res.json(urls);
    });
});

// Handle all other routes by serving index.html (for SPA routing if needed)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚢 One Piece 3D Chess server running on http://localhost:${PORT}`);
    console.log(`🎮 Open your browser and navigate to the URL above to play!`);
    console.log(`🔄 Server will automatically restart when you make changes (in dev mode)`);
});
