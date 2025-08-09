const fs = require('fs');

// Read the script file
const content = fs.readFileSync('script.js', 'utf8');
const lines = content.split('\n');

// Find the start and end of duplicate section
let duplicateStart = -1;
let duplicateEnd = -1;

for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === 'hideLoadingScreen() {' && duplicateStart === -1) {
        // This is the second occurrence (duplicate)
        if (lines[i-400] && lines[i-400].includes('hideLoadingScreen')) {
            duplicateStart = i - 2; // Include the closing brace
            console.log(`Found duplicate start at line ${duplicateStart + 1}`);
        }
    }
    
    if (lines[i].trim() === 'clearHighlights() {' && duplicateStart !== -1 && duplicateEnd === -1) {
        duplicateEnd = i - 2; // Don't include clearHighlights
        console.log(`Found duplicate end at line ${duplicateEnd + 1}`);
        break;
    }
}

if (duplicateStart !== -1 && duplicateEnd !== -1) {
    // Remove duplicate lines
    const beforeDuplicates = lines.slice(0, duplicateStart);
    const afterDuplicates = lines.slice(duplicateEnd + 1);
    
    const fixedContent = beforeDuplicates.concat(afterDuplicates).join('\n');
    
    // Write the fixed file
    fs.writeFileSync('script.js', fixedContent);
    
    console.log(`✅ Removed ${duplicateEnd - duplicateStart + 1} duplicate lines`);
    console.log(`✅ Fixed script.js - duplicates removed`);
    
    // Verify no syntax errors
    try {
        eval(`(function() { ${fixedContent} })()`);
        console.log('❌ Syntax check failed - code contains browser-specific APIs');
    } catch (error) {
        if (error.message.includes('THREE is not defined') || 
            error.message.includes('document is not defined')) {
            console.log('✅ Syntax looks good (browser APIs expected)');
        } else {
            console.error('❌ Syntax error:', error.message);
        }
    }
    
} else {
    console.log('❌ Could not find duplicate section boundaries');
    console.log(`duplicateStart: ${duplicateStart}, duplicateEnd: ${duplicateEnd}`);
}