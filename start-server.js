const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;

// MIME types
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.woff': 'application/font-woff',
    '.ttf': 'application/font-ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'application/font-otf',
    '.wasm': 'application/wasm'
};

const server = http.createServer((request, response) => {
    console.log('📡 Request:', request.method, request.url);

    let filePath = '.' + request.url;
    if (filePath === './') {
        filePath = './index.html';
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, function(error, content) {
        if (error) {
            if(error.code == 'ENOENT') {
                response.writeHead(404, { 'Content-Type': 'text/html' });
                response.end(`
                    <h1>404 - File Not Found</h1>
                    <p>The requested file <code>${request.url}</code> was not found.</p>
                    <p><a href="/">Go to Homepage</a></p>
                `, 'utf-8');
            } else {
                response.writeHead(500);
                response.end(`Server Error: ${error.code}`);
            }
        } else {
            // Add CORS headers and cache control
            response.writeHead(200, { 
                'Content-Type': mimeType,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            response.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log(`🚀 One Piece 3D Chess Server Started!`);
    console.log(`🌍 Open your browser and go to: http://localhost:${PORT}`);
    console.log(`🎮 The game should load automatically!`);
    console.log(`📊 Server logs will appear below:\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Server shutting down...');
    server.close(() => {
        console.log('✅ Server stopped.');
        process.exit(0);
    });
});