const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the current directory
app.use(express.static(__dirname));

// Serve index.html for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
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
