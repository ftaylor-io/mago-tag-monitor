import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Takes a screenshot of only the graph area on the MAGO TAG website
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
    
    // Set a realistic user-agent to avoid being blocked
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Set viewport to ensure consistent screenshot size
    await page.setViewport({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1
    });

    console.log(`Navigating to ${url}...`);
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for the graph to load
    console.log('Waiting for graph to load...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    const screenshotPath = path.join(__dirname, '..', outputPath);
    
    // Try to capture just the graph element
    console.log('Looking for graph element...');
    
    // Try different selectors for the graph container
    const graphSelectors = [
      '[class*="chart"]',
      '[class*="graph"]',
      'canvas',
      'svg',
      '[class*="apexcharts"]',
      '[class*="highcharts"]',
      '[class*="echarts"]',
      '[class*="recharts"]',
      'main img',
      '[role="img"]'
    ];
    
    let graphElement = null;
    for (const selector of graphSelectors) {
      try {
        graphElement = await page.$(selector);
        if (graphElement) {
          const box = await graphElement.boundingBox();
          // Only use if it's a reasonably sized element (graph should be at least 200x200)
          if (box && box.width >= 200 && box.height >= 200) {
            console.log(`Found graph element with selector: ${selector}`);
            break;
          }
          graphElement = null;
        }
      } catch (e) {
        // Selector not found, continue
      }
    }
    
    // If we found a graph element, take a screenshot of just that element
    if (graphElement) {
      console.log('Taking screenshot of graph element...');
      
      // Get the bounding box and add some padding
      const box = await graphElement.boundingBox();
      const padding = 20;
      
      await page.screenshot({
        path: screenshotPath,
        type: 'png',
        clip: {
          x: Math.max(0, box.x - padding),
          y: Math.max(0, box.y - padding),
          width: box.width + (padding * 2),
          height: box.height + (padding * 2)
        }
      });
    } else {
      // Fall back to capturing the main content area
      console.log('Graph element not found, capturing main content area...');
      
      // Try to find the main content area
      const mainElement = await page.$('main') || await page.$('[role="main"]');
      
      if (mainElement) {
        await mainElement.screenshot({
          path: screenshotPath,
          type: 'png'
        });
      } else {
        // Last resort: capture the viewport without header
        console.log('Taking viewport screenshot...');
        await page.screenshot({
          path: screenshotPath,
          fullPage: false,
          type: 'png',
          clip: {
            x: 0,
            y: 100, // Skip header area
            width: 1920,
            height: 900
          }
        });
      }
    }

    console.log(`Screenshot saved to ${screenshotPath}`);
    return screenshotPath;

  } catch (error) {
    console.error('Error taking screenshot:', error.message || error);
    if (error.name === 'TimeoutError') {
      throw new Error(`Timeout while loading ${url}. The website may be slow or unreachable.`);
    }
    if (error.message && error.message.includes('net::')) {
      throw new Error(`Network error accessing ${url}. Please check if the website is accessible.`);
    }
    throw error;
  } finally {
    if (browser) {
      await browser.close();
      console.log('Browser closed');
    }
  }
}
