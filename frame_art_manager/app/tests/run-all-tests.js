#!/usr/bin/env node

/**
 * Test Runner with Summary
 * Runs all test suites and displays a summary of results
 */

const { spawn } = require('child_process');
const path = require('path');

// ANSI color codes
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  reset: '\x1b[0m'
};

// Test suites to run
const testSuites = [
  { name: 'Semantic Sync Tests', file: 'semantic-sync.test.js' },
  { name: 'Git Sync Tests', file: 'git-sync.test.js' },
  { name: 'Metadata Helper Tests', file: 'metadata-helper.test.js' },
  { name: 'Image Editing Tests', file: 'image-editing.test.js' },
  { name: 'File Coordination Tests', file: 'file-coordination.test.js' },
  { name: 'Upload Validation Tests', file: 'upload-validation.test.js' },
  { name: 'Commit Message Tests', file: 'commit-message.test.js' }
];

// Results tracking
const results = [];

/**
 * Run a single test file
 */
function runTest(testSuite) {
  return new Promise((resolve) => {
    const testPath = path.join(__dirname, testSuite.file);
    let output = '';
    
    const child = spawn('node', [testPath], {
      cwd: __dirname
    });

    // Capture stdout to parse test results
    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      process.stdout.write(chunk);
      output += chunk;
    });

    // Capture stderr
    child.stderr.on('data', (data) => {
      process.stderr.write(data);
      output += data.toString();
    });

    child.on('close', (code) => {
      // Parse test results from output
      const passedMatch = output.match(/Passed:\s+(\d+)/);
      const failedMatch = output.match(/Failed:\s+(\d+)/);
      const skippedMatch = output.match(/Skipped:\s+(\d+)/);
      
      const passCount = passedMatch ? parseInt(passedMatch[1]) : 0;
      const failCount = failedMatch ? parseInt(failedMatch[1]) : 0;
      const skipCount = skippedMatch ? parseInt(skippedMatch[1]) : 0;
      
      resolve({
        name: testSuite.name,
        file: testSuite.file,
        passed: code === 0,
        passCount,
        failCount,
        skipCount,
        total: passCount + failCount + skipCount
      });
    });

    child.on('error', (err) => {
      console.error(`${colors.red}Error running ${testSuite.name}:${colors.reset}`, err);
      resolve({
        name: testSuite.name,
        file: testSuite.file,
        passed: false,
        error: err.message,
        passCount: 0,
        failCount: 0,
        skipCount: 0,
        total: 0
      });
    });
  });
}

/**
 * Print summary of all test results
 */
function printSummary(results) {
  console.log('\n' + '='.repeat(80));
  console.log(`${colors.bold}${colors.cyan}TEST SUMMARY${colors.reset}`);
  console.log('='.repeat(80) + '\n');

  let totalPassed = 0;
  let totalFailed = 0;
  let totalTestsPassed = 0;
  let totalTestsFailed = 0;
  let totalTestsSkipped = 0;

  results.forEach((result) => {
    const status = result.passed 
      ? `${colors.green}✓ PASS${colors.reset}` 
      : `${colors.red}✗ FAIL${colors.reset}`;
    
    // Build count string - always show pass and fail
    let countStr = '';
    if (result.total > 0) {
      const parts = [];
      parts.push(`${result.passCount} pass`);
      parts.push(`${result.failCount} fail`);
      if (result.skipCount > 0) parts.push(`${result.skipCount} skip`);
      countStr = ` (${parts.join(', ')})`;
    }
    
    console.log(`${status}  ${result.name}${countStr}`);
    
    if (result.passed) {
      totalPassed++;
    } else {
      totalFailed++;
      if (result.error) {
        console.log(`       ${colors.red}Error: ${result.error}${colors.reset}`);
      }
    }
    
    // Accumulate individual test counts
    totalTestsPassed += result.passCount;
    totalTestsFailed += result.failCount;
    totalTestsSkipped += result.skipCount;
  });

  console.log('\n' + '-'.repeat(80));
  
  const totalSuites = totalPassed + totalFailed;
  const suitePassRate = totalSuites > 0 ? ((totalPassed / totalSuites) * 100).toFixed(1) : 0;
  
  console.log(`${colors.bold}Test Suites:${colors.reset} ${colors.green}${totalPassed} passed${colors.reset}, ${totalFailed > 0 ? colors.red : ''}${totalFailed} failed${colors.reset}, ${totalSuites} total`);
  
  const totalTests = totalTestsPassed + totalTestsFailed + totalTestsSkipped;
  if (totalTests > 0) {
    const parts = [`${colors.green}${totalTestsPassed} passed${colors.reset}`];
    if (totalTestsFailed > 0) parts.push(`${colors.red}${totalTestsFailed} failed${colors.reset}`);
    if (totalTestsSkipped > 0) parts.push(`${colors.yellow}${totalTestsSkipped} skipped${colors.reset}`);
    parts.push(`${totalTests} total`);
    console.log(`${colors.bold}Tests:${colors.reset}       ${parts.join(', ')}`);
  }
  
  console.log('='.repeat(80) + '\n');

  // Return exit code
  return totalFailed > 0 ? 1 : 0;
}

/**
 * Main test runner
 */
async function runAllTests() {
  console.log(`${colors.bold}${colors.blue}Running all test suites...${colors.reset}\n`);
  
  const startTime = Date.now();

  // Run tests sequentially
  for (const testSuite of testSuites) {
    console.log(`\n${colors.yellow}▶ Running: ${testSuite.name}${colors.reset}`);
    console.log('-'.repeat(80));
    
    const result = await runTest(testSuite);
    results.push(result);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n${colors.cyan}All tests completed in ${duration}s${colors.reset}`);

  // Print summary and exit with appropriate code
  const exitCode = printSummary(results);
  process.exit(exitCode);
}

// Run the tests
runAllTests().catch((err) => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, err);
  process.exit(1);
});
