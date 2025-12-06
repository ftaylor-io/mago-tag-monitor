import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Takes a screenshot of the graph on the MAGO TAG website
 * @param {string} url - The URL to screenshot
 * @param {string} outputPath - Path to save the screenshot
 * @returns {Promise<string>} Path to the saved screenshot
 */
export async function takeScreenshot(url, outputPath = 'screenshot.png') {
  let browser = null;
  
  try {
    console.log('Launching browser...');
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    
    // Set viewport to ensure consistent screenshot size
    await page.setViewport({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1
    });

    console.log(`Navigating to ${url}...`);
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for the graph to load - adjust selector based on actual page structure
    console.log('Waiting for graph to load...');
    await page.waitForTimeout(3000); // Give extra time for graph rendering

    // Try to find the graph container - this may need adjustment based on actual page
    // For now, we'll take a full page screenshot and can crop later if needed
    const screenshotPath = path.join(__dirname, '..', outputPath);
    
    console.log('Taking screenshot...');
    await page.screenshot({
      path: screenshotPath,
      fullPage: false, // Set to true if you need full page
      type: 'png'
    });

    console.log(`Screenshot saved to ${screenshotPath}`);
    return screenshotPath;

  } catch (error) {
    console.error('Error taking screenshot:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
      console.log('Browser closed');
    }
  }
}

