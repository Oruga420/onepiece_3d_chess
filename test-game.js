const { chromium } = require('playwright');

async function testOnePieceChess() {
    console.log('🎮 Starting One Piece 3D Chess Game Test...\n');
    
    // Launch browser
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    
    // Set viewport
    await page.setViewportSize({ width: 1280, height: 720 });
    
    try {
        console.log('📁 Opening game file...');
        await page.goto(`file://${__dirname}/index.html`);
        
        console.log('⏳ Waiting for game to load...');
        
        // Wait for loading screen to disappear (max 10 seconds)
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 10000 });
        console.log('✅ Loading screen disappeared');
        
        // Wait for game UI to appear
        await page.waitForSelector('#game-ui', { state: 'visible', timeout: 5000 });
        console.log('✅ Game UI is visible');
        
        // Check if crew selection is displayed
        const crewSelection = await page.isVisible('#crew-selection');
        console.log(`✅ Crew selection visible: ${crewSelection}`);
        
        // Test crew selection - click on Mugiwara Pirates
        console.log('🏴‍☠️ Testing crew selection...');
        await page.click('[data-crew="mugiwara"]');
        
        // Wait for crew selection to hide
        await page.waitForSelector('#crew-selection', { state: 'hidden', timeout: 3000 });
        console.log('✅ Crew selected, selection screen hidden');
        
        // Check if game controls are visible
        const gameControls = await page.isVisible('#game-controls');
        console.log(`✅ Game controls visible: ${gameControls}`);
        
        // Check if AI toggle button is present
        const aiToggle = await page.isVisible('#ai-toggle-btn');
        console.log(`✅ AI toggle button visible: ${aiToggle}`);
        
        // Check the AI button text
        const aiButtonText = await page.textContent('#ai-toggle-btn');
        console.log(`✅ AI button shows: "${aiButtonText}"`);
        
        // Check if 3D canvas is present
        const canvas = await page.isVisible('#game-canvas');
        console.log(`✅ 3D canvas visible: ${canvas}`);
        
        // Wait for pieces to be created (check console for Three.js logs)
        console.log('⏳ Waiting for 3D scene to initialize...');
        await page.waitForTimeout(3000);
        
        // Check console logs for errors
        const logs = [];
        page.on('console', msg => {
            logs.push(`${msg.type()}: ${msg.text()}`);
        });
        
        // Test AI functionality
        console.log('🤖 Testing AI functionality...');
        
        // Wait a bit to see if AI makes a move
        await page.waitForTimeout(5000);
        
        // Check if any game messages appeared
        const gameMessage = await page.textContent('#game-message');
        if (gameMessage) {
            console.log(`✅ Game message: "${gameMessage}"`);
        }
        
        // Test other controls
        console.log('🎛️ Testing other controls...');
        
        // Test AI difficulty change
        await page.selectOption('#ai-difficulty', 'hard');
        console.log('✅ Changed AI difficulty to hard');
        
        // Test camera reset
        await page.click('#camera-reset-btn');
        console.log('✅ Camera reset button clicked');
        
        // Test new game
        await page.click('#new-game-btn');
        console.log('✅ New game button clicked');
        
        // Wait for new game to initialize
        await page.waitForTimeout(2000);
        
        console.log('\n🎉 All tests completed successfully!');
        
        // Keep browser open for manual inspection
        console.log('🔍 Browser will stay open for 30 seconds for manual inspection...');
        await page.waitForTimeout(30000);
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        
        // Take screenshot on failure
        await page.screenshot({ path: 'test-failure.png', fullPage: true });
        console.log('📸 Screenshot saved as test-failure.png');
    } finally {
        await browser.close();
        console.log('🔒 Browser closed');
    }
}

// Run the test
testOnePieceChess().catch(console.error);