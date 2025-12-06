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
    const csvResponses = [];
    
    page.on('response', async response => {
      const responseUrl = response.url();
      const contentType = response.headers()['content-type'] || '';
      
      if (responseUrl.includes('.csv') || 
          contentType.includes('csv') || 
          contentType.includes('text/csv') ||
          (responseUrl.includes('download') && contentType.includes('text')) ||
          (responseUrl.includes('export') && contentType.includes('text')) ||
          responseUrl.includes('empacotamento')) {
        try {
          const text = await response.text();
          // Check if it's CSV content (might be HTML-wrapped)
          const isCsv = text.includes('Empacotamento') && text.includes('Informação,Data,Valor');
          const mightBeCsv = responseUrl.includes('.csv') || responseUrl.includes('empacotamento');
          
          if (isCsv) {
            csvContent = text;
            csvUrl = responseUrl;
            csvResponses.push({ url: responseUrl, content: text });
            console.log(`Captured CSV content from: ${responseUrl} (${text.length} chars)`);
          } else if (mightBeCsv) {
            console.log(`Response from ${responseUrl} might be CSV. Length: ${text.length}`);
            console.log(`First 500 chars: ${text.substring(0, 500)}`);
            // Try to extract CSV from HTML if wrapped
            const csvMatch = text.match(/Informação,Data,Valor[\s\S]*?(?=<|$)/);
            if (csvMatch) {
              const extracted = csvMatch[0].replace(/<[^>]*>/g, '').trim();
              if (extracted.includes('Empacotamento')) {
                console.log(`Extracted CSV from HTML-wrapped response`);
                csvContent = extracted;
                csvUrl = responseUrl;
                csvDownloaded = true;
              }
            }
          }
        } catch (e) {
          console.log(`Error reading response from ${responseUrl}: ${e.message}`);
        }
      }
    });
    
    // Method 2: Find and interact with format dropdown, then download
    console.log('Looking for format dropdown and download button...');
    let csvDownloaded = false;
    
    // First, try to find and interact with the format dropdown
    console.log('Searching for format dropdown...');
    let csvSelected = false;
    
    try {
      // Try to find dropdown/select elements
      const dropdownInfo = await page.evaluate(() => {
        // Look for native select elements
        const selects = Array.from(document.querySelectorAll('select'));
        for (const select of selects) {
          const options = Array.from(select.options || []);
          const csvOption = options.find(opt => 
            (opt.text || '').toLowerCase().includes('csv') || 
            (opt.value || '').toLowerCase().includes('csv')
          );
          if (csvOption || options.length >= 2) {
            return {
              type: 'select',
              id: select.id || '',
              name: select.name || '',
              className: select.className || '',
              options: options.map(opt => ({
                text: opt.text || '',
                value: opt.value || '',
                index: opt.index
              })),
              csvIndex: csvOption ? csvOption.index : (options.length >= 2 ? 1 : null)
            };
          }
        }
        
        // Look for custom dropdowns (button/menu pattern)
        const dropdownButtons = Array.from(document.querySelectorAll(
          'button[aria-haspopup="listbox"], ' +
          '[role="combobox"], ' +
          'button[aria-expanded], ' +
          '[class*="dropdown"], ' +
          '[class*="select"], ' +
          '[class*="format"]'
        ));
        
        for (const button of dropdownButtons) {
          const text = (button.textContent || '').toLowerCase();
          if (text.includes('xlsx') || text.includes('excel') || text.includes('format') || 
              button.getAttribute('aria-label')?.toLowerCase().includes('format')) {
            return {
              type: 'custom',
              id: button.id || '',
              className: button.className || '',
              text: button.textContent?.trim() || '',
              ariaLabel: button.getAttribute('aria-label') || ''
            };
          }
        }
        
        return null;
      });
      
      if (dropdownInfo) {
        console.log(`Found dropdown: type=${dropdownInfo.type}, csvIndex=${dropdownInfo.csvIndex || 'N/A'}`);
        
        if (dropdownInfo.type === 'select') {
          // Native select element
          const selectSelector = dropdownInfo.id ? `#${dropdownInfo.id}` :
                               dropdownInfo.name ? `select[name="${dropdownInfo.name}"]` :
                               'select';
          
          const selectElement = await page.$(selectSelector);
          if (selectElement) {
            // Select CSV option (second option, index 1, or find by text)
            let csvValue = null;
            if (dropdownInfo.csvIndex !== null) {
              csvValue = dropdownInfo.options[dropdownInfo.csvIndex]?.value;
            } else {
              // Try to find CSV option by text
              const csvOption = dropdownInfo.options.find(opt => 
                opt.text.toLowerCase().includes('csv')
              );
              if (csvOption) {
                csvValue = csvOption.value;
              } else if (dropdownInfo.options.length >= 2) {
                // Fallback: use second option (index 1)
                csvValue = dropdownInfo.options[1].value;
              }
            }
            
            if (csvValue !== null) {
              await page.select(selectSelector, csvValue);
              console.log(`Selected CSV option in dropdown: ${csvValue}`);
              csvSelected = true;
              await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for selection to apply
            } else {
              console.log('Could not determine CSV option value');
            }
          }
        } else if (dropdownInfo.type === 'custom') {
          // Custom dropdown - click to open, then select CSV option
          const dropdownSelector = dropdownInfo.id ? `#${dropdownInfo.id}` :
                                  dropdownInfo.className ? `.${dropdownInfo.className.split(' ')[0]}` : null;
          
          if (dropdownSelector) {
            const dropdownButton = await page.$(dropdownSelector);
            if (dropdownButton) {
              console.log(`Clicking custom dropdown: ${dropdownInfo.text}`);
              await dropdownButton.click();
              await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for menu to open
              
              // Look for CSV option in the opened menu
              const csvOption = await page.evaluate(() => {
                const menuItems = Array.from(document.querySelectorAll(
                  '[role="option"], ' +
                  '[role="menuitem"], ' +
                  'li[role="option"], ' +
                  '.dropdown-item, ' +
                  '.menu-item, ' +
                  '[class*="option"]'
                ));
                
                for (const item of menuItems) {
                  const text = (item.textContent || '').toLowerCase();
                  if (text.includes('csv') && !text.includes('xlsx') && !text.includes('json')) {
                    return {
                      text: item.textContent?.trim() || '',
                      selector: item.id ? `#${item.id}` : null,
                      className: item.className || ''
                    };
                  }
                }
                
                // If no CSV found by text, try second option
                if (menuItems.length >= 2) {
                  return {
                    text: menuItems[1].textContent?.trim() || '',
                    selector: menuItems[1].id ? `#${menuItems[1].id}` : null,
                    className: menuItems[1].className || ''
                  };
                }
                
                return null;
              });
              
              if (csvOption) {
                // Click the CSV option
                if (csvOption.selector) {
                  await page.click(csvOption.selector);
                } else {
                  // Try to click by text
                  await page.evaluate((text) => {
                    const items = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"]'));
                    const item = items.find(i => (i.textContent || '').trim() === text);
                    if (item) item.click();
                  }, csvOption.text);
                }
                console.log(`Selected CSV option: ${csvOption.text}`);
                csvSelected = true;
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for selection to apply
              } else {
                console.log('Could not find CSV option in dropdown menu');
              }
            }
          }
        }
      } else {
        console.log('No format dropdown found - will try to download with default format');
        console.log('Note: Downloaded file may be in Excel format instead of CSV');
      }
    } catch (e) {
      console.log(`Error interacting with dropdown: ${e.message}`);
      console.log('Continuing with download attempt (may result in Excel format)...');
      // Don't set csvSelected to true if there was an error
      csvSelected = false;
    }
    
    // Log final status
    if (csvSelected) {
      console.log('✓ CSV format selected in dropdown');
    } else {
      console.log('⚠ Warning: Could not confirm CSV format selection. Downloaded file may be Excel format.');
    }
    
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
        // Try to find element by text content first (more reliable)
        const element = await page.evaluateHandle((text) => {
          const elements = Array.from(document.querySelectorAll('button, a, [role="button"]'));
          return elements.find(el => (el.textContent || '').trim() === text);
        }, elementInfo.text);
        
        if (element && element.asElement()) {
          console.log(`Found download element: ${elementInfo.text.substring(0, 50)}`);
          
          // If it's a link with CSV href, navigate directly
          if (elementInfo.href && elementInfo.href.includes('.csv')) {
            console.log(`Found CSV link: ${elementInfo.href}`);
            const response = await page.goto(elementInfo.href, { waitUntil: 'networkidle2', timeout: 30000 });
            if (response && response.ok()) {
              // Get content from response or page
              try {
                const responseText = await response.text();
                if (responseText.includes('Empacotamento') && responseText.includes('Informação,Data,Valor')) {
                  csvContent = responseText;
                  csvDownloaded = true;
                  break;
                }
              } catch (e) {
                // Try page content
                const pageText = await page.evaluate(() => document.body.innerText || '');
                if (pageText.includes('Empacotamento') && pageText.includes('Informação,Data,Valor')) {
                  const csvMatch = pageText.match(/Informação,Data,Valor[\s\S]*/);
                  if (csvMatch) {
                    csvContent = csvMatch[0].trim();
                    csvDownloaded = true;
                    break;
                  }
                }
              }
            }
            } else {
              // Click the element to trigger download
              if (csvSelected) {
                console.log(`Clicking download button (CSV format selected): ${elementInfo.text}`);
              } else {
                console.log(`Clicking download button (default format - may be Excel): ${elementInfo.text}`);
                console.log('Warning: CSV format may not be selected. File might be in Excel format.');
              }
              await element.asElement().click();
              // Wait longer for download to complete and response to be captured
              await new Promise(resolve => setTimeout(resolve, 8000));
              // Check if CSV was captured via network monitoring
              if (csvContent) {
                console.log(`CSV content captured after clicking button (${csvContent.length} chars)`);
                csvDownloaded = true;
                break;
              } else {
                console.log(`No CSV content captured after clicking button. Checking downloaded files...`);
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
          
          // Navigate to CSV URL - the response interceptor should capture it
          console.log(`Navigating to CSV URL (response will be intercepted): ${csvUrl}`);
          await page.goto(csvUrl, { waitUntil: 'networkidle2', timeout: 10000 });
          
          // Wait a moment for response to be captured
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Check if we captured it via response interceptor
          if (csvContent) {
            console.log(`CSV content captured via response interceptor from: ${csvUrl}`);
            csvDownloaded = true;
            break;
          }
          
          // Fallback: try to get response text directly
          try {
            const response = await page.goto(csvUrl, { waitUntil: 'networkidle2', timeout: 10000 });
            if (response && response.ok()) {
              const responseText = await response.text();
              if (responseText && responseText.includes('Empacotamento') && responseText.includes('Informação,Data,Valor')) {
                console.log(`Successfully accessed CSV at: ${csvUrl} (${responseText.length} chars)`);
                csvContent = responseText;
                csvDownloaded = true;
                break;
              }
            }
          } catch (e) {
            console.log(`Error accessing ${csvUrl}: ${e.message}`);
          }
        } catch (e) {
          // Continue to next URL
          console.log(`Failed to access ${csvUrl}: ${e.message}`);
        }
      }
    }
    
    // Wait a bit for any downloads to complete or responses to arrive
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // If we captured CSV content from network response, use it
    if (csvContent) {
      console.log(`Using CSV content captured from network response (length: ${csvContent.length} chars)`);
      return parseCsvAndExtractValue(csvContent);
    }
    
    // Try to get CSV content from current page (in case CSV was loaded as text)
    try {
      console.log('Checking page content for CSV data...');
      const pageText = await page.evaluate(() => {
        return document.body.innerText || document.body.textContent || '';
      });
      console.log(`Page text length: ${pageText.length} chars`);
      if (pageText.includes('Empacotamento') && pageText.includes('Informação,Data,Valor')) {
        console.log('Found CSV content in page text');
        // Extract the CSV portion
        const csvMatch = pageText.match(/Informação,Data,Valor[\s\S]*/);
        if (csvMatch) {
          csvContent = csvMatch[0].trim();
          console.log(`Extracted CSV content from page (length: ${csvContent.length} chars)`);
          return parseCsvAndExtractValue(csvContent);
        }
      } else {
        console.log('Page does not contain CSV markers (Empacotamento, Informação,Data,Valor)');
      }
    } catch (e) {
      console.log(`Error checking page content: ${e.message}`);
      // Continue to file-based methods
    }
    
    // Look for downloaded files (CSV or Excel)
    const downloadDir = downloadPath;
    let csvFiles = [];
    let excelFiles = [];
    try {
      const files = fs.readdirSync(downloadDir);
      console.log(`Files in download directory: ${files.length} total`);
      csvFiles = files.filter(f => f.endsWith('.csv'));
      excelFiles = files.filter(f => f.endsWith('.xlsx') && f.toLowerCase().includes('empacotamento'));
      console.log(`CSV files found: ${csvFiles.length}`);
      console.log(`Excel files found: ${excelFiles.length}`);
      
      if (csvFiles.length > 0) {
        console.log(`CSV file names: ${csvFiles.join(', ')}`);
      }
      if (excelFiles.length > 0) {
        console.log(`Excel file names: ${excelFiles.join(', ')}`);
      }
    } catch (e) {
      console.log(`Error reading download directory: ${e.message}`);
    }
    
    // Prefer CSV files, but fall back to Excel if needed
    if (csvFiles.length > 0) {
      // Use the most recently downloaded CSV file
      downloadedFilePath = path.join(downloadDir, csvFiles.sort().reverse()[0]);
      console.log(`✓ Found CSV file: ${downloadedFilePath}`);
      
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
    } else if (excelFiles.length > 0) {
      // Excel files are downloaded, but we need CSV format
      console.log('⚠ Excel files found but CSV preferred.');
      
      // If we tried to select CSV but still got Excel, provide helpful error
      if (csvSelected) {
        console.log('Error: CSV format was selected in dropdown, but downloaded file is still Excel format.');
        console.log('This suggests the dropdown selection did not work correctly.');
        console.log('Trying to find alternative CSV download method...');
        
        // Try to find CSV-specific download button or link
        const csvDownloadOptions = await page.evaluate(() => {
          const elements = Array.from(document.querySelectorAll('button, a, [role="button"]'));
          return elements
            .filter(el => {
              const text = (el.textContent || '').toLowerCase();
              const href = (el.href || '').toLowerCase();
              return (text.includes('csv') || href.includes('.csv')) && 
                     !text.includes('excel') && !href.includes('.xlsx');
            })
            .map(el => ({
              text: el.textContent?.trim() || '',
              href: el.href || ''
            }));
        });
        
        if (csvDownloadOptions.length > 0) {
          console.log(`Found ${csvDownloadOptions.length} alternative CSV download options`);
          for (const option of csvDownloadOptions) {
            try {
              if (option.href && option.href.includes('.csv')) {
                console.log(`Trying alternative CSV link: ${option.href}`);
                const response = await page.goto(option.href, { waitUntil: 'networkidle2', timeout: 30000 });
                if (response && response.ok()) {
                  const responseText = await response.text();
                  if (responseText.includes('Empacotamento') && responseText.includes('Informação,Data,Valor')) {
                    console.log(`✓ Successfully downloaded CSV from alternative link`);
                    return parseCsvAndExtractValue(responseText);
                  }
                }
              }
            } catch (e) {
              // Continue
            }
          }
        }
        
        throw new Error('CSV format was selected in dropdown, but downloaded file is still Excel format. The dropdown selection may not have worked correctly. Please verify the website structure or check if the dropdown requires different interaction.');
      } else {
        throw new Error('Only Excel files (.xlsx) are available for download, but CSV format is required. Could not find or interact with format dropdown to select CSV. Please verify the website has a format dropdown menu.');
      }
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
