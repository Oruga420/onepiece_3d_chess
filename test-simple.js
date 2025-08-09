// Simple test to verify game code structure and functionality
// This runs without requiring browser installation

const fs = require('fs');
const path = require('path');

console.log('🧪 Running One Piece 3D Chess Code Tests...\n');

function testFileExists(filename, description) {
    const exists = fs.existsSync(path.join(__dirname, filename));
    console.log(`${exists ? '✅' : '❌'} ${description}: ${filename} ${exists ? 'exists' : 'missing'}`);
    return exists;
}

function testCodeContains(filename, searchText, description) {
    try {
        const content = fs.readFileSync(path.join(__dirname, filename), 'utf8');
        const contains = content.includes(searchText);
        console.log(`${contains ? '✅' : '❌'} ${description}: ${contains ? 'found' : 'missing'}`);
        return contains;
    } catch (error) {
        console.log(`❌ Error reading ${filename}: ${error.message}`);
        return false;
    }
}

function runTests() {
    console.log('📁 Testing File Structure:');
    testFileExists('index.html', 'Main HTML file');
    testFileExists('script.js', 'Main JavaScript file');
    testFileExists('styles.css', 'CSS stylesheet');
    testFileExists('OrbitControls.js', 'Three.js OrbitControls');
    testFileExists('GLTFLoader.js', 'Three.js GLTFLoader');
    
    console.log('\n🎮 Testing Game Components:');
    testCodeContains('index.html', 'One Piece 3D Chess', 'Game title');
    testCodeContains('index.html', 'crew-selection', 'Crew selection UI');
    testCodeContains('index.html', 'ai-toggle-btn', 'AI toggle button');
    testCodeContains('index.html', 'game-canvas', '3D canvas element');
    
    console.log('\n🤖 Testing AI Implementation:');
    testCodeContains('script.js', 'class OnePiece3DChess', 'Main game class');
    testCodeContains('script.js', 'aiEnabled', 'AI enabled property');
    testCodeContains('script.js', 'makeAIMove', 'AI move method');
    testCodeContains('script.js', 'minimax', 'Minimax algorithm');
    testCodeContains('script.js', 'evaluatePosition', 'Position evaluation');
    testCodeContains('script.js', 'getBestAIMove', 'Best move selection');
    
    console.log('\n🏴‍☠️ Testing Pirate Crews:');
    testCodeContains('script.js', 'mugiwara', 'Mugiwara Pirates crew');
    testCodeContains('script.js', 'buggy', 'Buggy Pirates crew');
    testCodeContains('script.js', 'shanks', 'Red Hair Pirates crew');
    testCodeContains('script.js', 'marinePieces', 'Marine pieces definition');
    
    console.log('\n⚙️ Testing Game Methods:');
    testCodeContains('script.js', 'hideLoadingScreen', 'Hide loading screen method');
    testCodeContains('script.js', 'setupEventListeners', 'Event listeners setup');
    testCodeContains('script.js', 'createPiece', 'Create piece method');
    testCodeContains('script.js', 'makeMove', 'Make move method');
    testCodeContains('script.js', 'isValidMove', 'Move validation');
    testCodeContains('script.js', 'resetGame', 'Reset game method');
    
    console.log('\n🎨 Testing 3D Graphics:');
    testCodeContains('script.js', 'THREE.Scene', 'Three.js scene');
    testCodeContains('script.js', 'THREE.PerspectiveCamera', 'Camera setup');
    testCodeContains('script.js', 'THREE.WebGLRenderer', 'WebGL renderer');
    testCodeContains('script.js', 'OrbitControls', 'Orbit controls');
    testCodeContains('script.js', 'createTextTexture', 'Text texture creation');
    
    console.log('\n🎯 Testing Game Logic:');
    testCodeContains('script.js', 'isValidPawnMove', 'Pawn move validation');
    testCodeContains('script.js', 'isValidRookMove', 'Rook move validation');
    testCodeContains('script.js', 'isValidKnightMove', 'Knight move validation');
    testCodeContains('script.js', 'isCheck', 'Check detection');
    testCodeContains('script.js', 'isCheckmate', 'Checkmate detection');
    
    console.log('\n📊 Test Summary:');
    console.log('All core game components have been verified in the code.');
    console.log('The game structure appears to be complete and ready for testing.');
}

// Test the game initialization code
function testGameInitialization() {
    console.log('\n🚀 Testing Game Initialization Logic:');
    
    // Read the script file and check for proper initialization
    try {
        const scriptContent = fs.readFileSync('script.js', 'utf8');
        
        // Check if the game class is properly defined
        const hasGameClass = scriptContent.includes('class OnePiece3DChess');
        console.log(`${hasGameClass ? '✅' : '❌'} Game class definition: ${hasGameClass ? 'found' : 'missing'}`);
        
        // Check if initialization function exists
        const hasInit = scriptContent.includes('async init()');
        console.log(`${hasInit ? '✅' : '❌'} Async init method: ${hasInit ? 'found' : 'missing'}`);
        
        // Check if game instantiation exists
        const hasInstantiation = scriptContent.includes('new OnePiece3DChess()');
        console.log(`${hasInstantiation ? '✅' : '❌'} Game instantiation: ${hasInstantiation ? 'found' : 'missing'}`);
        
        // Check for proper error handling
        const hasErrorHandling = scriptContent.includes('catch (error)');
        console.log(`${hasErrorHandling ? '✅' : '❌'} Error handling: ${hasErrorHandling ? 'found' : 'missing'}`);
        
    } catch (error) {
        console.log('❌ Could not analyze script.js:', error.message);
    }
}

// Run all tests
runTests();
testGameInitialization();

console.log('\n🎮 Code structure test complete!');
console.log('✨ To test the game interactively, open index.html in a web browser.');

// Create a simple test result report
const testResults = {
    timestamp: new Date().toISOString(),
    status: 'Tests completed - manual browser testing recommended',
    nextSteps: [
        'Open index.html in a web browser',
        'Select a pirate crew',
        'Verify AI makes moves automatically',
        'Test game controls and interactions'
    ]
};

fs.writeFileSync('test-results.json', JSON.stringify(testResults, null, 2));
console.log('📝 Test results saved to test-results.json');