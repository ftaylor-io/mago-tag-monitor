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
      
      // Find download button first, then look for format dropdown near it
      const downloadButtonInfo = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
        const baixarButton = buttons.find(btn => {
          const text = (btn.textContent || '').toLowerCase();
          return text.includes('baixar') || text.includes('download');
        });
        
        if (baixarButton) {
          // Look for format dropdowns near the download button
          const container = baixarButton.closest('div') || baixarButton.parentElement;
          const siblings = Array.from(container?.children || []);
          const nearbySelects = Array.from(document.querySelectorAll(
            'select, .MuiSelect-select, [class*="MuiSelect"], button[aria-haspopup]'
          )).filter(el => {
            // Check if it's near the download button (same container or nearby)
            const elContainer = el.closest('div') || el.parentElement;
            return elContainer === container || 
                   container?.contains(el) || 
                   elContainer?.contains(baixarButton);
          });
          
          return {
            found: true,
            buttonText: baixarButton.textContent?.trim() || '',
            nearbySelects: nearbySelects.map(el => ({
              tag: el.tagName,
              text: el.textContent?.trim() || '',
              className: (el.className && typeof el.className === 'string') ? el.className : String(el.className || ''),
              id: el.id || '',
              isNativeInput: el.tagName === 'INPUT' && el.className.includes('MuiSelect-nativeInput')
            }))
          };
        }
        return { found: false, nearbySelects: [] };
      });
      
      if (downloadButtonInfo.found) {
        console.log(`Found download button: "${downloadButtonInfo.buttonText}"`);
        console.log(`Found ${downloadButtonInfo.nearbySelects.length} nearby select/dropdown elements:`);
        downloadButtonInfo.nearbySelects.forEach((sel, idx) => {
          const classStr = sel.className.substring ? sel.className.substring(0, 50) : String(sel.className).substring(0, 50);
          console.log(`  [${idx}] ${sel.tag}: "${sel.text}" (class: ${classStr})`);
        });
        
        // Find the format select (the one showing "Excel (.xlsx)")
        const formatSelect = downloadButtonInfo.nearbySelects.find(sel => 
          sel.text.includes('xlsx') || sel.text.includes('Excel') || sel.isNativeInput
        );
        
        if (formatSelect) {
          console.log(`Found format select: ${formatSelect.tag} with text "${formatSelect.text}"`);
          
          // If it's a native input, we can use it directly
          if (formatSelect.isNativeInput) {
            // Find the select element that contains this input
            const selectElement = await page.evaluateHandle(() => {
              const input = document.querySelector('.MuiSelect-nativeInput');
              return input ? input.closest('div[class*="MuiSelect-root"]') || input.parentElement : null;
            });
            
            if (selectElement && selectElement.asElement()) {
              // Click to open the select
              await selectElement.asElement().click();
              await new Promise(resolve => setTimeout(resolve, 1500));
              
              // Get the options from the native select
              const options = await page.evaluate(() => {
                const input = document.querySelector('.MuiSelect-nativeInput');
                if (input && input.options) {
                  return Array.from(input.options).map((opt, idx) => ({
                    index: idx,
                    text: opt.text || '',
                    value: opt.value || ''
                  }));
                }
                return [];
              });
              
              console.log(`Format select options: ${options.map(o => `[${o.index}] "${o.text}"`).join(', ')}`);
              
              // Find CSV option (should be second option: Excel, CSV, JSON)
              const csvOption = options.find(opt => 
                opt.text.toLowerCase().includes('csv') || opt.index === 1
              );
              
              if (csvOption) {
                // Select the CSV option using the native select
                await page.evaluate((value) => {
                  const input = document.querySelector('.MuiSelect-nativeInput');
                  if (input) {
                    input.value = value;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                }, csvOption.value || csvOption.index.toString());
                
                console.log(`✓ Selected CSV format: "${csvOption.text}"`);
                csvSelected = true;
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
          } else {
            // It's a div - click it to open the menu
            console.log(`Clicking format select div to open menu...`);
            const selectDiv = await page.evaluateHandle(() => {
              const divs = Array.from(document.querySelectorAll('.MuiSelect-select'));
              return divs.find(d => {
                const text = (d.textContent || '').toLowerCase();
                return text.includes('xlsx') || text.includes('excel');
              });
            });
            
            if (selectDiv && selectDiv.asElement()) {
              await selectDiv.asElement().click();
              await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for menu to open
              
              // Look for CSV option in the MUI menu
              const menuInfo = await page.evaluate(() => {
                const options = Array.from(document.querySelectorAll(
                  'li[role="option"], [role="option"], .MuiMenuItem-root, [class*="MuiMenuItem"]'
                )).filter(item => {
                  const style = window.getComputedStyle(item);
                  return style.display !== 'none' && style.visibility !== 'hidden' && 
                         item.offsetParent !== null;
                });
                
                return options.map((opt, idx) => ({
                  index: idx,
                  text: opt.textContent?.trim() || '',
                  tag: opt.tagName,
                  className: opt.className || ''
                }));
              });
              
              console.log(`Found ${menuInfo.length} menu options:`);
              menuInfo.forEach(opt => {
                console.log(`  [${opt.index}] "${opt.text}"`);
              });
              
              // Find CSV option
              const csvOption = menuInfo.find(opt => {
                const text = opt.text.toLowerCase();
                return (text.includes('csv') || text.includes('.csv')) && 
                       !text.includes('xlsx') && !text.includes('excel') && !text.includes('json');
              }) || (menuInfo.length >= 2 ? menuInfo[1] : null); // Fallback to second option
              
              if (csvOption) {
                console.log(`Selecting CSV option: "${csvOption.text}" (index ${csvOption.index})`);
                
                // Click the CSV option
                await page.evaluate((index) => {
                  const options = Array.from(document.querySelectorAll(
                    'li[role="option"], [role="option"], .MuiMenuItem-root, [class*="MuiMenuItem"]'
                  )).filter(item => {
                    const style = window.getComputedStyle(item);
                    return style.display !== 'none' && style.visibility !== 'hidden' && 
                           item.offsetParent !== null;
                  });
                  if (options[index]) {
                    options[index].click();
                  }
                }, csvOption.index);
                
                console.log(`✓ Selected CSV format: "${csvOption.text}"`);
                csvSelected = true;
                await new Promise(resolve => setTimeout(resolve, 1500)); // Wait for selection to apply
              } else {
                console.log('Could not find CSV option in menu');
              }
            }
          }
        }
      }
    
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
        
        // Look for Material-UI Select components (MuiSelect) that might be format dropdowns
        const muiSelects = Array.from(document.querySelectorAll(
          '.MuiSelect-select, ' +
          '[class*="MuiSelect"], ' +
          'div[class*="MuiSelect"]'
        ));
        
        for (const select of muiSelects) {
          const text = (select.textContent || '').toLowerCase();
          // Check if this select shows format-related text
          if (text.includes('xlsx') || 
              text.includes('excel') || 
              text.includes('.xlsx') ||
              text.includes('.csv') ||
              (text.includes('csv') && !text.includes('gasene')) ||
              text.includes('json')) {
            // Find the parent select element or button
            let selectElement = select.closest('div[class*="MuiSelect-root"]') || 
                               select.closest('button') ||
                               select.parentElement;
            
            return {
              type: 'mui-select',
              id: selectElement?.id || select.id || '',
              className: selectElement?.className || select.className || '',
              text: select.textContent?.trim() || '',
              selectElement: select
            };
          }
        }
        
        // Look for custom dropdowns (button/menu pattern) - specifically format dropdowns
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
          const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
          const title = (button.getAttribute('title') || '').toLowerCase();
          
          // Look for format-related indicators
          const isFormatDropdown = text.includes('xlsx') || 
                                  text.includes('excel') || 
                                  text.includes('.xlsx') ||
                                  text.includes('.csv') ||
                                  (text.includes('csv') && !text.includes('gasene')) ||
                                  text.includes('json') ||
                                  text.includes('format') ||
                                  ariaLabel.includes('format') ||
                                  title.includes('format');
          
          if (isFormatDropdown) {
            return {
              type: 'custom',
              id: button.id || '',
              className: button.className || '',
              text: button.textContent?.trim() || '',
              ariaLabel: button.getAttribute('aria-label') || '',
              title: button.getAttribute('title') || ''
            };
          }
        }
        
        // Also look for buttons near download button that might be format selector
        const downloadButtons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
        const baixarButton = downloadButtons.find(btn => 
          (btn.textContent || '').toLowerCase().includes('baixar') ||
          (btn.textContent || '').toLowerCase().includes('download')
        );
        
        if (baixarButton) {
          // Look for format dropdown near the download button
          const nearbyElements = Array.from(document.querySelectorAll(
            'button, select, [role="combobox"], [class*="dropdown"], [class*="select"]'
          ));
          
          for (const element of nearbyElements) {
            const text = (element.textContent || '').toLowerCase();
            if ((text.includes('xlsx') || text.includes('.xlsx') || text.includes('excel')) &&
                element !== baixarButton) {
              return {
                type: 'custom',
                id: element.id || '',
                className: element.className || '',
                text: element.textContent?.trim() || '',
                ariaLabel: element.getAttribute('aria-label') || '',
                title: element.getAttribute('title') || '',
                nearDownload: true
              };
            }
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
        } else if (dropdownInfo.type === 'mui-select') {
          // Material-UI Select component
          console.log(`Found MUI Select dropdown: ${dropdownInfo.text}`);
          
          // MUI Selects can be clicked to open, or we can use the select element directly
          // Try to find the actual select input or the clickable area
          const selectElement = await page.evaluateHandle((info) => {
            // Find element with the text
            const elements = Array.from(document.querySelectorAll('.MuiSelect-select, [class*="MuiSelect"]'));
            return elements.find(el => (el.textContent || '').trim() === info.text);
          }, dropdownInfo);
          
          if (selectElement && selectElement.asElement()) {
            // Click to open the select menu
            await selectElement.asElement().click();
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // Now look for the CSV option in the MUI menu
            const csvOption = await page.evaluate(() => {
              // MUI menus typically use li[role="option"] or [role="option"]
              const options = Array.from(document.querySelectorAll(
                'li[role="option"], ' +
                '[role="option"], ' +
                '.MuiMenuItem-root, ' +
                '[class*="MuiMenuItem"]'
              )).filter(item => {
                const style = window.getComputedStyle(item);
                return style.display !== 'none' && style.visibility !== 'hidden';
              });
              
              // Look for CSV option
              for (const option of options) {
                const text = (option.textContent || '').toLowerCase();
                if ((text.includes('csv') || text.includes('.csv')) && 
                    !text.includes('xlsx') && !text.includes('excel') && !text.includes('json')) {
                  return {
                    text: option.textContent?.trim() || '',
                    index: options.indexOf(option)
                  };
                }
              }
              
              // If not found by text, try second option (assuming: Excel, CSV, JSON)
              if (options.length >= 2) {
                const secondText = (options[1].textContent || '').toLowerCase();
                if (!secondText.includes('xlsx') && !secondText.includes('excel') && !secondText.includes('json')) {
                  return {
                    text: options[1].textContent?.trim() || '',
                    index: 1
                  };
                }
              }
              
              return null;
            });
            
            if (csvOption) {
              // Click the CSV option
              await page.evaluate((index) => {
                const options = Array.from(document.querySelectorAll(
                  'li[role="option"], [role="option"], .MuiMenuItem-root'
                )).filter(item => {
                  const style = window.getComputedStyle(item);
                  return style.display !== 'none' && style.visibility !== 'hidden';
                });
                if (options[index]) {
                  options[index].click();
                }
              }, csvOption.index);
              
              console.log(`✓ Selected CSV option in MUI Select: "${csvOption.text}"`);
              csvSelected = true;
              await new Promise(resolve => setTimeout(resolve, 1000));
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
              await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for menu to open
              
              // Sometimes there are multiple menus - wait a bit more for format menu to appear
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              // Look for CSV option in the opened menu
              const menuInfo = await page.evaluate(() => {
                const menuItems = Array.from(document.querySelectorAll(
                  '[role="option"], ' +
                  '[role="menuitem"], ' +
                  'li[role="option"], ' +
                  '.dropdown-item, ' +
                  '.menu-item, ' +
                  '[class*="option"], ' +
                  'button[role="option"], ' +
                  'div[role="option"]'
                ));
                
                return {
                  count: menuItems.length,
                  items: menuItems.map((item, idx) => ({
                    index: idx,
                    text: item.textContent?.trim() || '',
                    tag: item.tagName,
                    className: item.className || '',
                    id: item.id || ''
                  }))
                };
              });
              
              console.log(`Found ${menuInfo.count} menu items in dropdown:`);
              menuInfo.items.forEach(item => {
                console.log(`  [${item.index}] "${item.text}" (${item.tag})`);
              });
              
              // Look for format options specifically - they might be in a different menu
              const allMenus = await page.evaluate(() => {
                // Get all visible menus/dropdowns
                const allMenuItems = Array.from(document.querySelectorAll(
                  '[role="option"], ' +
                  '[role="menuitem"], ' +
                  'li[role="option"], ' +
                  '.dropdown-item, ' +
                  '.menu-item, ' +
                  '[class*="option"], ' +
                  'button[role="option"], ' +
                  'div[role="option"], ' +
                  '[class*="menu"] [class*="item"], ' +
                  'ul li, ' +
                  'ol li'
                )).filter(item => {
                  // Only visible items
                  const style = window.getComputedStyle(item);
                  return style.display !== 'none' && style.visibility !== 'hidden';
                });
                
                return allMenuItems.map((item, idx) => ({
                  index: idx,
                  text: item.textContent?.trim() || '',
                  tag: item.tagName,
                  className: item.className || '',
                  id: item.id || '',
                  parent: item.parentElement?.className || ''
                }));
              });
              
              console.log(`Found ${allMenus.length} total menu items across all menus:`);
              allMenus.forEach(item => {
                console.log(`  [${item.index}] "${item.text}" (${item.tag}, parent: ${item.parent})`);
              });
              
              // Look for format options (Excel, CSV, JSON)
              const formatMenuItems = allMenus.filter(item => {
                const text = item.text.toLowerCase();
                return text.includes('xlsx') || 
                       text.includes('excel') || 
                       text.includes('csv') || 
                       text.includes('json') ||
                       text.includes('.xlsx') ||
                       text.includes('.csv') ||
                       text.includes('.json');
              });
              
              if (formatMenuItems.length > 0) {
                console.log(`Found ${formatMenuItems.length} format-related menu items:`);
                formatMenuItems.forEach(item => {
                  console.log(`  - "${item.text}"`);
                });
              }
              
              const csvOption = await page.evaluate(() => {
                // Look specifically for format options
                const allItems = Array.from(document.querySelectorAll(
                  '[role="option"], ' +
                  '[role="menuitem"], ' +
                  'li, ' +
                  '.dropdown-item, ' +
                  '.menu-item, ' +
                  '[class*="option"]'
                )).filter(item => {
                  const style = window.getComputedStyle(item);
                  const text = (item.textContent || '').toLowerCase();
                  return (style.display !== 'none' && style.visibility !== 'hidden') &&
                         (text.includes('xlsx') || text.includes('excel') || text.includes('csv') || text.includes('json'));
                });
                
                const menuItems = allItems.length > 0 ? allItems : Array.from(document.querySelectorAll(
                  '[role="option"], ' +
                  '[role="menuitem"], ' +
                  'li[role="option"], ' +
                  '.dropdown-item, ' +
                  '.menu-item, ' +
                  '[class*="option"], ' +
                  'button[role="option"], ' +
                  'div[role="option"]'
                ));
                
                // First, try to find CSV by text (case insensitive, look for .csv or just "csv")
                for (const item of menuItems) {
                  const text = (item.textContent || '').toLowerCase();
                  const innerText = text.trim();
                  // Look for CSV - could be "CSV", ".csv", "csv format", etc.
                  if ((innerText.includes('csv') || innerText.includes('.csv')) && 
                      !innerText.includes('xlsx') && 
                      !innerText.includes('excel') && 
                      !innerText.includes('json')) {
                    return {
                      text: item.textContent?.trim() || '',
                      selector: item.id ? `#${item.id}` : null,
                      className: item.className || '',
                      index: menuItems.indexOf(item)
                    };
                  }
                }
                
                // If no CSV found by text, try to find by position
                // Options are typically: Excel (.xlsx), CSV, JSON
                // So CSV should be the second option (index 1)
                if (menuItems.length >= 2) {
                  // Check if second option looks like CSV
                  const secondOption = menuItems[1];
                  const secondText = (secondOption.textContent || '').toLowerCase().trim();
                  // If it doesn't contain xlsx, excel, or json, it might be CSV
                  if (!secondText.includes('xlsx') && 
                      !secondText.includes('excel') && 
                      !secondText.includes('json')) {
                    return {
                      text: secondOption.textContent?.trim() || '',
                      selector: secondOption.id ? `#${secondOption.id}` : null,
                      className: secondOption.className || '',
                      index: 1
                    };
                  }
                }
                
                // Last resort: return second option anyway
                if (menuItems.length >= 2) {
                  return {
                    text: menuItems[1].textContent?.trim() || '',
                    selector: menuItems[1].id ? `#${menuItems[1].id}` : null,
                    className: menuItems[1].className || '',
                    index: 1
                  };
                }
                
                return null;
              });
              
              if (csvOption) {
                console.log(`Found CSV option candidate: "${csvOption.text}" (index: ${csvOption.index})`);
                
                // Verify it's actually CSV before selecting
                const optionText = csvOption.text.toLowerCase();
                const isLikelyCsv = optionText.includes('csv') || 
                                   optionText.includes('.csv') ||
                                   (!optionText.includes('xlsx') && 
                                    !optionText.includes('excel') && 
                                    !optionText.includes('json') &&
                                    csvOption.index === 1); // Second option that's not Excel/JSON
                
                if (isLikelyCsv || csvOption.index === 1) {
                  // Click the CSV option
                  try {
                    if (csvOption.selector) {
                      await page.click(csvOption.selector);
                    } else {
                      // Try to click by index or text
                      await page.evaluate((index, text) => {
                        const items = Array.from(document.querySelectorAll(
                          '[role="option"], [role="menuitem"], li[role="option"], .dropdown-item'
                        ));
                        if (items[index]) {
                          items[index].click();
                        } else {
                          // Fallback: find by text
                          const item = items.find(i => (i.textContent || '').trim() === text);
                          if (item) item.click();
                        }
                      }, csvOption.index, csvOption.text);
                    }
                    console.log(`✓ Selected CSV option: "${csvOption.text}"`);
                    csvSelected = true;
                    await new Promise(resolve => setTimeout(resolve, 1500)); // Wait for selection to apply
                  } catch (e) {
                    console.log(`Error clicking CSV option: ${e.message}`);
                  }
                } else {
                  console.log(`Warning: Option "${csvOption.text}" doesn't look like CSV. Skipping selection.`);
                }
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
