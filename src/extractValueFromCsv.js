import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
 * Parse CSV content and extract the last Empacotamento value for the last complete hour
 * @param {string} csvContent - The CSV file content
 * @returns {number|null} The Empacotamento value or null if not found
 */
function parseCsvAndExtractValue(csvContent) {
  const lines = csvContent.trim().split('\n');
  
  if (lines.length < 2) {
    throw new Error('CSV file appears to be empty or invalid');
  }

  // Skip header line
  const dataLines = lines.slice(1);
  
  // Find all Empacotamento rows (not Estimativa)
  const empacotamentoRows = [];
  
  for (const line of dataLines) {
    // Parse CSV line (handle quoted values with commas)
    const matches = line.match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g);
    if (!matches || matches.length < 3) continue;
    
    const informacao = matches[0].replace(/^"|"$/g, '').trim();
    const dataStr = matches[1].replace(/^"|"$/g, '').trim();
    const valorStr = matches[2].replace(/^"|"$/g, '').trim();
    
    // Only process Empacotamento rows (not Estimativa)
    if (informacao === 'Empacotamento') {
      // Parse date: "06/12/2025, 15:00:00"
      const dateMatch = dataStr.match(/(\d{2})\/(\d{2})\/(\d{4}),\s*(\d{2}):(\d{2}):(\d{2})/);
      if (!dateMatch) continue;
      
      const [, day, month, year, hour, minute, second] = dateMatch;
      const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
      
      if (isNaN(date.getTime())) continue;
      
      const valor = parseFloat(valorStr);
      if (isNaN(valor)) continue;
      
      empacotamentoRows.push({
        date,
        hour: parseInt(hour, 10),
        value: valor
      });
    }
  }
  
  if (empacotamentoRows.length === 0) {
    throw new Error('No Empacotamento rows found in CSV file');
  }
  
  console.log(`Found ${empacotamentoRows.length} Empacotamento rows in CSV`);
  
  // Get last complete hour
  const lastCompleteHour = getLastCompleteHour();
  console.log(`Last complete hour: ${lastCompleteHour}:00`);
  
  // Filter for last complete hour or earlier, sort by date descending
  const validRows = empacotamentoRows
    .filter(row => row.hour <= lastCompleteHour)
    .sort((a, b) => b.date - a.date);
  
  if (validRows.length === 0) {
    // Fallback: use most recent Empacotamento value
    console.log('No rows found for last complete hour, using most recent Empacotamento value');
    const mostRecent = empacotamentoRows.sort((a, b) => b.date - a.date)[0];
    console.log(`Using most recent: ${mostRecent.value} from hour ${mostRecent.hour}:00`);
    return mostRecent.value;
  }
  
  // Return the most recent value for the last complete hour
  const selectedRow = validRows[0];
  console.log(`Selected Empacotamento value: ${selectedRow.value.toLocaleString('pt-BR')} from hour ${selectedRow.hour}:00`);
  
  return selectedRow.value;
}

/**
 * Extract the current Empacotamento value from CSV file downloaded from the website
 * @param {string} url - The URL to extract the value from
 * @returns {Promise<number>} The Empacotamento value for the last complete hour as a number
 */
export async function extractCurrentValueFromCsv(url) {
  let browser = null;
  let downloadedFilePath = null;
  
  try {
    console.log('Launching browser to download CSV...');
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    const page = await browser.newPage();
    
    // Set download behavior
    const client = await page.target().createCDPSession();
    const downloadPath = path.join(__dirname, '..');
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadPath
    });
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log(`Navigating to ${url}...`);
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for page to load
    console.log('Waiting for page to load...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Method 1: Monitor network requests for CSV files first
    console.log('Monitoring network requests for CSV files...');
    let csvContent = null;
    let csvUrl = null;
    
    page.on('response', async response => {
      const responseUrl = response.url();
      const contentType = response.headers()['content-type'] || '';
      
      if (responseUrl.includes('.csv') || 
          contentType.includes('csv') || 
          contentType.includes('text/csv') ||
          (responseUrl.includes('download') && contentType.includes('text')) ||
          (responseUrl.includes('export') && contentType.includes('text'))) {
        try {
          const text = await response.text();
          if (text.includes('Empacotamento') && text.includes('Informação,Data,Valor')) {
            csvContent = text;
            csvUrl = responseUrl;
            console.log(`Captured CSV content from: ${responseUrl}`);
          }
        } catch (e) {
          // Ignore errors reading response
        }
      }
    });
    
    // Method 2: Try to find and click a CSV download button/link
    console.log('Looking for CSV download button/link...');
    let csvDownloaded = false;
    
    // Try various selectors for download buttons
    const downloadSelectors = [
      'a[href*=".csv"]',
      'a[href*="csv"]',
      '[data-download="csv"]',
      '[class*="download"]',
      '[class*="export"]',
      'a[download*=".csv"]',
      'a[download]'
    ];
    
    // Also search for buttons/links by text content
    const textBasedElements = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      return elements
        .filter(el => {
          const text = (el.textContent || '').toLowerCase();
          return text.includes('csv') || 
                 text.includes('download') || 
                 text.includes('exportar') ||
                 text.includes('baixar') ||
                 (el.href && el.href.includes('.csv'));
        })
        .map(el => ({
          tag: el.tagName,
          href: el.href || '',
          text: el.textContent?.trim() || '',
          id: el.id || '',
          className: el.className || ''
        }));
    });
    
    console.log(`Found ${textBasedElements.length} potential download elements`);
    
    for (const elementInfo of textBasedElements) {
      try {
        const selector = elementInfo.id ? `#${elementInfo.id}` : 
                        elementInfo.className ? `.${elementInfo.className.split(' ')[0]}` : null;
        
        if (selector) {
          const element = await page.$(selector);
          if (element) {
            console.log(`Found download element: ${elementInfo.text.substring(0, 50)}`);
            
            // If it's a link with CSV href, navigate directly
            if (elementInfo.href && elementInfo.href.includes('.csv')) {
              console.log(`Found CSV link: ${elementInfo.href}`);
              const response = await page.goto(elementInfo.href, { waitUntil: 'networkidle2', timeout: 30000 });
              if (response && response.ok()) {
                csvDownloaded = true;
                break;
              }
            } else {
              // Click the element
              await element.click();
              await new Promise(resolve => setTimeout(resolve, 3000));
              if (csvContent) {
                csvDownloaded = true;
                break;
              }
            }
          }
        }
      } catch (e) {
        // Continue to next element
      }
    }
    
    // Also try direct selectors
    for (const selector of downloadSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          console.log(`Found download element with selector: ${selector}`);
          
          // Get the href if it's a link
          const href = await page.evaluate(el => el.href, element);
          if (href && href.includes('.csv')) {
            console.log(`Found CSV link: ${href}`);
            const response = await page.goto(href, { waitUntil: 'networkidle2', timeout: 30000 });
            if (response && response.ok()) {
              csvDownloaded = true;
              break;
            }
          } else {
            // Click the button
            await element.click();
            await new Promise(resolve => setTimeout(resolve, 3000));
            if (csvContent) {
              csvDownloaded = true;
              break;
            }
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    
    // Method 2: Try to construct CSV URL based on filename pattern
    if (!csvDownloaded) {
      console.log('Trying to construct CSV URL from filename pattern...');
      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      
      const possibleUrls = [
        `${url}/empacotamento_${dateStr}_${timeStr}.csv`,
        `${url}/download/empacotamento_${dateStr}_${timeStr}.csv`,
        `${url}/export/empacotamento_${dateStr}_${timeStr}.csv`,
        `${url}/api/export/csv`,
        `${url.replace('/empacotamento', '')}/api/empacotamento/export.csv`
      ];
      
      for (const csvUrl of possibleUrls) {
        try {
          console.log(`Trying CSV URL: ${csvUrl}`);
          const response = await page.goto(csvUrl, { waitUntil: 'networkidle2', timeout: 10000 });
          if (response && response.ok()) {
            const contentType = response.headers()['content-type'] || '';
            if (contentType.includes('csv') || contentType.includes('text')) {
              console.log(`Successfully accessed CSV at: ${csvUrl}`);
              csvDownloaded = true;
              break;
            }
          }
        } catch (e) {
          // Continue to next URL
        }
      }
    }
    
    // Method 3: Try to construct CSV URL based on filename pattern
    if (!csvContent && !csvDownloaded) {
      console.log('Trying to construct CSV URL from filename pattern...');
      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      
      const possibleUrls = [
        `${url}/empacotamento_${dateStr}_${timeStr}.csv`,
        `${url}/download/empacotamento_${dateStr}_${timeStr}.csv`,
        `${url}/export/empacotamento_${dateStr}_${timeStr}.csv`,
        `${url}/api/export/csv`,
        `${url.replace('/empacotamento', '')}/api/empacotamento/export.csv`,
        `https://api-mago-prod-lb.ntag.com.br/api/empacotamento/export.csv`
      ];
      
      for (const csvUrl of possibleUrls) {
        try {
          console.log(`Trying CSV URL: ${csvUrl}`);
          const response = await page.goto(csvUrl, { waitUntil: 'networkidle2', timeout: 10000 });
          if (response && response.ok()) {
            const contentType = response.headers()['content-type'] || '';
            const responseText = await response.text();
            if ((contentType.includes('csv') || contentType.includes('text')) && 
                responseText.includes('Empacotamento') && responseText.includes('Informação,Data,Valor')) {
              console.log(`Successfully accessed CSV at: ${csvUrl}`);
              csvContent = responseText;
              csvDownloaded = true;
              break;
            }
          }
        } catch (e) {
          // Continue to next URL
        }
      }
    }
    
    // Wait a bit for any downloads to complete or responses to arrive
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // If we captured CSV content from network response, use it
    if (csvContent) {
      console.log('Using CSV content captured from network response');
      return parseCsvAndExtractValue(csvContent);
    }
    
    // Look for downloaded CSV file
    const downloadDir = downloadPath;
    let csvFiles = [];
    try {
      const files = fs.readdirSync(downloadDir);
      csvFiles = files.filter(f => f.endsWith('.csv') && (f.toLowerCase().includes('empacotamento') || f.toLowerCase().includes('csv')));
    } catch (e) {
      // Directory might not exist or be readable
    }
    
    if (csvFiles.length > 0) {
      // Use the most recently downloaded CSV file
      downloadedFilePath = path.join(downloadDir, csvFiles.sort().reverse()[0]);
      console.log(`Found CSV file: ${downloadedFilePath}`);
      
      // Read and parse CSV
      const fileContent = fs.readFileSync(downloadedFilePath, 'utf8');
      const value = parseCsvAndExtractValue(fileContent);
      
      // Clean up downloaded file
      try {
        fs.unlinkSync(downloadedFilePath);
        console.log('Cleaned up downloaded CSV file');
      } catch (e) {
        // Ignore cleanup errors
      }
      
      return value;
    }
    
    // Try to get CSV content directly from page if it was loaded
    console.log('No CSV file found, trying to extract from page...');
    const pageCsvContent = await page.evaluate(() => {
      // Look for CSV data in page content or JavaScript variables
      if (window.csvData) return window.csvData;
      if (window.empacotamentoCsv) return window.empacotamentoCsv;
      
      // Try to find CSV in script tags
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const script of scripts) {
        const content = script.textContent || '';
        if (content.includes('Empacotamento') && content.includes('Informação,Data,Valor')) {
          // Extract CSV content from script
          const match = content.match(/Informação,Data,Valor[\s\S]*?(?=\n\n|\n<\/script|$)/);
          if (match) return match[0];
        }
      }
      return null;
    });
    
    if (pageCsvContent) {
      console.log('Found CSV content in page');
      return parseCsvAndExtractValue(pageCsvContent);
    }
    
    throw new Error('Could not download or access CSV file. Please verify the website has a CSV download option.');

  } catch (error) {
    console.error('Error extracting value from CSV:', error.message || error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
