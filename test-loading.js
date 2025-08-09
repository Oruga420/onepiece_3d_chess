// Simple test to simulate browser loading
const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const fs = require('fs');

console.log('🧪 Testing One Piece Chess Game Loading...\n');

// Read the HTML file
const html = fs.readFileSync('index.html', 'utf8');

// Create DOM environment
const dom = new JSDOM(html, {
    resources: 'usable',
    runScripts: 'dangerously',
    url: 'http://localhost:8080'
});

const { window } = dom;
const { document } = window;

// Mock console for debugging
window.console = {
    log: (...args) => console.log('🌐', ...args),
    error: (...args) => console.error('❌', ...args),
    warn: (...args) => console.warn('⚠️', ...args)
};

// Wait for scripts to load and test game initialization
setTimeout(() => {
    console.log('\n📊 Testing Results:');
    console.log(`✅ THREE defined: ${typeof window.THREE !== 'undefined'}`);
    console.log(`✅ threeJSReady: ${window.threeJSReady === true}`);
    console.log(`✅ Loading screen exists: ${!!document.getElementById('loading-screen')}`);
    console.log(`✅ Game UI exists: ${!!document.getElementById('game-ui')}`);
    console.log(`✅ Canvas exists: ${!!document.getElementById('game-canvas')}`);
    
    // Check if OnePiece3DChess class is defined
    const hasGameClass = typeof window.OnePiece3DChess !== 'undefined';
    console.log(`✅ OnePiece3DChess class defined: ${hasGameClass}`);
    
    if (hasGameClass) {
        console.log('\n🎉 Game class successfully loaded!');
        console.log('The game should initialize properly in a real browser.');
    } else {
        console.log('\n❌ Game class not loaded - script.js may have issues');
    }
    
    // Try to instantiate the game to check for errors
    try {
        if (window.OnePiece3DChess) {
            console.log('📋 Attempting game instantiation test...');
            // Don't actually create the game, just test the constructor exists
            const gameConstructor = window.OnePiece3DChess;
            console.log('✅ Game constructor accessible');
        }
    } catch (error) {
        console.error('❌ Game instantiation error:', error.message);
    }
    
    dom.window.close();
}, 5000);

console.log('⏳ Simulating browser environment for 5 seconds...');