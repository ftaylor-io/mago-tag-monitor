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
    const valueText = await page.evaluate(() => {
      // Look for text containing "TAG:" which seems to be the format
      const allText = document.body.innerText;
      const tagMatches = allText.match(/TAG:\s*([\d.]+)/g);
      
      if (tagMatches && tagMatches.length > 0) {
        // Get the most recent one (last match)
        const lastMatch = tagMatches[tagMatches.length - 1];
        const numberStr = lastMatch.match(/TAG:\s*([\d.]+)/)[1];
        return numberStr;
      }
      
      // Alternative: Look for large numbers that could be the current value
      // The value is around 60-70 million, so look for numbers in that range
      const numberMatches = allText.match(/\b(\d{1,3}(?:\.\d{3})*(?:,\d+)?)\b/g);
      if (numberMatches) {
        // Filter for numbers that look like millions (6-8 digits before decimal)
        for (let match of numberMatches.reverse()) {
          const cleaned = match.replace(/\./g, '').replace(',', '.');
          const num = parseFloat(cleaned);
          if (num >= 50000000 && num <= 80000000) {
            return cleaned;
          }
        }
      }
      
      return null;
    });

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

