import puppeteer from 'puppeteer';

/**
 * Extracts the current "Valor atual" value from the graph page
 * This function parses the DOM to find the current value displayed on the graph
 * @param {string} url - The URL to extract the value from
 * @returns {Promise<number>} The current value as a number
 */
export async function extractCurrentValue(url) {
  let browser = null;
  
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
    
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for page to fully load
    await page.waitForTimeout(3000);

    // Try multiple strategies to extract the value
    // Strategy 1: Look for text containing "TAG:" followed by a number
    console.log('Attempting to extract value from DOM...');
    
    // Based on the screenshot, the value appears in text like "18h - TAG: 66.445.145"
    // We'll look for the most recent TAG value or the current displayed value
    
    // Try to find the current value from the graph or recent data points
    const extractionResult = await page.evaluate(() => {
      const allText = document.body.innerText;
      const debug = {
        pageText: allText.substring(0, 500), // First 500 chars for debugging
        tagMatches: [],
        numberMatches: []
      };
      
      // Strategy 1: Look for text containing "TAG:" which seems to be the format
      const tagMatches = allText.match(/TAG:\s*([\d.]+)/g);
      debug.tagMatches = tagMatches || [];
      
      if (tagMatches && tagMatches.length > 0) {
        // Get the most recent one (last match)
        const lastMatch = tagMatches[tagMatches.length - 1];
        const numberStr = lastMatch.match(/TAG:\s*([\d.]+)/)[1];
        return { value: numberStr, strategy: 'TAG pattern', debug };
      }
      
      // Strategy 2: Look for patterns like "66.445.145" or "66,445,145" (with dots or commas as thousands separators)
      const dotPattern = allText.match(/\b(\d{1,3}(?:\.\d{3}){2,})\b/g);
      const commaPattern = allText.match(/\b(\d{1,3}(?:,\d{3}){2,})\b/g);
      const allNumberPatterns = [...(dotPattern || []), ...(commaPattern || [])];
      debug.numberMatches = allNumberPatterns.slice(0, 10); // First 10 for debugging
      
      if (allNumberPatterns.length > 0) {
        // Filter for numbers that look like millions (6-9 digits)
        for (let match of allNumberPatterns.reverse()) {
          const cleaned = match.replace(/\./g, '').replace(/,/g, '');
          const num = parseFloat(cleaned);
          if (num >= 50000000 && num <= 80000000) {
            return { value: cleaned, strategy: 'number pattern', debug };
          }
        }
      }
      
      // Strategy 3: Look for any large number in the expected range
      const numberMatches = allText.match(/\b(\d{8,9})\b/g);
      if (numberMatches) {
        for (let match of numberMatches.reverse()) {
          const num = parseFloat(match);
          if (num >= 50000000 && num <= 80000000) {
            return { value: match, strategy: 'large number', debug };
          }
        }
      }
      
      return { value: null, strategy: 'none', debug };
    });
    
    // Log debug information if extraction failed
    if (!extractionResult.value) {
      console.error('Value extraction failed. Debug info:');
      console.error('Strategy attempted:', extractionResult.strategy);
      console.error('Page text sample:', extractionResult.debug.pageText);
      console.error('TAG matches found:', extractionResult.debug.tagMatches.length);
      console.error('Number patterns found:', extractionResult.debug.numberMatches.length);
    }
    
    const valueText = extractionResult.value;

    if (!valueText) {
      throw new Error('Could not extract value from page. The page structure may have changed or the value is not displayed in the expected format.');
    }

    // Convert to number (remove dots used as thousands separators)
    const numericValue = parseFloat(valueText.replace(/\./g, '').replace(',', '.'));
    
    if (isNaN(numericValue)) {
      throw new Error(`Extracted value "${valueText}" could not be converted to number`);
    }

    console.log(`Extracted value: ${numericValue.toLocaleString('pt-BR')}`);
    return numericValue;

  } catch (error) {
    console.error('Error extracting value:', error.message || error);
    if (error.name === 'TimeoutError') {
      throw new Error(`Timeout while loading ${url} to extract value. The website may be slow or unreachable.`);
    }
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

