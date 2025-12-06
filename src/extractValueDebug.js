import puppeteer from 'puppeteer';
import fs from 'fs';

/**
 * Debug version: Extracts and saves the JSON data for inspection
 * This helps us understand the actual structure without running the full extraction
 */
export async function extractAndSaveJson(url, outputPath = 'debug-json-data.json') {
  let browser = null;
  let jsonData = null;
  
  try {
    console.log('Launching browser to capture JSON data...');
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    const page = await browser.newPage();
    
    // Set a realistic user-agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Enable request interception to capture the JSON data
    await page.setRequestInterception(true);
    
    // Track intercepted JSON data
    page.on('request', request => {
      request.continue();
    });
    
    page.on('response', async response => {
      const url = response.url();
      // Capture the empacotamento JSON data from the API
      if (url.includes('api/s3/object') && url.includes('EMPACOTAMENTOS') && url.includes('.json')) {
        try {
          const text = await response.text();
          jsonData = JSON.parse(text);
          console.log('Captured JSON data from:', url);
        } catch (e) {
          console.log('Failed to parse response from:', url);
        }
      }
    });

    console.log(`Navigating to ${url}...`);
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for the data to be loaded
    console.log('Waiting for data to load...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    // If we didn't capture JSON via interception, try alternative methods
    if (!jsonData) {
      console.log('JSON not captured via interception, trying alternative extraction...');
      
      // Try to get data from the page's JavaScript context
      jsonData = await page.evaluate(() => {
        // Look for data in common places
        if (window.__EMPACOTAMENTO_DATA__) return window.__EMPACOTAMENTO_DATA__;
        if (window.empacotamentoData) return window.empacotamentoData;
        
        // Try to find it in any global variable
        for (const key of Object.keys(window)) {
          if (key.toLowerCase().includes('empacotamento') || key.toLowerCase().includes('data')) {
            const val = window[key];
            if (val && typeof val === 'object' && (val.data || val.empacotamento || val.Empacotamento)) {
              return val;
            }
          }
        }
        return null;
      });
    }

    if (!jsonData) {
      throw new Error('Could not capture JSON data from the page. The data may not be loading properly.');
    }

    // Save the JSON to a file
    console.log(`Saving JSON data to ${outputPath}...`);
    fs.writeFileSync(outputPath, JSON.stringify(jsonData, null, 2));
    console.log(`✓ JSON data saved to ${outputPath}`);
    
    // Also log structure info
    console.log('\n=== JSON Structure Summary ===');
    console.log('Type:', Array.isArray(jsonData) ? 'Array' : typeof jsonData);
    console.log('Top-level keys:', Object.keys(jsonData));
    
    if (Array.isArray(jsonData)) {
      console.log(`Array length: ${jsonData.length}`);
      if (jsonData.length > 0) {
        console.log('First item keys:', Object.keys(jsonData[0]));
        console.log('Last item keys:', Object.keys(jsonData[jsonData.length - 1]));
      }
    } else if (jsonData.data && Array.isArray(jsonData.data)) {
      console.log(`Data array length: ${jsonData.data.length}`);
      if (jsonData.data.length > 0) {
        console.log('First data item keys:', Object.keys(jsonData.data[0]));
        console.log('Last data item keys:', Object.keys(jsonData.data[jsonData.data.length - 1]));
      }
    } else if (jsonData.series && Array.isArray(jsonData.series)) {
      console.log(`Series array length: ${jsonData.series.length}`);
      jsonData.series.forEach((s, idx) => {
        console.log(`Series ${idx}: name="${s.name}", id="${s.id}", data length=${s.data?.length || 0}`);
      });
    }
    
    return jsonData;

  } catch (error) {
    console.error('Error capturing JSON:', error.message || error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2] || 'https://mago.ntag.com.br/empacotamento';
  extractAndSaveJson(url)
    .then(() => {
      console.log('\n✓ Debug extraction complete. Check debug-json-data.json');
      process.exit(0);
    })
    .catch(error => {
      console.error('Error:', error);
      process.exit(1);
    });
}

