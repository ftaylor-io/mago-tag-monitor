import puppeteer from 'puppeteer';

/**
 * Extracts the current "Estimativa" (end-of-day projection) value from the graph page
 * Uses XHR interception to capture the JSON data loaded by the page
 * @param {string} url - The URL to extract the value from
 * @returns {Promise<number>} The estimativa value as a number
 */
export async function extractCurrentValue(url) {
  let browser = null;
  let jsonData = null;
  
  try {
    console.log('Launching browser to extract value...');
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
            if (val && typeof val === 'object' && (val.data || val.estimativa || val.Estimativa)) {
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

    console.log('JSON data structure keys:', Object.keys(jsonData));
    
    // Extract the estimativa value from the JSON
    // The JSON structure is expected to have data points with estimativa values
    const estimativaValue = extractEstimativaFromJson(jsonData);
    
    if (!estimativaValue) {
      throw new Error('Could not find Estimativa value in the JSON data');
    }

    console.log(`Extracted Estimativa value: ${estimativaValue.toLocaleString('pt-BR')}`);
    return estimativaValue;

  } catch (error) {
    console.error('Error extracting value:', error.message || error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Extract the last Estimativa (projection) value from the JSON data
 * @param {Object} jsonData - The JSON data from the API
 * @returns {number|null} The estimativa value or null if not found
 */
function extractEstimativaFromJson(jsonData) {
  try {
    // Log the JSON structure for debugging
    console.log('Analyzing JSON structure...');
    
    // Try different possible JSON structures
    
    // Structure 1: Array of data points with estimativa field
    if (Array.isArray(jsonData)) {
      console.log(`JSON is an array with ${jsonData.length} items`);
      // Get the last item (most recent/end-of-day projection)
      const lastItem = jsonData[jsonData.length - 1];
      if (lastItem) {
        console.log('Last item keys:', Object.keys(lastItem));
        // Look for estimativa in various field names
        const estimativaKey = Object.keys(lastItem).find(k => 
          k.toLowerCase().includes('estimativa') || 
          k.toLowerCase().includes('projection') ||
          k.toLowerCase() === 'value' ||
          k.toLowerCase() === 'valor'
        );
        if (estimativaKey && typeof lastItem[estimativaKey] === 'number') {
          return lastItem[estimativaKey];
        }
        // If it has a generic value field
        if (typeof lastItem.value === 'number') return lastItem.value;
        if (typeof lastItem.valor === 'number') return lastItem.valor;
        if (typeof lastItem.y === 'number') return lastItem.y;
      }
    }
    
    // Structure 2: Object with data/series arrays
    if (jsonData.data && Array.isArray(jsonData.data)) {
      console.log(`JSON has data array with ${jsonData.data.length} items`);
      const lastItem = jsonData.data[jsonData.data.length - 1];
      if (lastItem && typeof lastItem.estimativa === 'number') {
        return lastItem.estimativa;
      }
      if (lastItem && typeof lastItem.Estimativa === 'number') {
        return lastItem.Estimativa;
      }
      if (lastItem && typeof lastItem.value === 'number') {
        return lastItem.value;
      }
    }
    
    // Structure 3: Object with estimativa array
    if (jsonData.estimativa && Array.isArray(jsonData.estimativa)) {
      console.log(`JSON has estimativa array with ${jsonData.estimativa.length} items`);
      const lastValue = jsonData.estimativa[jsonData.estimativa.length - 1];
      if (typeof lastValue === 'number') return lastValue;
      if (lastValue && typeof lastValue.value === 'number') return lastValue.value;
      if (lastValue && typeof lastValue.y === 'number') return lastValue.y;
    }
    
    // Structure 4: Object with Estimativa array (capitalized)
    if (jsonData.Estimativa && Array.isArray(jsonData.Estimativa)) {
      console.log(`JSON has Estimativa array with ${jsonData.Estimativa.length} items`);
      const lastValue = jsonData.Estimativa[jsonData.Estimativa.length - 1];
      if (typeof lastValue === 'number') return lastValue;
      if (lastValue && typeof lastValue.value === 'number') return lastValue.value;
      if (lastValue && typeof lastValue.y === 'number') return lastValue.y;
    }
    
    // Structure 5: Object with series containing estimativa
    if (jsonData.series && Array.isArray(jsonData.series)) {
      console.log(`JSON has series array with ${jsonData.series.length} items`);
      const estimativaSeries = jsonData.series.find(s => 
        s.name?.toLowerCase().includes('estimativa') ||
        s.id?.toLowerCase().includes('estimativa')
      );
      if (estimativaSeries && Array.isArray(estimativaSeries.data)) {
        const lastValue = estimativaSeries.data[estimativaSeries.data.length - 1];
        if (typeof lastValue === 'number') return lastValue;
        if (lastValue && typeof lastValue.y === 'number') return lastValue.y;
        if (lastValue && typeof lastValue.value === 'number') return lastValue.value;
      }
    }
    
    // Structure 6: Direct estimativa value
    if (typeof jsonData.estimativa === 'number') {
      return jsonData.estimativa;
    }
    if (typeof jsonData.Estimativa === 'number') {
      return jsonData.Estimativa;
    }
    
    // Structure 7: Look for any numeric value in expected range (50M - 80M)
    console.log('Searching for numeric values in expected range...');
    const numericValues = findNumericValuesInRange(jsonData, 50000000, 80000000);
    if (numericValues.length > 0) {
      console.log(`Found ${numericValues.length} numeric values in range. Using last one.`);
      return numericValues[numericValues.length - 1];
    }
    
    // Log the full structure for debugging
    console.log('Full JSON structure (first 1000 chars):', 
      JSON.stringify(jsonData).substring(0, 1000));
    
    return null;
  } catch (error) {
    console.error('Error parsing JSON structure:', error);
    return null;
  }
}

/**
 * Recursively find numeric values in expected range
 */
function findNumericValuesInRange(obj, min, max, values = []) {
  if (typeof obj === 'number' && obj >= min && obj <= max) {
    values.push(obj);
  } else if (Array.isArray(obj)) {
    obj.forEach(item => findNumericValuesInRange(item, min, max, values));
  } else if (obj && typeof obj === 'object') {
    Object.values(obj).forEach(val => findNumericValuesInRange(val, min, max, values));
  }
  return values;
}
