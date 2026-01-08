// Background service worker for handling downloads and navigation

interface DownloadInfo {
  id: number;
  filename: string;
  url: string;
  state: string;
}

interface AWSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
}

interface Message {
  type: string;
  selector?: string;
  returnUrl?: string;
  downloadId?: number;
  autoLogin?: boolean;
  credentials?: {
    email: string;
    password: string;
  };
  url?: string;
  awsCredentials?: AWSCredentials;
  s3Key?: string;
  filepath?: string;
  targetName?: string;
  fileContent?: ArrayBuffer | Uint8Array | number[];
}

// Store download tracking info
const downloadTracking = new Map<number, { 
  startTime: number; 
  filename: string;
  url: string;
}>();

// Listen for download events
chrome.downloads.onCreated.addListener((downloadItem) => {
  console.log('Download started:', downloadItem);
  
  const filename = downloadItem.filename || downloadItem.url.split('/').pop() || 'unknown';
  
  downloadTracking.set(downloadItem.id, {
    startTime: Date.now(),
    filename: filename,
    url: downloadItem.url,
  });
  
  // Notify popup about download start
  chrome.runtime.sendMessage({
    type: 'DOWNLOAD_STARTED',
    downloadId: downloadItem.id,
    filename: filename,
    url: downloadItem.url,
  }).catch(() => {
    // Popup might be closed, that's okay
  });
});

chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state && delta.state.current === 'complete') {
    const tracking = downloadTracking.get(delta.id);
    if (tracking) {
      const duration = Date.now() - tracking.startTime;
      console.log(`Download completed: ${tracking.filename}`);
      console.log(`Download duration: ${duration}ms`);
      console.log(`Download ID: ${delta.id}`);
      
      // Get full download info including file path
      chrome.downloads.search({ id: delta.id }, (results) => {
        if (results && results.length > 0) {
          const download = results[0];
          const actualFilename = download.filename.split(/[/\\]/).pop() || tracking.filename;
          
          console.log('Download details:', {
            id: delta.id,
            filename: actualFilename,
            filepath: download.filename, // Full path
            filesize: download.fileSize,
            url: download.url,
            mime: download.mime,
            exists: download.exists,
          });
          
          // Notify popup with full details
          chrome.runtime.sendMessage({
            type: 'DOWNLOAD_COMPLETED',
            downloadId: delta.id,
            filename: actualFilename,
            filepath: download.filename, // Full system path
            duration,
            filesize: download.fileSize || 0,
            url: download.url,
            mime: download.mime,
          }).catch(() => {
            // Popup might be closed
          });
        }
      });
      
      downloadTracking.delete(delta.id);
    }
  } else if (delta.state && delta.state.current === 'interrupted') {
    console.error(`Download interrupted: ${delta.id}`);
    const tracking = downloadTracking.get(delta.id);
    downloadTracking.delete(delta.id);
    
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_FAILED',
      downloadId: delta.id,
      filename: tracking?.filename || 'unknown',
      error: 'Download was interrupted',
    }).catch(() => {});
  }
});

// AWS S3 Upload Functions
// Receives file content from popup (read from disk via File System Access API)
async function uploadToS3(fileContent: Uint8Array, s3Key: string, creds: AWSCredentials, _targetName: string): Promise<{ success: boolean; error?: string; url?: string }> {
  try {
    console.log('Uploading file to S3, size:', fileContent.length, 'bytes');
    
    // Upload to S3
    const region = creds.region;
    const bucket = creds.bucket;
    const service = 's3';
    const endpoint = `https://${bucket}.s3.${region}.amazonaws.com/${s3Key}`;
    
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
    const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    
    const contentType = 'text/csv';
    
    const encoder = new TextEncoder();
    const canonicalRequest = `PUT\n/${s3Key}\n\ncontent-type:${contentType}\nhost:${bucket}.s3.${region}.amazonaws.com\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:${amzDate}\n\ncontent-type;host;x-amz-content-sha256;x-amz-date\nUNSIGNED-PAYLOAD`;
    
    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStr}/${region}/${service}/aws4_request`;
    
    const canonicalRequestHash = await crypto.subtle.digest('SHA-256', encoder.encode(canonicalRequest));
    const canonicalRequestHashHex = Array.from(new Uint8Array(canonicalRequestHash))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    
    const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${canonicalRequestHashHex}`;
    
    // Generate signing key - properly chain HMAC operations
    const hmac = async (keyData: string | ArrayBuffer, data: string): Promise<ArrayBuffer> => {
      const keyBytes = typeof keyData === 'string' ? encoder.encode(keyData) : new Uint8Array(keyData);
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
    };
    
    const getSignatureKey = async (key: string, dateStamp: string, regionName: string, serviceName: string): Promise<ArrayBuffer> => {
      const kDate = await hmac('AWS4' + key, dateStamp);
      const kRegion = await hmac(kDate, regionName);
      const kService = await hmac(kRegion, serviceName);
      const kSigning = await hmac(kService, 'aws4_request');
      return kSigning;
    };
    
    const signingKey = await getSignatureKey(creds.secretAccessKey, dateStr, region, service);
    const signatureBytes = new Uint8Array(await hmac(signingKey, stringToSign));
    const signatureHex = Array.from(signatureBytes)
      .map(b => b.toString(16).padStart(2, '0')).join('');
    
    const authorizationHeader = `${algorithm} Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=${signatureHex}`;
    
    console.log('Uploading to S3:', endpoint);
    console.log('File size:', fileContent.length, 'bytes');
    console.log('First 20 bytes:', Array.from(fileContent.slice(0, 20)));
    
    // Verify file content is not empty
    if (fileContent.length === 0) {
      console.error('ERROR: File content is empty (0 bytes)');
      return { success: false, error: 'File content is empty (0 bytes)' };
    }
    
    // Upload (no ACL header - use bucket policy for public access instead)
    // Create a new ArrayBuffer with only the file content (in case Uint8Array is a view)
    const arrayBuffer = new ArrayBuffer(fileContent.length);
    const view = new Uint8Array(arrayBuffer);
    view.set(fileContent);
    
    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Authorization': authorizationHeader,
        'Content-Type': contentType,
        'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
        'x-amz-date': amzDate,
      },
      body: arrayBuffer,
    });

    console.log('S3 upload response:', response.status, response.statusText);

    if (response.ok) {
      const publicUrl = `https://${bucket}.s3.${region}.amazonaws.com/${s3Key}`;
      console.log('✓ S3 upload successful:', publicUrl);
      return { success: true, url: publicUrl };
    } else {
      const errorText = await response.text();
      console.error('✗ S3 upload failed:', response.status, errorText);
      return { success: false, error: `${response.status} ${errorText}` };
    }
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === 'CLICK_DOWNLOAD') {
    // Forward to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, message);
      }
    });
  } else if (message.type === 'NAVIGATE_TO_LOGIN') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        const tabId = tabs[0].id;
        chrome.tabs.update(tabId, { 
          url: 'https://www.oro2u.com/customer/account/login' 
        }, () => {
          // If auto-login is enabled, send credentials to content script after page loads
          if (message.autoLogin && message.credentials) {
            setTimeout(() => {
              chrome.tabs.sendMessage(tabId, {
                type: 'AUTO_LOGIN',
                credentials: message.credentials
              }).catch(() => {
                console.log('Content script not ready yet for auto-login');
              });
            }, 2000); // Wait for page to load
          }
        });
      }
    });
  } else if (message.type === 'NAVIGATE_TO_STOCK') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.update(tabs[0].id, { 
          url: 'https://www.oro2u.com/orderwise/stock/' 
        });
      }
    });
  } else if (message.type === 'NAVIGATE_TO_URL') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id && message.url) {
        chrome.tabs.update(tabs[0].id, { url: message.url });
      }
    });
  } else if (message.type === 'CHECK_PAGE_STATE') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'CHECK_STATE' }, (response) => {
          sendResponse(response);
        });
      }
    });
    return true; // Will respond asynchronously
  } else if (message.type === 'UPLOAD_TO_S3') {
    // Handle S3 upload in background - receives file content from popup (read from disk)
    if (message.fileContent && message.s3Key && message.awsCredentials && message.targetName) {
      try {
        console.log('Received message.fileContent type:', typeof message.fileContent);
        console.log('Received message.fileContent constructor:', message.fileContent?.constructor?.name);
        console.log('Received message.fileContent isArray:', Array.isArray(message.fileContent));
        console.log('Received message.fileContent length:', (message.fileContent as any)?.length || 'unknown');
        
        // Convert plain array back to Uint8Array (sent as array for reliable serialization)
        let fileContent: Uint8Array;
        if (Array.isArray(message.fileContent)) {
          // Convert plain array to Uint8Array
          fileContent = new Uint8Array(message.fileContent);
          console.log('Converted from plain array to Uint8Array, length:', fileContent.length);
        } else if (message.fileContent instanceof Uint8Array) {
          fileContent = message.fileContent;
          console.log('Using Uint8Array directly, length:', fileContent.length);
        } else if (message.fileContent instanceof ArrayBuffer) {
          fileContent = new Uint8Array(message.fileContent);
          console.log('Converted from ArrayBuffer, length:', fileContent.length);
        } else {
          // Fallback: try to convert
          fileContent = new Uint8Array(message.fileContent as any);
          console.log('Fallback conversion, length:', fileContent.length);
        }
        
        console.log('Final fileContent size:', fileContent.length, 'bytes');
        console.log('First 20 bytes:', Array.from(fileContent.slice(0, 20)));
        
        if (fileContent.length === 0) {
          console.error('ERROR: File content is empty after conversion!');
          sendResponse({ success: false, error: 'File content is empty (0 bytes) after conversion' });
          return true;
        }
        
        uploadToS3(fileContent, message.s3Key, message.awsCredentials, message.targetName)
          .then(result => {
            sendResponse(result);
          })
          .catch(error => {
            sendResponse({ success: false, error: String(error) });
          });
        return true; // Will respond asynchronously
      } catch (error) {
        console.error('Error processing file content:', error);
        sendResponse({ success: false, error: `Error processing file: ${String(error)}` });
        return true;
      }
    } else {
      sendResponse({ success: false, error: 'Missing required parameters' });
    }
  }
  
  return false;
});

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id }).catch((err) => {
      console.error('Failed to open side panel:', err);
    });
  }
});

// Also enable opening side panel via action
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
  console.error('Failed to set panel behavior:', err);
});

console.log('Oro2u Downloader background service worker loaded');

