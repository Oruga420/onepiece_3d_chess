const fs = require('fs');

// Read the script file
const content = fs.readFileSync('script.js', 'utf8');
const lines = content.split('\n');

// Remove lines 863 to 1112 (the duplicate section)
const duplicateStart = 862; // Line 863 (0-indexed)
const duplicateEnd = 1112;  // Line 1113 (0-indexed), but we want to keep clearHighlights

console.log(`Removing lines ${duplicateStart + 1} to ${duplicateEnd}`);
console.log(`Before removal: ${lines.length} lines`);

// Keep everything before and after the duplicate section
const beforeDuplicates = lines.slice(0, duplicateStart);
const afterDuplicates = lines.slice(duplicateEnd);

const fixedContent = beforeDuplicates.concat(afterDuplicates).join('\n');

// Write the fixed file
fs.writeFileSync('script.js', fixedContent);

console.log(`After removal: ${beforeDuplicates.length + afterDuplicates.length} lines`);
console.log(`✅ Removed ${duplicateEnd - duplicateStart} duplicate lines`);
console.log(`✅ Fixed script.js - duplicates removed`);