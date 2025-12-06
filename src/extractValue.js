import puppeteer from 'puppeteer';

/**
 * Extracts the last complete hour's "Empacotamento" (hard number) value from the graph page
 * Uses XHR interception to capture the JSON data loaded by the page
 * @param {string} url - The URL to extract the value from
 * @returns {Promise<number>} The Empacotamento value for the last complete hour as a number
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
      // Look for the actual data file (not the list of files)
      if (url.includes('api/s3/object') && url.includes('EMPACOTAMENTOS') && url.includes('.json')) {
        try {
          const text = await response.text();
          const parsed = JSON.parse(text);
          
          // Check if this is the actual data file (has Items array)
          if (parsed.Items && Array.isArray(parsed.Items)) {
            // Check if it has real data (not just "No Data" values)
            const hasRealData = parsed.Items.some(item => 
              item.Value && 
              typeof item.Value.Value === 'number' && 
              item.Value.Value > 1000000 // Real data, not "No Data" (248)
            );
            
            if (hasRealData) {
              // This has real data, use it
              jsonData = parsed;
              console.log('Captured JSON data with real values from:', url);
              console.log(`  Items with real data: ${parsed.Items.filter(i => i.Value && typeof i.Value.Value === 'number' && i.Value.Value > 1000000).length}`);
            } else if (!jsonData) {
              // No real data yet, but save it as fallback
              jsonData = parsed;
              console.log('Captured JSON data (no real values yet) from:', url);
            }
          }
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

    // Wait for the data to be loaded - need longer wait for dynamic data
    console.log('Waiting for data to load...');
    
    // Wait for network to be idle (Puppeteer method)
    await page.waitForLoadState?.('networkidle').catch(() => {});
    
    // Additional wait for data to populate (30 seconds total)
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    // Check if we have real data, if not the data might not be available yet
    if (jsonData && jsonData.Items) {
      const hasRealData = jsonData.Items.some(item => 
        item.Value && 
        typeof item.Value.Value === 'number' && 
        item.Value.Value > 1000000
      );
      if (!hasRealData) {
        console.log('WARNING: No real data found in captured JSON. Data may still be loading or unavailable.');
      }
    }

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

    console.log('=== JSON Structure Analysis ===');
    console.log('JSON data structure keys:', Object.keys(jsonData));
    
    // Log sample of JSON structure
    if (Array.isArray(jsonData)) {
      console.log(`JSON is an array with ${jsonData.length} items`);
      if (jsonData.length > 0) {
        console.log('First item sample:', JSON.stringify(jsonData[0], null, 2).substring(0, 500));
        console.log('Last item sample:', JSON.stringify(jsonData[jsonData.length - 1], null, 2).substring(0, 500));
      }
    } else if (jsonData.data && Array.isArray(jsonData.data)) {
      console.log(`JSON has data array with ${jsonData.data.length} items`);
      if (jsonData.data.length > 0) {
        console.log('First data item sample:', JSON.stringify(jsonData.data[0], null, 2).substring(0, 500));
        console.log('Last data item sample:', JSON.stringify(jsonData.data[jsonData.data.length - 1], null, 2).substring(0, 500));
      }
    } else if (jsonData.series && Array.isArray(jsonData.series)) {
      console.log(`JSON has series array with ${jsonData.series.length} items`);
      jsonData.series.forEach((s, idx) => {
        console.log(`Series ${idx}: name="${s.name}", id="${s.id}", data length=${s.data?.length || 0}`);
      });
    }
    
    // Extract the Empacotamento value from the JSON
    // The JSON structure is expected to have data points with Empacotamento values
    const empacotamentoValue = extractEmpacotamentoFromJson(jsonData);
    
    if (!empacotamentoValue) {
      throw new Error('Could not find Empacotamento value in the JSON data');
    }

    console.log(`=== Extracted Empacotamento value: ${empacotamentoValue.toLocaleString('pt-BR')} ===`);
    return empacotamentoValue;

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
 * Calculate the last complete hour based on current time
 * Complete hour = most recent hour that has fully passed
 * @returns {number} The last complete hour (0-23)
 */
function getLastCompleteHour() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  
  // If we're at the start of an hour (minute 0), that hour is complete
  // Otherwise, the last complete hour is the previous hour
  if (currentMinute === 0) {
    return currentHour;
  } else {
    return currentHour - 1;
  }
}

/**
 * Check if a field name or value is related to Estimativa (should be excluded)
 * @param {string} fieldName - The field name to check
 * @param {*} value - The value to check (optional)
 * @returns {boolean} True if this is an Estimativa field/value
 */
function isEstimativaField(fieldName, value = null) {
  const lowerName = fieldName.toLowerCase();
  if (lowerName.includes('estimativa')) {
    return true;
  }
  // Additional checks if needed
  return false;
}

/**
 * Extract the last complete hour's Empacotamento (hard number) value from the JSON data
 * @param {Object} jsonData - The JSON data from the API
 * @returns {number|null} The Empacotamento value for the last complete hour or null if not found
 */
function extractEmpacotamentoFromJson(jsonData) {
  try {
    console.log('\n=== Starting Empacotamento Extraction ===');
    
    const lastCompleteHour = getLastCompleteHour();
    const now = new Date();
    console.log(`Current time: ${now.toLocaleString('pt-BR')}`);
    console.log(`Last complete hour: ${lastCompleteHour}:00`);
    
    // Track all values found for debugging
    const allEmpacotamentoValues = [];
    const allEstimativaValues = [];
    
    // NEW STRUCTURE: Handle Items array with Tag/Timestamp/Value structure
    // This is the actual structure from the API
    if (jsonData.Items && Array.isArray(jsonData.Items)) {
      console.log(`\n[Structure Items] JSON has Items array with ${jsonData.Items.length} items`);
      
      // First, let's see what tags we have
      const uniqueTags = [...new Set(jsonData.Items.map(i => i.Tag).filter(Boolean))];
      console.log(`Unique tags found: ${uniqueTags.length}`);
      const empacotamentoRelatedTags = uniqueTags.filter(t => t.toLowerCase().includes('empacotamento'));
      console.log(`Tags containing 'empacotamento': ${empacotamentoRelatedTags.join(', ')}`);
      
      // Find items with Empacotamento tag (but NOT Previsao/Estimativa)
      // Also exclude any tag that contains "Previsao" (which means Forecast/Estimate)
      const empacotamentoItems = jsonData.Items.filter(item => {
        if (!item.Tag || !item.Timestamp || !item.Value) return false;
        const tagLower = item.Tag.toLowerCase();
        // Exclude Previsao (Forecast/Estimate) - this is Estimativa
        if (tagLower.includes('previsao')) {
          allEstimativaValues.push({ tag: item.Tag, value: item.Value.Value, timestamp: item.Timestamp });
          return false;
        }
        // Look for EMPACOTAMENTO but exclude Previsao (which is Estimativa)
        return tagLower.includes('empacotamento');
      });
      
      console.log(`Found ${empacotamentoItems.length} items with Empacotamento tag (excluding Previsao)`);
      
      if (empacotamentoItems.length > 0) {
        // Filter for last complete hour and valid values
        const validItems = empacotamentoItems.filter(item => {
          const ts = new Date(item.Timestamp);
          if (isNaN(ts.getTime())) return false;
          
          const itemHour = ts.getHours();
          const itemValue = item.Value && typeof item.Value.Value === 'number' ? item.Value.Value : null;
          
          // Must have valid numeric value in expected range
          if (!itemValue || itemValue < 50000000 || itemValue > 80000000) return false;
          
          // Must be from last complete hour or earlier
          if (itemHour > lastCompleteHour) return false;
          
          // Prefer Good data, but accept any if no Good data available
          return true;
        });
        
        if (validItems.length > 0) {
          // Sort by timestamp descending (most recent first)
          validItems.sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));
          
          // Prefer Good data
          const goodItems = validItems.filter(i => i.Good === true);
          const selectedItem = goodItems.length > 0 ? goodItems[0] : validItems[0];
          
          const ts = new Date(selectedItem.Timestamp);
          console.log(`\n[Structure Items] Selected Empacotamento value: ${selectedItem.Value.Value}`);
          console.log(`Tag: ${selectedItem.Tag}`);
          console.log(`Timestamp: ${selectedItem.Timestamp} (hour: ${ts.getHours()})`);
          console.log(`Good: ${selectedItem.Good}`);
          
          return selectedItem.Value.Value;
        } else {
          console.log('No valid Empacotamento items found for last complete hour');
          // Fallback: get most recent valid Empacotamento item
          const recentItems = empacotamentoItems
            .filter(item => {
              const itemValue = item.Value && typeof item.Value.Value === 'number' ? item.Value.Value : null;
              return itemValue && itemValue >= 50000000 && itemValue <= 80000000;
            })
            .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));
          
          if (recentItems.length > 0) {
            const selected = recentItems[0];
            const ts = new Date(selected.Timestamp);
            console.log(`\n[Structure Items Fallback] Using most recent Empacotamento: ${selected.Value.Value}`);
            console.log(`Tag: ${selected.Tag}, Timestamp: ${selected.Timestamp} (hour: ${ts.getHours()})`);
            return selected.Value.Value;
          }
        }
      }
      
      // Also check for MALHA-INT-1MIN tag (might be the actual Empacotamento)
      const malhaItems = jsonData.Items.filter(item => {
        if (!item.Tag || !item.Timestamp || !item.Value) return false;
        return item.Tag === 'MALHA-INT-1MIN' && item.Good === true;
      });
      
      if (malhaItems.length > 0) {
        console.log(`Found ${malhaItems.length} MALHA-INT-1MIN items`);
        const validMalha = malhaItems
          .filter(item => {
            const ts = new Date(item.Timestamp);
            if (isNaN(ts.getTime())) return false;
            const itemHour = ts.getHours();
            const itemValue = item.Value && typeof item.Value.Value === 'number' ? item.Value.Value : null;
            return itemValue && itemValue >= 50000000 && itemValue <= 80000000 && itemHour <= lastCompleteHour;
          })
          .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));
        
        if (validMalha.length > 0) {
          const selected = validMalha[0];
          const ts = new Date(selected.Timestamp);
          console.log(`\n[Structure Items MALHA] Selected value: ${selected.Value.Value}`);
          console.log(`Timestamp: ${selected.Timestamp} (hour: ${ts.getHours()})`);
          return selected.Value.Value;
        }
      }
    }
    
    // Structure 1: Array of data points with empacotamento field
    if (Array.isArray(jsonData)) {
      console.log(`\n[Structure 1] JSON is an array with ${jsonData.length} items`);
      
      // Log sample of field names from first and last items
      if (jsonData.length > 0) {
        const firstItem = jsonData[0];
        const lastItem = jsonData[jsonData.length - 1];
        console.log('First item field names:', Object.keys(firstItem));
        console.log('Last item field names:', Object.keys(lastItem));
        
        // Show Empacotamento vs Estimativa in sample items
        const firstItemKeys = Object.keys(firstItem);
        const empacotamentoKeys = firstItemKeys.filter(k => k.toLowerCase().includes('empacotamento') && !isEstimativaField(k));
        const estimativaKeys = firstItemKeys.filter(k => isEstimativaField(k));
        console.log('Empacotamento fields found:', empacotamentoKeys);
        console.log('Estimativa fields found:', estimativaKeys);
      }
      
      // Filter for data points with valid Empacotamento values and complete hours
      const validDataPoints = [];
      for (let i = jsonData.length - 1; i >= 0; i--) {
        const item = jsonData[i];
        if (!item || typeof item !== 'object') continue;
        
        // Skip items that have Estimativa fields with values (exclude them)
        const hasEstimativaValue = Object.keys(item).some(k => 
          isEstimativaField(k) && item[k] !== null && item[k] !== undefined
        );
        if (hasEstimativaValue) {
          const estimativaKey = Object.keys(item).find(k => isEstimativaField(k));
          if (estimativaKey && typeof item[estimativaKey] === 'number') {
            allEstimativaValues.push({ index: i, value: item[estimativaKey], hour: item.hour || item.hora || null });
          }
          continue; // Skip this item
        }
        
        // Look for empacotamento field
        const empacotamentoKey = Object.keys(item).find(k => 
          k.toLowerCase().includes('empacotamento') && 
          !isEstimativaField(k)
        );
        
        if (empacotamentoKey && typeof item[empacotamentoKey] === 'number' && !isNaN(item[empacotamentoKey])) {
          // Check if we have hour/timestamp information
          let itemHour = null;
          if (item.hour !== undefined) {
            itemHour = item.hour;
          } else if (item.hora !== undefined) {
            itemHour = item.hora;
          } else if (item.timestamp) {
            const date = new Date(item.timestamp);
            if (!isNaN(date.getTime())) {
              itemHour = date.getHours();
            }
          } else if (item.time) {
            const date = new Date(item.time);
            if (!isNaN(date.getTime())) {
              itemHour = date.getHours();
            }
          }
          
          allEmpacotamentoValues.push({ index: i, value: item[empacotamentoKey], hour: itemHour });
          
          // If we have hour info, filter by complete hour
          if (itemHour !== null) {
            if (itemHour <= lastCompleteHour) {
              validDataPoints.push({ hour: itemHour, value: item[empacotamentoKey], index: i });
              console.log(`  Found valid Empacotamento at index ${i}: value=${item[empacotamentoKey]}, hour=${itemHour}`);
            } else {
              console.log(`  Skipped Empacotamento at index ${i}: hour ${itemHour} > lastCompleteHour ${lastCompleteHour}`);
            }
          } else {
            // No hour info, add to valid points (will use most recent)
            validDataPoints.push({ hour: null, value: item[empacotamentoKey], index: i });
            console.log(`  Found Empacotamento at index ${i} (no hour info): value=${item[empacotamentoKey]}`);
          }
        }
      }
      
      console.log(`\nTotal Empacotamento values found: ${allEmpacotamentoValues.length}`);
      console.log(`Total Estimativa values found: ${allEstimativaValues.length}`);
      if (allEstimativaValues.length > 0) {
        console.log('Estimativa values (excluded):', allEstimativaValues.slice(0, 5).map(v => `${v.value}@hour${v.hour}`));
      }
      
      if (validDataPoints.length > 0) {
        // Sort by hour (descending), null hours go to end
        validDataPoints.sort((a, b) => {
          if (a.hour === null) return 1;
          if (b.hour === null) return -1;
          return b.hour - a.hour;
        });
        
        const selectedPoint = validDataPoints[0];
        console.log(`\n[Structure 1] Selected Empacotamento value: ${selectedPoint.value} for hour: ${selectedPoint.hour !== null ? selectedPoint.hour : 'unknown'} (index: ${selectedPoint.index})`);
        return selectedPoint.value;
      }
      
      // Fallback: try to get last item with empacotamento field (but not Estimativa)
      const lastItem = jsonData[jsonData.length - 1];
      if (lastItem) {
        console.log('Trying fallback: last item');
        const empacotamentoKey = Object.keys(lastItem).find(k => 
          k.toLowerCase().includes('empacotamento') && 
          !isEstimativaField(k)
        );
        if (empacotamentoKey && typeof lastItem[empacotamentoKey] === 'number') {
          console.log(`[Structure 1 Fallback] Using last item Empacotamento: ${lastItem[empacotamentoKey]}`);
          return lastItem[empacotamentoKey];
        }
      }
    }
    
    // Structure 2: Object with data/series arrays
    if (jsonData.data && Array.isArray(jsonData.data)) {
      console.log(`\n[Structure 2] JSON has data array with ${jsonData.data.length} items`);
      
      // Filter for complete hour data points
      const validDataPoints = [];
      for (let i = jsonData.data.length - 1; i >= 0; i--) {
        const item = jsonData.data[i];
        if (!item || typeof item !== 'object') continue;
        
        // Skip if has Estimativa value
        if (item.estimativa !== undefined || item.Estimativa !== undefined) {
          const estimativaValue = item.estimativa || item.Estimativa;
          if (typeof estimativaValue === 'number') {
            allEstimativaValues.push({ index: i, value: estimativaValue });
          }
          // Don't skip entirely - might have both fields
        }
        
        if (item.empacotamento !== undefined && typeof item.empacotamento === 'number' && !isNaN(item.empacotamento)) {
          let itemHour = null;
          if (item.hour !== undefined) itemHour = item.hour;
          else if (item.hora !== undefined) itemHour = item.hora;
          else if (item.timestamp) {
            const date = new Date(item.timestamp);
            if (!isNaN(date.getTime())) {
              itemHour = date.getHours();
            }
          }
          
          allEmpacotamentoValues.push({ index: i, value: item.empacotamento, hour: itemHour });
          
          if (itemHour !== null && itemHour <= lastCompleteHour) {
            validDataPoints.push({ hour: itemHour, value: item.empacotamento, index: i });
            console.log(`  Found valid Empacotamento at index ${i}: value=${item.empacotamento}, hour=${itemHour}`);
          } else if (itemHour === null) {
            validDataPoints.push({ hour: null, value: item.empacotamento, index: i });
            console.log(`  Found Empacotamento at index ${i} (no hour info): value=${item.empacotamento}`);
          }
        } else if (item.Empacotamento !== undefined && typeof item.Empacotamento === 'number' && !isNaN(item.Empacotamento)) {
          let itemHour = null;
          if (item.hour !== undefined) itemHour = item.hour;
          else if (item.hora !== undefined) itemHour = item.hora;
          else if (item.timestamp) {
            const date = new Date(item.timestamp);
            if (!isNaN(date.getTime())) {
              itemHour = date.getHours();
            }
          }
          
          allEmpacotamentoValues.push({ index: i, value: item.Empacotamento, hour: itemHour });
          
          if (itemHour !== null && itemHour <= lastCompleteHour) {
            validDataPoints.push({ hour: itemHour, value: item.Empacotamento, index: i });
            console.log(`  Found valid Empacotamento at index ${i}: value=${item.Empacotamento}, hour=${itemHour}`);
          } else if (itemHour === null) {
            validDataPoints.push({ hour: null, value: item.Empacotamento, index: i });
            console.log(`  Found Empacotamento at index ${i} (no hour info): value=${item.Empacotamento}`);
          }
        }
      }
      
      console.log(`Total Empacotamento values found: ${allEmpacotamentoValues.length}`);
      console.log(`Total Estimativa values found: ${allEstimativaValues.length}`);
      
      if (validDataPoints.length > 0) {
        validDataPoints.sort((a, b) => {
          if (a.hour === null) return 1;
          if (b.hour === null) return -1;
          return b.hour - a.hour;
        });
        const selected = validDataPoints[0];
        console.log(`\n[Structure 2] Selected Empacotamento value: ${selected.value} for hour: ${selected.hour !== null ? selected.hour : 'unknown'} (index: ${selected.index})`);
        return selected.value;
      }
      
      // Fallback: get last item (but prefer Empacotamento over Estimativa)
      const lastItem = jsonData.data[jsonData.data.length - 1];
      if (lastItem) {
        if (lastItem.empacotamento !== undefined && typeof lastItem.empacotamento === 'number') {
          console.log(`[Structure 2 Fallback] Using last item empacotamento: ${lastItem.empacotamento}`);
          return lastItem.empacotamento;
        }
        if (lastItem.Empacotamento !== undefined && typeof lastItem.Empacotamento === 'number') {
          console.log(`[Structure 2 Fallback] Using last item Empacotamento: ${lastItem.Empacotamento}`);
          return lastItem.Empacotamento;
        }
      }
    }
    
    // Structure 3: Object with empacotamento array
    if (jsonData.empacotamento && Array.isArray(jsonData.empacotamento)) {
      console.log(`\n[Structure 3] JSON has empacotamento array with ${jsonData.empacotamento.length} items`);
      
      // Try to find value for last complete hour
      for (let i = jsonData.empacotamento.length - 1; i >= 0; i--) {
        const item = jsonData.empacotamento[i];
        if (typeof item === 'number' && !isNaN(item)) {
          console.log(`[Structure 3] Using value at index ${i}: ${item}`);
          return item;
        }
        if (item && typeof item.value === 'number') {
          console.log(`[Structure 3] Using item.value at index ${i}: ${item.value}`);
          return item.value;
        }
        if (item && typeof item.y === 'number') {
          console.log(`[Structure 3] Using item.y at index ${i}: ${item.y}`);
          return item.y;
        }
      }
    }
    
    // Structure 4: Object with Empacotamento array (capitalized)
    if (jsonData.Empacotamento && Array.isArray(jsonData.Empacotamento)) {
      console.log(`\n[Structure 4] JSON has Empacotamento array with ${jsonData.Empacotamento.length} items`);
      
      for (let i = jsonData.Empacotamento.length - 1; i >= 0; i--) {
        const item = jsonData.Empacotamento[i];
        if (typeof item === 'number' && !isNaN(item)) {
          console.log(`[Structure 4] Using value at index ${i}: ${item}`);
          return item;
        }
        if (item && typeof item.value === 'number') {
          console.log(`[Structure 4] Using item.value at index ${i}: ${item.value}`);
          return item.value;
        }
        if (item && typeof item.y === 'number') {
          console.log(`[Structure 4] Using item.y at index ${i}: ${item.y}`);
          return item.y;
        }
      }
    }
    
    // Structure 5: Object with series containing empacotamento
    if (jsonData.series && Array.isArray(jsonData.series)) {
      console.log(`\n[Structure 5] JSON has series array with ${jsonData.series.length} items`);
      
      // Find Empacotamento series (exclude Estimativa)
      const empacotamentoSeries = jsonData.series.find(s => {
        const name = s.name?.toLowerCase() || '';
        const id = s.id?.toLowerCase() || '';
        return (name.includes('empacotamento') && !name.includes('estimativa')) ||
               (id.includes('empacotamento') && !id.includes('estimativa'));
      });
      
      if (empacotamentoSeries) {
        console.log(`Found Empacotamento series: name="${empacotamentoSeries.name}", id="${empacotamentoSeries.id}"`);
        if (Array.isArray(empacotamentoSeries.data)) {
          console.log(`Series data length: ${empacotamentoSeries.data.length}`);
          
          // Filter for complete hour data
          const validDataPoints = [];
          for (let i = empacotamentoSeries.data.length - 1; i >= 0; i--) {
            const item = empacotamentoSeries.data[i];
            if (typeof item === 'number' && !isNaN(item)) {
              validDataPoints.push({ hour: null, value: item, index: i });
            } else if (item && typeof item.y === 'number' && !isNaN(item.y)) {
              let itemHour = null;
              if (item.x !== undefined) {
                // x might be hour or timestamp
                if (typeof item.x === 'number' && item.x < 24) {
                  itemHour = item.x;
                } else if (item.x) {
                  const date = new Date(item.x);
                  if (!isNaN(date.getTime())) {
                    itemHour = date.getHours();
                  }
                }
              }
              if (itemHour !== null && itemHour <= lastCompleteHour) {
                validDataPoints.push({ hour: itemHour, value: item.y, index: i });
                console.log(`  Found valid Empacotamento at index ${i}: value=${item.y}, hour=${itemHour}`);
              } else if (itemHour === null) {
                validDataPoints.push({ hour: null, value: item.y, index: i });
                console.log(`  Found Empacotamento at index ${i} (no hour info): value=${item.y}`);
              }
            } else if (item && typeof item.value === 'number' && !isNaN(item.value)) {
              validDataPoints.push({ hour: null, value: item.value, index: i });
            }
          }
          
          if (validDataPoints.length > 0) {
            validDataPoints.sort((a, b) => {
              if (a.hour === null) return 1;
              if (b.hour === null) return -1;
              return b.hour - a.hour;
            });
            const selected = validDataPoints[0];
            console.log(`\n[Structure 5] Selected Empacotamento value: ${selected.value} for hour: ${selected.hour !== null ? selected.hour : 'unknown'} (index: ${selected.index})`);
            return selected.value;
          }
        }
      } else {
        console.log('No Empacotamento series found (only Estimativa or other series)');
      }
    }
    
    // Structure 6: Direct empacotamento value
    if (typeof jsonData.empacotamento === 'number' && !isNaN(jsonData.empacotamento)) {
      console.log(`\n[Structure 6] Using direct empacotamento value: ${jsonData.empacotamento}`);
      return jsonData.empacotamento;
    }
    if (typeof jsonData.Empacotamento === 'number' && !isNaN(jsonData.Empacotamento)) {
      console.log(`\n[Structure 6] Using direct Empacotamento value: ${jsonData.Empacotamento}`);
      return jsonData.Empacotamento;
    }
    
    // Structure 7: Look for numeric values in expected range, but ONLY from Empacotamento fields
    // This is a last resort fallback - but we must avoid Estimativa values
    console.log('\n[Structure 7] Searching for numeric values in expected range (fallback - Empacotamento only)...');
    
    // If we have Items structure, search there first and exclude Previsao
    if (jsonData.Items && Array.isArray(jsonData.Items)) {
      const nonPrevisaoItems = jsonData.Items.filter(item => {
        if (!item.Tag || !item.Value || typeof item.Value.Value !== 'number') return false;
        const tagLower = item.Tag.toLowerCase();
        // Exclude Previsao (Forecast/Estimate)
        if (tagLower.includes('previsao')) return false;
        const value = item.Value.Value;
        return value >= 50000000 && value <= 80000000;
      });
      
      if (nonPrevisaoItems.length > 0) {
        // Filter by last complete hour
        const lastCompleteHour = getLastCompleteHour();
        const hourFiltered = nonPrevisaoItems.filter(item => {
          const ts = new Date(item.Timestamp);
          if (isNaN(ts.getTime())) return false;
          return ts.getHours() <= lastCompleteHour;
        });
        
        const itemsToUse = hourFiltered.length > 0 ? hourFiltered : nonPrevisaoItems;
        itemsToUse.sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));
        
        const selected = itemsToUse[0];
        const ts = new Date(selected.Timestamp);
        console.log(`[Structure 7 Items] Found ${nonPrevisaoItems.length} non-Previsao items with values in range`);
        console.log(`Selected: Value=${selected.Value.Value}, Tag=${selected.Tag}, Hour=${ts.getHours()}`);
        return selected.Value.Value;
      }
    }
    
    // First, try to find values that are explicitly from Empacotamento fields
    const empacotamentoValuesFromFields = findNumericValuesFromFields(jsonData, 50000000, 80000000, 'empacotamento');
    if (empacotamentoValuesFromFields.length > 0) {
      console.log(`Found ${empacotamentoValuesFromFields.length} Empacotamento values in range from Empacotamento fields.`);
      console.log('Values found:', empacotamentoValuesFromFields.slice(0, 10).map(v => v.value));
      const selectedValue = empacotamentoValuesFromFields[empacotamentoValuesFromFields.length - 1].value;
      console.log(`[Structure 7] Using Empacotamento value from field: ${selectedValue}`);
      return selectedValue;
    }
    
    // If no Empacotamento field values found, DO NOT fall back to generic search
    // This would include Estimativa values
    console.log('ERROR: No Empacotamento values found. Cannot use generic fallback as it would include Estimativa.');
    console.log('Please check the JSON structure - Empacotamento data may not be available.');
    
    // Log the full structure for debugging
    console.log('\n=== Full JSON structure (first 2000 chars) ===');
    console.log(JSON.stringify(jsonData, null, 2).substring(0, 2000));
    
    return null;
  } catch (error) {
    console.error('Error parsing JSON structure:', error);
    return null;
  }
}

/**
 * Recursively find numeric values in expected range, but only from fields containing "empacotamento"
 * @param {*} obj - The object to search
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @param {string} requiredField - Field name that must be present (e.g., "empacotamento")
 * @param {Array} values - Accumulator for values found
 * @param {string} currentPath - Current path in object (for debugging)
 * @returns {Array} Array of {value, path} objects
 */
function findNumericValuesFromFields(obj, min, max, requiredField, values = [], currentPath = '') {
  if (typeof obj === 'number' && obj >= min && obj <= max) {
    // Check if current path contains the required field
    if (currentPath.toLowerCase().includes(requiredField) && !currentPath.toLowerCase().includes('estimativa')) {
      values.push({ value: obj, path: currentPath });
    }
  } else if (Array.isArray(obj)) {
    obj.forEach((item, idx) => {
      findNumericValuesFromFields(item, min, max, requiredField, values, `${currentPath}[${idx}]`);
    });
  } else if (obj && typeof obj === 'object') {
    Object.entries(obj).forEach(([key, val]) => {
      const newPath = currentPath ? `${currentPath}.${key}` : key;
      // Only recurse into objects/arrays, or if this key contains the required field
      if (typeof val === 'object' || key.toLowerCase().includes(requiredField)) {
        findNumericValuesFromFields(val, min, max, requiredField, values, newPath);
      }
    });
  }
  return values;
}

/**
 * Recursively find numeric values in expected range
 * @param {*} obj - The object to search
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @param {Array} values - Accumulator for values found
 * @returns {Array} Array of numeric values
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
