import { useState, useEffect, useRef } from 'react';
import { Download, Settings, RefreshCw, Upload, ChevronDown, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';

interface PageState {
  url: string;
  isLoginPage: boolean;
  isStockPage: boolean;
  hasCloudflare: boolean;
  hasDownloadButton: boolean;
  isLoggedIn: boolean;
}

interface DownloadLog {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

interface DownloadTarget {
  id: string;
  name: string;
  selector: string;
  enabled: boolean;
  filename?: string;
  s3Key?: string; // S3 key path (e.g., "data/stock.csv")
}

interface AWSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
}

interface TrackedDownload {
  targetId: string;
  targetName: string;
  downloadId: number;
  filename: string;
  filepath?: string;
  startTime: number;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  filesize?: number;
  duration?: number;
  error?: string;
  uploadStatus?: 'pending' | 'uploading' | 'uploaded' | 'failed';
  s3Url?: string;
  sessionId?: string; // Unique session ID for this download batch
}

const DEFAULT_TARGETS: DownloadTarget[] = [
  {
    id: 'stock',
    name: 'Stock Qtys',
    selector: '#maincontent > div.columns > div.column.main > table > tbody > tr:nth-child(11) > td:nth-child(4) > a',
    enabled: true,
    filename: 'stock.csv',
    s3Key: 'stock.csv',
  },
  {
    id: 'pricing',
    name: 'Pricing',
    selector: '#maincontent > div.columns > div.column.main > table > tbody > tr:nth-child(13) > td:nth-child(4) > a',
    enabled: true,
    filename: 'pricing.csv',
    s3Key: 'pricing.csv',
  },
  {
    id: 'products',
    name: 'Products',
    selector: '#maincontent > div.columns > div.column.main > table > tbody > tr:nth-child(2) > td:nth-child(4) > a',
    enabled: true,
    filename: 'products.csv',
    s3Key: 'products.csv',
  },
];

export default function Popup() {
  const [downloadTargets, setDownloadTargets] = useState<DownloadTarget[]>(DEFAULT_TARGETS);
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [autoLogin, setAutoLogin] = useState<boolean>(false);
  const [awsCredentials, setAwsCredentials] = useState<AWSCredentials>({
    accessKeyId: '',
    secretAccessKey: '',
    region: 'us-east-1',
    bucket: 'oro',
  });
  const [oracleApiKey, setOracleApiKey] = useState<string>('');
  const [oracleApiBaseUrl, setOracleApiBaseUrl] = useState<string>('https://admin.2bros.uk/api/v1/extension');
  const [pageState, setPageState] = useState<PageState | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [logs, setLogs] = useState<DownloadLog[]>([]);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [settingsTab, setSettingsTab] = useState<string>('targets');
  const [activeTab, setActiveTab] = useState<'downloads' | 'logs' | 'oracle'>('downloads');
  const [currentDownloads, setCurrentDownloads] = useState<TrackedDownload[]>([]);
  const [processingFiles, setProcessingFiles] = useState<boolean>(false);
  const [pendingS3Uploads, setPendingS3Uploads] = useState<Array<{download: TrackedDownload; s3Key: string; targetName: string}>>([]);
  const [sessionDirectoryHandle, setSessionDirectoryHandle] = useState<any>(null); // Store directory handle for cleanup
  const [syncOptions, setSyncOptions] = useState<{stock: boolean; pricing: boolean}>({stock: true, pricing: true});
  const [oracleFilter, setOracleFilter] = useState<'stock' | 'pricing'>('stock');
  const [oracleMessages, setOracleMessages] = useState<Array<{
    id: string;
    message: string;
    category: string;
    createdAt: string;
  }>>([]);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const [syncDisabledUntil, setSyncDisabledUntil] = useState<number | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // Load saved settings from storage
  useEffect(() => {
    chrome.storage.local.get(['downloadTargets', 'loginEmail', 'loginPassword', 'autoLogin', 'awsCredentials', 'oracleApiKey', 'oracleApiBaseUrl', 'syncOptions'], (result) => {
      if (result.downloadTargets) {
        // Merge stored targets with defaults to ensure new fields like s3Key exist
        const mergedTargets = DEFAULT_TARGETS.map(defaultTarget => {
          const storedTarget = result.downloadTargets.find((t: DownloadTarget) => t.id === defaultTarget.id);
          return storedTarget ? {
            ...defaultTarget, // Start with defaults (includes s3Key)
            ...storedTarget,  // Override with stored values
            s3Key: storedTarget.s3Key || defaultTarget.s3Key, // Ensure s3Key exists
            filename: storedTarget.filename || defaultTarget.filename, // Ensure filename exists
          } : defaultTarget;
        });
        setDownloadTargets(mergedTargets);
      }
      if (result.loginEmail) {
        setEmail(result.loginEmail);
      }
      if (result.loginPassword) {
        setPassword(result.loginPassword);
      }
      if (result.autoLogin !== undefined) {
        setAutoLogin(result.autoLogin);
      }
      if (result.awsCredentials) {
        // Merge with defaults to ensure bucket has default value
        setAwsCredentials({
          accessKeyId: result.awsCredentials.accessKeyId || '',
          secretAccessKey: result.awsCredentials.secretAccessKey || '',
          region: result.awsCredentials.region || 'us-east-1',
          bucket: result.awsCredentials.bucket || 'oro',
        });
      }
      if (result.oracleApiKey) {
        setOracleApiKey(result.oracleApiKey);
      }
      if (result.oracleApiBaseUrl) {
        setOracleApiBaseUrl(result.oracleApiBaseUrl);
      } else {
        // Set default if not in storage
        setOracleApiBaseUrl('https://admin.2bros.uk/api/v1/extension');
      }
      if (result.syncOptions) {
        // Ensure at least one is enabled
        const loaded = result.syncOptions;
        if (!loaded.stock && !loaded.pricing) {
          // Both disabled, enable stock by default
          setSyncOptions({ stock: true, pricing: false });
        } else {
          setSyncOptions(loaded);
        }
      }
    });
  }, []);

  // Save settings to storage
  const saveSettings = () => {
    chrome.storage.local.set({ 
      downloadTargets: downloadTargets,
      loginEmail: email,
      loginPassword: password,
      autoLogin: autoLogin,
      awsCredentials: awsCredentials,
      oracleApiKey: oracleApiKey,
      oracleApiBaseUrl: oracleApiBaseUrl,
      syncOptions: syncOptions
    }, () => {
      addLog('✓ Settings saved successfully', 'success');
      // Log what was saved for debugging
      if (awsCredentials.accessKeyId) {
        addLog(`AWS configured: Bucket="${awsCredentials.bucket}", Region="${awsCredentials.region}"`, 'info');
      }
      addLog(`Download targets: ${downloadTargets.filter(t => t.enabled).map(t => t.name).join(', ')}`, 'info');
    });
  };

  // Update a download target
  const updateTarget = (id: string, updates: Partial<DownloadTarget>) => {
    setDownloadTargets(prev => 
      prev.map(target => 
        target.id === id ? { ...target, ...updates } : target
      )
    );
  };

  // Toggle target enabled state
  const toggleTarget = (id: string) => {
    setDownloadTargets(prev => 
      prev.map(target => 
        target.id === id ? { ...target, enabled: !target.enabled } : target
      )
    );
  };

  // Get enabled targets count
  const enabledCount = downloadTargets.filter(t => t.enabled).length;

  // Add log entry
  const addLog = (message: string, type: DownloadLog['type'] = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [{ timestamp, message, type }, ...prev].slice(0, 50));
  };

  // Clear logs
  const clearLogs = () => {
    setLogs([]);
    addLog('Log cleared', 'info');
  };

  // Check current page state (manual refresh)
  const checkPageState = async () => {
    setLoading(true);
    addLog('Refreshing page state...', 'info');
    const state = await getCurrentPageState();
    if (state) {
      addLog('Page state updated', 'success');
      
      // Check which download buttons are available
      const enabled = downloadTargets.filter(t => t.enabled);
      for (const target of enabled) {
        const hasButton = await checkSelectorExists(target.selector);
        addLog(`${target.name}: ${hasButton ? 'Found ✓' : 'Not found ✗'}`, hasButton ? 'success' : 'info');
      }
    } else {
      addLog('Unable to check page state - please refresh the page', 'error');
    }
    setLoading(false);
  };

  // Check if a specific selector exists
  const checkSelectorExists = async (selector: string): Promise<boolean> => {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]?.id) {
          resolve(false);
          return;
        }

        chrome.tabs.sendMessage(
          tabs[0].id,
          { type: 'CHECK_STATE', selector },
          (response: PageState) => {
            if (chrome.runtime.lastError) {
              resolve(false);
            } else {
              resolve(response?.hasDownloadButton || false);
            }
          }
        );
      });
    });
  };

  // Handle sync button click
  const handleSync = async () => {
    if (!oracleApiKey) {
      addLog('Oracle API Key not configured', 'error');
      return;
    }
    if (!oracleApiBaseUrl) {
      addLog('Oracle API Base URL not configured', 'error');
      return;
    }
    if (loading || processingFiles) {
      addLog('Cannot sync while downloads are in progress', 'error');
      return;
    }
    if (isSyncing) {
      addLog('Sync already in progress', 'error');
      return;
    }
    
    // Check if sync is disabled (within 15 minutes)
    const now = Date.now();
    if (syncDisabledUntil && now < syncDisabledUntil) {
      const minutesRemaining = Math.ceil((syncDisabledUntil - now) / 60000);
      addLog(`Sync is disabled for ${minutesRemaining} more minute(s)`, 'error');
      return;
    }

    // Switch to Oracle tab
    setActiveTab('oracle');
    setIsSyncing(true);
    addLog('Sync started...', 'info');

    try {
      const headers = {
        'x-api-key': oracleApiKey,
      };

      // Sync pricing if enabled
      if (syncOptions.pricing) {
        try {
          addLog('Syncing pricing...', 'info');
          const pricingResponse = await fetch(`${oracleApiBaseUrl}/update-pricing`, {
            method: 'POST',
            headers: headers,
          });

          if (pricingResponse.ok) {
            addLog('✓ Pricing sync successful', 'success');
          } else {
            const errorText = await pricingResponse.text().catch(() => 'Unknown error');
            addLog(`✗ Pricing sync failed: ${pricingResponse.status} ${errorText}`, 'error');
          }
        } catch (error: any) {
          addLog(`✗ Pricing sync error: ${error.message || String(error)}`, 'error');
        }
      }

      // Sync stock if enabled
      if (syncOptions.stock) {
        try {
          addLog('Syncing stock...', 'info');
          const stockResponse = await fetch(`${oracleApiBaseUrl}/update-stock`, {
            method: 'POST',
            headers: headers,
          });

          if (stockResponse.ok) {
            addLog('✓ Stock sync successful', 'success');
          } else {
            const errorText = await stockResponse.text().catch(() => 'Unknown error');
            addLog(`✗ Stock sync failed: ${stockResponse.status} ${errorText}`, 'error');
          }
        } catch (error: any) {
          addLog(`✗ Stock sync error: ${error.message || String(error)}`, 'error');
        }
      }

      // Disable sync for 15 minutes (900,000 milliseconds)
      const disabledUntil = now + (15 * 60 * 1000);
      setSyncDisabledUntil(disabledUntil);
      addLog('✓ Sync completed. Button disabled for 15 minutes.', 'success');

      // Set up timer to re-enable after 15 minutes
      setTimeout(() => {
        setSyncDisabledUntil(null);
        addLog('Sync button re-enabled', 'info');
      }, 15 * 60 * 1000);

    } catch (error: any) {
      addLog(`Sync error: ${error.message || String(error)}`, 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  // Fetch Oracle messages from API
  const fetchOracleMessages = async () => {
    if (!oracleApiKey || !oracleApiBaseUrl) {
      return;
    }

    try {
      const category = oracleFilter;
      const url = `${oracleApiBaseUrl}/system-messages?category=${category}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-api-key': oracleApiKey,
        },
      });

      if (!response.ok) {
        console.error('Failed to fetch Oracle messages:', response.status, response.statusText);
        return;
      }

      const data = await response.json();
      
      if (data.success && Array.isArray(data.data)) {
        // Filter out messages we've already seen
        const newMessages = data.data.filter((msg: {id: string}) => !seenMessageIdsRef.current.has(msg.id));
        
        if (newMessages.length > 0) {
          // Add new message IDs to seen set
          newMessages.forEach((msg: {id: string}) => seenMessageIdsRef.current.add(msg.id));
          
          // Update messages with functional update to access current messages
          setOracleMessages(prevMessages => {
            const combined = [...prevMessages, ...newMessages];
            // Sort by createdAt (newest first) and keep only the 5 most recent
            const sorted = combined.sort((a, b) => 
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
            return sorted.slice(0, 5);
          });
        }
      }
    } catch (error) {
      console.error('Error fetching Oracle messages:', error);
    }
  };

  // Update countdown display every minute when sync is disabled
  const [countdownUpdate, setCountdownUpdate] = useState(0);
  useEffect(() => {
    if (syncDisabledUntil && Date.now() < syncDisabledUntil) {
      const interval = setInterval(() => {
        setCountdownUpdate(prev => prev + 1);
        // Clear if time has passed
        if (Date.now() >= syncDisabledUntil) {
          setSyncDisabledUntil(null);
        }
      }, 60000); // Update every minute
      return () => clearInterval(interval);
    }
  }, [syncDisabledUntil, countdownUpdate]);

  // Clear messages when filter changes (different categories have different messages)
  useEffect(() => {
    if (activeTab === 'oracle') {
      setOracleMessages([]);
      seenMessageIdsRef.current = new Set();
    }
  }, [oracleFilter, activeTab]);

  // Poll for Oracle messages every 20 seconds when on Oracle tab
  useEffect(() => {
    if (activeTab !== 'oracle' || !oracleApiKey || !oracleApiBaseUrl) {
      // Clear messages when leaving Oracle tab
      if (activeTab !== 'oracle') {
        setOracleMessages([]);
        seenMessageIdsRef.current = new Set();
      }
      return;
    }

    // Fetch immediately when tab becomes active or filter changes
    fetchOracleMessages();

    // Set up interval to poll every 20 seconds
    const interval = setInterval(() => {
      fetchOracleMessages();
    }, 20000); // 20 seconds

    // Cleanup interval on unmount or tab change
    return () => {
      clearInterval(interval);
    };
  }, [activeTab, oracleFilter, oracleApiKey, oracleApiBaseUrl]);

  // Fully automated download workflow
  const startDownload = async () => {
    setLoading(true);
    addLog('Starting automated download workflow...', 'info');
    
    // Log current AWS config at start
    addLog(`AWS Config: AccessKey=${awsCredentials.accessKeyId ? 'SET' : 'NOT SET'}, Bucket="${awsCredentials.bucket}"`, 'info');
    
    // Run the automated workflow
    await runAutomatedWorkflow();
  };

  // Automated workflow state machine
  const runAutomatedWorkflow = async () => {
    try {
      // Step 1: Get current page state
      addLog('Step 1: Checking current page state...', 'info');
      const state = await getCurrentPageState();
      
      // If no state (not on oro2u.com), navigate to stock page first
      if (!state) {
        addLog('Not on Oro2u domain, navigating to stock page...', 'info');
        await chrome.runtime.sendMessage({ type: 'NAVIGATE_TO_STOCK' });
        await sleep(3000); // Wait for navigation
        
        // Re-check state after navigation
        const newState = await getCurrentPageState();
        if (!newState) {
          addLog('Failed to navigate to stock page', 'error');
          setLoading(false);
          return;
        }
        
        // Continue with the new state
        return await continueWorkflowAfterNavigation(newState);
      }

      // Check for cloudflare
      if (state.hasCloudflare) {
        addLog('Cloudflare challenge detected - please solve manually and try again', 'error');
        setLoading(false);
        return;
      }

      // Step 2: Navigate to stock page if needed
      if (!state.isStockPage) {
        addLog('Step 2: Not on stock page, navigating...', 'info');
        await chrome.runtime.sendMessage({ type: 'NAVIGATE_TO_STOCK' });
        await sleep(3000); // Wait for navigation
        
        // Re-check state after navigation
        const newState = await getCurrentPageState();
        if (!newState || !newState.isStockPage) {
          addLog('Failed to navigate to stock page', 'error');
          setLoading(false);
          return;
        }
        
        // Update state and continue with new state
        return await continueWorkflowAfterNavigation(newState);
      }

      // Step 3: Check if logged in
      if (!state.isLoggedIn) {
        addLog('Step 3: Not logged in, handling authentication...', 'info');
        
        if (autoLogin && email && password) {
          addLog('Using auto-login with saved credentials...', 'info');
          await chrome.runtime.sendMessage({ 
            type: 'NAVIGATE_TO_LOGIN',
            autoLogin: true,
            credentials: { email, password }
          });
          
          // Wait for login and verify redirect
          addLog('Waiting for auto-login to complete...', 'info');
          const loginSuccess = await waitForLoginRedirect();
          
          if (!loginSuccess) {
            addLog('Login verification failed - please check credentials or complete captcha', 'error');
            setLoading(false);
            return;
          }
          
          addLog('✓ Login successful, redirected to account page', 'success');
          
          // Navigate back to stock page
          addLog('Redirecting back to stock page...', 'info');
          await chrome.runtime.sendMessage({ type: 'NAVIGATE_TO_STOCK' });
          await sleep(3000);
          
          // Continue workflow
          const loggedInState = await getCurrentPageState();
          return await continueWorkflowAfterNavigation(loggedInState);
        } else {
          addLog('Auto-login not configured - please log in manually', 'error');
          await chrome.runtime.sendMessage({ type: 'NAVIGATE_TO_LOGIN' });
          setLoading(false);
          return;
        }
      }

      // Step 4: We're on stock page and logged in, download files
      await attemptDownloads();
      
    } catch (error) {
      addLog(`Workflow error: ${error}`, 'error');
      setLoading(false);
    }
  };

  // Continue workflow after navigation
  const continueWorkflowAfterNavigation = async (state: PageState | null) => {
    if (!state) {
      addLog('Failed to get page state after navigation', 'error');
      setLoading(false);
      return;
    }

    // Check cloudflare again
    if (state.hasCloudflare) {
      addLog('Cloudflare challenge appeared - please solve and try again', 'error');
      setLoading(false);
      return;
    }

    // Check if logged in - if not, handle login
    if (!state.isLoggedIn) {
      addLog('Step 3: Not logged in, handling authentication...', 'info');
      
      if (autoLogin && email && password) {
        addLog('Using auto-login with saved credentials...', 'info');
        await chrome.runtime.sendMessage({ 
          type: 'NAVIGATE_TO_LOGIN',
          autoLogin: true,
          credentials: { email, password }
        });
        
        // Wait for login and verify redirect
        addLog('Waiting for auto-login to complete...', 'info');
        const loginSuccess = await waitForLoginRedirect();
        
        if (!loginSuccess) {
          addLog('Login verification failed - please check credentials or complete captcha', 'error');
          setLoading(false);
          return;
        }
        
        addLog('✓ Login successful, redirected to account page', 'success');
        
        // Navigate back to stock page
        addLog('Redirecting back to stock page...', 'info');
        await chrome.runtime.sendMessage({ type: 'NAVIGATE_TO_STOCK' });
        await sleep(3000);
        
        // Continue workflow - check state and attempt download
        const loggedInState = await getCurrentPageState();
        if (!loggedInState || !loggedInState.isLoggedIn) {
          addLog('Login failed or timed out', 'error');
          setLoading(false);
          return;
        }
        
        // Now attempt downloads
        await attemptDownloads();
      } else {
        addLog('Auto-login not configured - please log in manually', 'error');
        await chrome.runtime.sendMessage({ type: 'NAVIGATE_TO_LOGIN' });
        setLoading(false);
        return;
      }
      return;
    }

    // Already logged in, attempt downloads
    await attemptDownloads();
  };

  // Ensure S3 bucket exists and has proper permissions
  // Upload file to S3 via background service worker (avoids CORS and file access issues)
  // Read files from a directory using File System Access API
  // This requires a user gesture (button click)
  // Returns both the file map and the directory handle for cleanup
  const readFilesFromDirectory = async (sessionId: string): Promise<{fileMap: Map<string, Uint8Array>; directoryHandle: any}> => {
    const fileMap = new Map<string, Uint8Array>();
    
    try {
      addLog('Opening directory picker...', 'info');
      addLog(`📁 Navigate to: Downloads/oro-scrape/`, 'info');
      addLog(`📁 Select that folder - only files starting with "${sessionId}-" will be uploaded`, 'info');
      
      // Use Directory Picker API - user selects the folder
      // Note: File System Access API doesn't support auto-opening to specific paths for security
      // User must navigate to the folder manually
      const directoryHandle = await (window as any).showDirectoryPicker();
      
      // Store the directory handle for later cleanup
      setSessionDirectoryHandle(directoryHandle);
      
      // Read all CSV files from the selected directory
      const csvFiles: Array<{name: string; handle: any}> = [];
      
      // Recursively find all CSV files (in case they're in subdirectories)
      const findCsvFiles = async (dirHandle: any, path = '') => {
        for await (const entry of dirHandle.values()) {
          if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.csv')) {
            csvFiles.push({ name: entry.name, handle: entry });
          } else if (entry.kind === 'directory') {
            await findCsvFiles(entry, `${path}/${entry.name}`);
          }
        }
      };
      
      await findCsvFiles(directoryHandle);
      
      if (csvFiles.length === 0) {
        addLog('⚠️ No CSV files found in selected directory', 'error');
        return { fileMap, directoryHandle: null };
      }
      
      // Filter files to only include those starting with the session prefix
      const sessionFiles = csvFiles.filter(({ name }) => name.startsWith(sessionId));
      
      if (sessionFiles.length === 0) {
        addLog(`⚠️ No files found starting with "${sessionId}-" in selected directory`, 'error');
        addLog(`Found ${csvFiles.length} CSV file(s) total, but none match session prefix`, 'info');
        return { fileMap, directoryHandle: null };
      }
      
      addLog(`Found ${sessionFiles.length} file(s) matching session prefix "${sessionId}-"`, 'info');
      if (csvFiles.length > sessionFiles.length) {
        addLog(`(Filtered out ${csvFiles.length - sessionFiles.length} file(s) from other sessions)`, 'info');
      }
      
      // Read only files matching the session prefix
      for (const { name, handle } of sessionFiles) {
        const file = await handle.getFile();
        const arrayBuffer = await file.arrayBuffer();
        
        // Verify file has data
        if (arrayBuffer.byteLength === 0) {
          addLog(`⚠️ ${name} is empty (0 bytes) - skipping`, 'error');
          continue;
        }
        
        // Convert to Uint8Array immediately for reliable storage and transmission
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // Store as Uint8Array for better serialization
        fileMap.set(name, uint8Array);
        addLog(`✓ ${name} read from disk, size: ${(uint8Array.length / 1024 / 1024).toFixed(2)} MB`, 'success');
        addLog(`✓ ${name} first 10 bytes: ${Array.from(uint8Array.slice(0, 10)).join(', ')}`, 'info');
      }
      
      return { fileMap, directoryHandle };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        addLog('Directory selection cancelled - you can click "Upload to S3" again to retry', 'info');
      } else {
        addLog(`Error reading directory: ${error.message}`, 'error');
      }
      return { fileMap, directoryHandle: null };
    }
  };

  // Handle S3 upload button click (user gesture required for directory picker)
  const handleS3UploadClick = async () => {
    if (pendingS3Uploads.length === 0) return;
    
    setProcessingFiles(true);
    
    // Get session ID from the first pending upload (all should have the same session ID)
    const sessionId = pendingS3Uploads[0]?.download.sessionId;
    if (!sessionId) {
      addLog('Error: No session ID found for downloads', 'error');
      setProcessingFiles(false);
      return;
    }
    
    // Update all downloads to show upload pending
    setCurrentDownloads(prev => prev.map(dl => {
      const pending = pendingS3Uploads.find(p => p.download.downloadId === dl.downloadId);
      return pending ? { ...dl, uploadStatus: 'pending' as const } : dl;
    }));
    
    addLog(`Reading files from session folder: ${sessionId}...`, 'info');
    
    // Read all CSV files from the selected directory (user gesture from button click)
    const { fileMap, directoryHandle } = await readFilesFromDirectory(sessionId);
    
    if (fileMap.size === 0) {
      addLog('Directory selection cancelled - upload button still available to try again', 'info');
      setProcessingFiles(false);
      // Keep pending uploads - don't clear them, user can try again
      // Reset upload status
      setCurrentDownloads(prev => prev.map(dl => {
        const pending = pendingS3Uploads.find(p => p.download.downloadId === dl.downloadId);
        return pending ? { ...dl, uploadStatus: undefined } : dl;
      }));
      return;
    }
    
    // Store directory handle for cleanup
    if (directoryHandle) {
      setSessionDirectoryHandle(directoryHandle);
    }
    
    // Check if we got fewer files than expected
    if (fileMap.size < pendingS3Uploads.length) {
      addLog(`⚠️ Found ${fileMap.size} file(s) in directory, but ${pendingS3Uploads.length} expected. Will upload what was found.`, 'info');
    }
    
    // Upload each file
    const storageData = await chrome.storage.local.get(['awsCredentials']);
    const freshAwsCredentials = storageData.awsCredentials || awsCredentials;
    
    let uploadedCount = 0;
    let failedCount = 0;
    const successfullyUploadedIds = new Set<number>();
    
    // Match files by session ID prefix - files are named: {sessionId}-{targetId}.csv
    for (const pending of pendingS3Uploads) {
      const expectedFilename = pending.download.filename || ''; // Format: {sessionId}-{targetId}.csv
      
      // Update status to uploading
      setCurrentDownloads(prev => prev.map(dl => 
        dl.downloadId === pending.download.downloadId 
          ? { ...dl, uploadStatus: 'uploading' as const }
          : dl
      ));
      
      // Match by exact filename (should match since we use unique IDs)
      let fileContent: Uint8Array | undefined = fileMap.get(expectedFilename);
      
      // If exact match fails, try matching by target ID (the part after the session ID)
      if (!fileContent) {
        const targetId = pending.download.targetId;
        for (const [fileName, content] of fileMap.entries()) {
          // Match files that contain the session ID and target ID
          if (fileName.startsWith(sessionId) && fileName.includes(targetId)) {
            fileContent = content;
            addLog(`Matched ${fileName} to ${pending.targetName} by session ID and target ID`, 'info');
            break;
          }
        }
      }
      
      if (!fileContent) {
        const availableFiles = Array.from(fileMap.keys());
        addLog(`${pending.targetName}: File not found in directory`, 'error');
        addLog(`Looking for: ${expectedFilename}`, 'info');
        addLog(`Available files: ${availableFiles.join(', ') || 'none'}`, 'info');
        addLog(`💡 Click "Upload to S3" again and select the correct folder for session ${sessionId}`, 'info');
        
        setCurrentDownloads(prev => prev.map(dl => 
          dl.downloadId === pending.download.downloadId 
            ? { ...dl, uploadStatus: 'failed' as const }
            : dl
        ));
        failedCount++;
        // Keep this in pending list so user can retry
        continue;
      }
      
      addLog(`${pending.targetName}: Uploading to S3...`, 'info');
      addLog(`${pending.targetName}: File size: ${(fileContent.length / 1024 / 1024).toFixed(2)} MB`, 'info');
      addLog(`${pending.targetName}: First 10 bytes: ${Array.from(fileContent.slice(0, 10)).join(', ')}`, 'info');
      
      // Verify file content is not empty
      if (fileContent.length === 0) {
        addLog(`${pending.targetName}: ERROR - File content is empty!`, 'error');
        setCurrentDownloads(prev => prev.map(dl => 
          dl.downloadId === pending.download.downloadId 
            ? { ...dl, uploadStatus: 'failed' as const, error: 'File content is empty' }
            : dl
        ));
        failedCount++;
        continue;
      }
      
      // Convert Uint8Array to plain array for reliable serialization through chrome.runtime.sendMessage
      // Uint8Array doesn't serialize correctly, but plain arrays do
      const fileDataArray = Array.from(fileContent);
      addLog(`${pending.targetName}: Converted to array, size: ${fileDataArray.length} bytes`, 'info');
      
      // Verify it's still not empty
      if (fileDataArray.length === 0) {
        addLog(`${pending.targetName}: ERROR - Array is empty!`, 'error');
        setCurrentDownloads(prev => prev.map(dl => 
          dl.downloadId === pending.download.downloadId 
            ? { ...dl, uploadStatus: 'failed' as const, error: 'Array is empty' }
            : dl
        ));
        failedCount++;
        continue;
      }
      
      let response: any;
      try {
        response = await chrome.runtime.sendMessage({
          type: 'UPLOAD_TO_S3',
          fileContent: fileDataArray, // Send as plain array - will be converted back to Uint8Array in background
          s3Key: pending.s3Key,
          awsCredentials: freshAwsCredentials,
          targetName: pending.targetName,
        });
      } catch (error: any) {
        addLog(`${pending.targetName}: Error sending to background worker: ${error.message || String(error)}`, 'error');
        setCurrentDownloads(prev => prev.map(dl => 
          dl.downloadId === pending.download.downloadId 
            ? { ...dl, uploadStatus: 'failed' as const, error: `Send error: ${error.message || String(error)}` }
            : dl
        ));
        failedCount++;
        continue;
      }
      
      if (response && response.success) {
        addLog(`✓ ${pending.targetName}: Uploaded to S3: ${response.url}`, 'success');
        uploadedCount++;
        successfullyUploadedIds.add(pending.download.downloadId);
        
        // Update download card with success
        setCurrentDownloads(prev => prev.map(dl => 
          dl.downloadId === pending.download.downloadId 
            ? { ...dl, uploadStatus: 'uploaded' as const, s3Url: response.url }
            : dl
        ));
        
        // Delete the file after successful upload
        try {
          await chrome.downloads.removeFile(pending.download.downloadId);
          await chrome.downloads.erase({ id: pending.download.downloadId });
          addLog(`✓ ${pending.download.filename} deleted`, 'success');
        } catch (error) {
          addLog(`Could not delete file: ${error}`, 'error');
        }
      } else {
        addLog(`${pending.targetName}: S3 upload failed: ${response?.error || 'Unknown error'}`, 'error');
        
        setCurrentDownloads(prev => prev.map(dl => 
          dl.downloadId === pending.download.downloadId 
            ? { ...dl, uploadStatus: 'failed' as const, error: response?.error || 'Unknown error' }
            : dl
        ));
        failedCount++;
      }
    }
    
    // Final confirmation
    if (uploadedCount > 0) {
      addLog(`🎉 SUCCESS! ${uploadedCount} file(s) uploaded to S3 bucket '${freshAwsCredentials.bucket}'`, 'success');
    }
    if (failedCount > 0) {
      addLog(`⚠️ ${failedCount} file(s) failed to upload - click "Upload to S3" again to retry`, 'error');
    }
    
    setProcessingFiles(false);
    
    // Update pending list - remove successfully uploaded files, keep failed ones for retry
    setPendingS3Uploads(prev => {
      const remaining = prev.filter(p => !successfullyUploadedIds.has(p.download.downloadId));
      
      if (remaining.length === 0 && prev.length > 0) {
        addLog('✓ All files uploaded and processed!', 'success');
        // Try to clean up the empty session folder
        cleanupSessionFolder(sessionId);
      } else if (remaining.length < prev.length) {
        addLog(`✓ ${prev.length - remaining.length} file(s) uploaded. ${remaining.length} remaining - click "Upload to S3" again to retry.`, 'info');
        const remainingNames = remaining.map(r => r.download.filename).join(', ');
        addLog(`Still need: ${remainingNames}`, 'info');
      }
      
      return remaining;
    });
  };

  // Clean up session files after all files are processed
  // Note: Files are already deleted after upload via chrome.downloads.removeFile()
  // This function just clears the directory handle reference
  const cleanupSessionFolder = async (sessionId: string) => {
    try {
      // Clear the directory handle since we're done with it
      // Files are already deleted individually after upload
      if (sessionDirectoryHandle) {
        // Handle was used, now clearing it
        setSessionDirectoryHandle(null);
      }
      addLog(`✓ All session files (${sessionId}) processed and cleaned up`, 'success');
    } catch (error: any) {
      addLog(`⚠️ Error during cleanup: ${error.message}`, 'error');
    }
  };


  // Process downloaded files once all complete
  const processDownloadedFiles = async (downloads: TrackedDownload[]) => {
    setProcessingFiles(true);
    addLog('All downloads complete! Processing files...', 'success');
    
    // CRITICAL: Read fresh values from storage to avoid stale closure
    const storageData = await chrome.storage.local.get(['awsCredentials', 'downloadTargets']);
    const freshAwsCredentials = storageData.awsCredentials || awsCredentials;
    const freshDownloadTargets = storageData.downloadTargets || downloadTargets;
    
    addLog(`Fresh AWS check: AccessKey=${freshAwsCredentials.accessKeyId ? 'SET' : 'NOT SET'}, Bucket="${freshAwsCredentials.bucket}"`, 'info');
    
    const completed = downloads.filter(dl => dl.status === 'completed' && dl.filepath);
    
    // Check if any S3 uploads are configured
    const hasS3Uploads = completed.some(dl => {
      const target = freshDownloadTargets.find((t: DownloadTarget) => t.id === dl.targetId);
      return target?.s3Key && freshAwsCredentials.bucket && freshAwsCredentials.accessKeyId;
    });
    
    if (hasS3Uploads) {
      addLog(`S3 uploads configured for bucket: ${freshAwsCredentials.bucket}`, 'info');
    }
    
    // Collect files that need S3 upload
    const uploadsNeeded: Array<{download: TrackedDownload; s3Key: string; targetName: string}> = [];
    
    for (const download of completed) {
      try {
        if (!download.filepath) continue;
        
        addLog(`Processing ${download.targetName}...`, 'info');
        
        // Use chrome.downloads API to get file
        const results = await chrome.downloads.search({ id: download.downloadId });
        if (results && results.length > 0 && results[0].exists) {
          const sizeMB = ((download.filesize || 0) / 1024 / 1024).toFixed(2);
          addLog(`${download.targetName}: ${download.filename} (${sizeMB} MB)`, 'info');
          
          // Find target to get S3 key
          const target = freshDownloadTargets.find((t: DownloadTarget) => t.id === download.targetId);
          
          // Check if S3 upload is needed
          if (target?.s3Key && freshAwsCredentials.bucket && freshAwsCredentials.accessKeyId) {
            uploadsNeeded.push({
              download,
              s3Key: target.s3Key,
              targetName: download.targetName
            });
            addLog(`${download.targetName}: Ready for S3 upload`, 'info');
          } else {
            // No S3 upload needed, delete file immediately
            addLog(`Deleting ${download.filename}...`, 'info');
            try {
              await chrome.downloads.removeFile(download.downloadId);
              await chrome.downloads.erase({ id: download.downloadId });
              addLog(`✓ ${download.filename} deleted`, 'success');
            } catch (removeError) {
              addLog(`Could not delete file: ${removeError}`, 'error');
            }
          }
        }
      } catch (error) {
        addLog(`Error processing ${download.targetName}: ${error}`, 'error');
      }
    }
    
    // If S3 uploads are needed, show button instead of uploading automatically
    if (uploadsNeeded.length > 0) {
      setPendingS3Uploads(uploadsNeeded);
      const sessionId = uploadsNeeded[0]?.download.sessionId;
      if (sessionId) {
        addLog(`📤 ${uploadsNeeded.length} file(s) ready for S3 upload. Click "Upload to S3" button.`, 'info');
        addLog(`📁 Session ID: ${sessionId}`, 'info');
        addLog(`💡 When prompted, select the "oro-scrape" folder - only files starting with "${sessionId}-" will be uploaded`, 'info');
      } else {
        addLog(`📤 ${uploadsNeeded.length} file(s) ready for S3 upload. Click "Upload to S3" button.`, 'info');
      }
    } else {
      addLog('✓ Processing complete! All files processed.', 'success');
    }
    
    setProcessingFiles(false);
    setLoading(false);
  };

  // Wait for a download to complete
  const waitForDownloadComplete = (downloadId: number): Promise<void> => {
    return new Promise((resolve) => {
      const checkInterval = setInterval(async () => {
        const results = await chrome.downloads.search({ id: downloadId });
        if (results && results.length > 0) {
          const download = results[0];
          if (download.state === 'complete') {
            clearInterval(checkInterval);
            resolve();
          } else if (download.state === 'interrupted') {
            clearInterval(checkInterval);
            resolve(); // Resolve anyway to continue
          }
        }
      }, 500); // Check every 500ms
    });
  };

  // Attempt to download all enabled targets (sequential)
  const attemptDownloads = async () => {
    const enabled = downloadTargets.filter(t => t.enabled);
    
    if (enabled.length === 0) {
      addLog('No download targets enabled', 'error');
      setLoading(false);
      return;
    }

    addLog(`Step 4: Downloading ${enabled.length} file(s) sequentially...`, 'info');
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      addLog('No active tab found', 'error');
      setLoading(false);
      return;
    }

    // Generate unique session ID for this download batch
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    addLog(`📁 Session ID: ${sessionId}`, 'info');
    addLog(`📁 Files will be saved to: oro-scrape/ with prefix "${sessionId}-"`, 'info');

    // Initialize download tracking - all start as pending
    const initialDownloads: TrackedDownload[] = enabled.map(target => ({
      targetId: target.id,
      targetName: target.name,
      downloadId: -1,
      filename: target.filename || 'pending',
      startTime: Date.now(),
      status: 'pending' as const,
      sessionId: sessionId,
    }));
    
    setCurrentDownloads(initialDownloads);

    // Process downloads one by one
    for (let i = 0; i < enabled.length; i++) {
      const target = enabled[i];
      
      addLog(`[${i + 1}/${enabled.length}] Starting ${target.name}...`, 'info');
      
      // Set up listener for this specific download
      let capturedDownloadId: number | null = null;
      const downloadListener = (downloadItem: chrome.downloads.DownloadItem) => {
        if (capturedDownloadId === null) {
          capturedDownloadId = downloadItem.id;
          
          // Update this specific download
          setCurrentDownloads(prev => 
            prev.map((dl, idx) => 
              idx === i ? {
                ...dl,
                downloadId: downloadItem.id,
                status: 'downloading' as const,
                filename: downloadItem.filename || dl.filename,
              } : dl
            )
          );
        }
      };

      chrome.downloads.onCreated.addListener(downloadListener);

      try {
        // Get download URL from the link
        const urlResponse = await new Promise<any>((resolve) => {
          chrome.tabs.sendMessage(
            tab.id!,
            { type: 'GET_DOWNLOAD_URL', selector: target.selector },
            resolve
          );
        });

        if (urlResponse?.success && urlResponse.url) {
          // Download directly using chrome.downloads API
          // Use unique filename: {sessionId}-{targetId}.csv
          // All files go directly into oro-scrape/ folder (no subfolders)
          const uniqueFilename = `${sessionId}-${target.id}.csv`;
          const downloadPath = `oro-scrape/${uniqueFilename}`;
          
          try {
            const downloadId = await chrome.downloads.download({
              url: urlResponse.url,
              filename: downloadPath,
              saveAs: false, // Don't prompt user
            });
            
            capturedDownloadId = downloadId;
            
            // Update status
            setCurrentDownloads(prev => 
              prev.map((dl, idx) => 
                idx === i ? {
                  ...dl,
                  downloadId: downloadId,
                  status: 'downloading' as const,
                  filename: uniqueFilename,
                  sessionId: sessionId,
                } : dl
              )
            );
          } catch (downloadError) {
            addLog(`${target.name}: Download failed - ${downloadError}`, 'error');
            setCurrentDownloads(prev => 
              prev.map((dl, idx) => 
                idx === i ? { ...dl, status: 'failed' as const, error: String(downloadError) } : dl
              )
            );
            chrome.downloads.onCreated.removeListener(downloadListener);
            await sleep(1000);
            continue;
          }
        } else {
          // Fallback to clicking if URL extraction fails
          addLog(`${target.name}: Using click method (URL extraction failed)`, 'info');
          const response = await new Promise<any>((resolve) => {
            chrome.tabs.sendMessage(
              tab.id!,
              { type: 'CLICK_DOWNLOAD', selector: target.selector },
              resolve
            );
          });

          if (!response?.success) {
            setCurrentDownloads(prev => 
              prev.map((dl, idx) => 
                idx === i ? { ...dl, status: 'failed' as const, error: response?.message || 'Button not found' } : dl
              )
            );
            
            chrome.downloads.onCreated.removeListener(downloadListener);
            await sleep(1000);
            continue;
          }
        }

        // Wait for download to be created (max 5 seconds)
        let waitTime = 0;
        while (capturedDownloadId === null && waitTime < 5000) {
          await sleep(100);
          waitTime += 100;
        }

        if (capturedDownloadId === null) {
          addLog(`${target.name}: Download not started (timeout)`, 'error');
          setCurrentDownloads(prev => 
            prev.map((dl, idx) => 
              idx === i ? { ...dl, status: 'failed' as const, error: 'Download timeout' } : dl
            )
          );
          chrome.downloads.onCreated.removeListener(downloadListener);
          await sleep(1000);
          continue;
        }

        addLog(`${target.name}: Download started, waiting for completion...`, 'info');

        // Wait for this download to complete
        await waitForDownloadComplete(capturedDownloadId);
        
        addLog(`${target.name}: Download completed`, 'success');

        chrome.downloads.onCreated.removeListener(downloadListener);

        // Wait between downloads to be polite
        if (i < enabled.length - 1) {
          addLog(`Waiting 3 seconds before next download...`, 'info');
          await sleep(3000);
        }

      } catch (error) {
        addLog(`${target.name}: Error - ${error}`, 'error');
        setCurrentDownloads(prev => 
          prev.map((dl, idx) => 
            idx === i ? { ...dl, status: 'failed' as const, error: String(error) } : dl
          )
        );
        chrome.downloads.onCreated.removeListener(downloadListener);
        await sleep(1000);
      }
    }

    addLog(`All downloads initiated`, 'success');
  };

  // Get current page state (promisified)
  const getCurrentPageState = (): Promise<PageState | null> => {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]?.id) {
          resolve(null);
          return;
        }

        chrome.tabs.sendMessage(
          tabs[0].id,
          { type: 'CHECK_STATE' },
          (response: PageState) => {
            if (chrome.runtime.lastError) {
              resolve(null);
            } else {
              setPageState(response);
              resolve(response);
            }
          }
        );
      });
    });
  };

  // Sleep utility
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // Wait for login redirect and verify success
  const waitForLoginRedirect = async (): Promise<boolean> => {
    // First, wait for login page to load and credentials to be submitted
    addLog('Waiting for login form submission...', 'info');
    await sleep(3000); // Wait for navigation to login page + form submission
    
    const maxAttempts = 20; // 20 seconds total after initial wait
    const checkInterval = 1000; // Check every 1 second
    
    addLog('Monitoring for redirect to account page...', 'info');
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await sleep(checkInterval);
      
      // Get current tab URL
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) continue;
      
      const url = tab.url;
      
      // Check 1: If redirected to account page (successful login)
      // Must be account page but NOT login page
      if ((url.includes('oro2u.com/customer/account/') || url.includes('oro2u.com/customer/account')) 
          && !url.includes('login')) {
        addLog('Detected redirect to account page', 'info');
        
        // Verify login state
        const state = await getCurrentPageState();
        if (state && state.isLoggedIn) {
          return true;
        }
      }
      
      // Check 2: Verify login state on any Oro2u page
      const state = await getCurrentPageState();
      if (state) {
        // If logged in according to state check
        if (state.isLoggedIn) {
          addLog('Login verified via page state check', 'info');
          return true;
        }
        
        // Still on login page - check if there's a captcha or error
        if (url.includes('customer/account/login')) {
          // Every 5 seconds, update user
          if (attempt % 5 === 0 && attempt > 0) {
            addLog(`Still on login page... (${attempt}s elapsed - check for captcha)`, 'info');
          }
        }
      }
    }
    
    // Timeout reached
    addLog('Login timeout - still on login page after 20 seconds', 'error');
    return false;
  };

  // Listen for download events
  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === 'DOWNLOAD_STARTED') {
        // Update tracked download status
        setCurrentDownloads(prev => 
          prev.map(dl => 
            dl.downloadId === message.downloadId 
              ? { ...dl, status: 'downloading' as const, filename: message.filename }
              : dl
          )
        );
      } else if (message.type === 'DOWNLOAD_COMPLETED') {
        // Update tracked download with completion info
        setCurrentDownloads(prev => {
          const updated = prev.map(dl => 
            dl.downloadId === message.downloadId 
              ? { 
                  ...dl, 
                  status: 'completed' as const,
                  filename: message.filename,
                  filepath: message.filepath,
                  filesize: message.filesize,
                  duration: message.duration
                }
              : dl
          );
          
          // Check if all downloads complete
          const allComplete = updated.every(dl => 
            dl.status === 'completed' || dl.status === 'failed'
          );
          
          if (allComplete && updated.length > 0) {
            // All downloads done, process files
            setTimeout(() => processDownloadedFiles(updated), 1000);
          }
          
          return updated;
        });
      } else if (message.type === 'DOWNLOAD_FAILED') {
        setCurrentDownloads(prev => 
          prev.map(dl => 
            dl.downloadId === message.downloadId 
              ? { ...dl, status: 'failed' as const, error: message.error }
              : dl
          )
        );
      } else if (message.type === 'PAGE_CHANGED') {
        addLog('Page changed - checking state...', 'info');
        setTimeout(checkPageState, 1000);
      } else if (message.type === 'AUTO_LOGIN_ATTEMPT') {
        if (message.success) {
          addLog('Auto-login: credentials submitted', 'success');
        } else {
          addLog(`Auto-login failed: ${message.message}`, 'error');
        }
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // Check page state on mount
  useEffect(() => {
    checkPageState();
  }, []);

  return (
    <div className="w-full min-h-screen bg-background text-foreground p-4">
      <Card className="border-0 shadow-none max-w-[600px] mx-auto">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <div>
              <div>ORACLE2U</div>
              <div className="text-[10px] font-normal text-muted-foreground mt-1">
                Side Panel (stays open while you work)
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSettings(!showSettings)}
              className="h-7 w-7"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Settings Section */}
          {showSettings && (
            <div className="space-y-3 pb-3 border-b">
              <div className="mb-3">
                <select 
                  value={settingsTab} 
                  onChange={(e) => setSettingsTab(e.target.value)}
                  className="w-full p-2 border rounded text-sm font-medium"
                >
                  <option value="targets">📥 Download Targets</option>
                  <option value="login">🔐 Auto-Login</option>
                  <option value="aws">☁️ AWS S3</option>
                  <option value="oracle">🔮 Oracle</option>
                </select>
              </div>

              {settingsTab === 'targets' && (
                <div className="space-y-3">
                  {downloadTargets.map((target) => (
                    <div key={target.id} className="space-y-2 p-2 border rounded">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`enable-${target.id}`}
                          checked={target.enabled}
                          onChange={() => toggleTarget(target.id)}
                          className="h-3 w-3 rounded border-gray-300"
                        />
                        <Label htmlFor={`enable-${target.id}`} className="text-xs font-medium flex-1">
                          {target.name}
                        </Label>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">CSS Selector</Label>
                        <Input
                          value={target.selector}
                          onChange={(e) => updateTarget(target.id, { selector: e.target.value })}
                          className="h-7 text-[10px] font-mono"
                          placeholder="CSS selector"
                          disabled={!target.enabled}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">
                          Custom Filename
                        </Label>
                        <Input
                          value={target.filename || ''}
                          onChange={(e) => updateTarget(target.id, { filename: e.target.value })}
                          className="h-7 text-[10px]"
                          placeholder="e.g., stock-data.csv"
                          disabled={!target.enabled}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">
                          S3 Key
                        </Label>
                        <Input
                          value={target.s3Key || ''}
                          onChange={(e) => updateTarget(target.id, { s3Key: e.target.value })}
                          className="h-7 text-[10px]"
                          placeholder="e.g., data/stock.csv"
                          disabled={!target.enabled}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {settingsTab === 'login' && (
                <div className="space-y-2 pt-2">
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="checkbox"
                      id="autoLogin"
                      checked={autoLogin}
                      onChange={(e) => setAutoLogin(e.target.checked)}
                      className="h-3 w-3 rounded border-gray-300"
                    />
                    <Label htmlFor="autoLogin" className="text-xs font-medium">
                      Enable Auto-Login
                    </Label>
                  </div>
                  
                  {autoLogin && (
                    <>
                      <div className="space-y-1">
                        <Label htmlFor="email" className="text-xs">Email</Label>
                        <Input
                          id="email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="h-8 text-xs"
                          placeholder="your@email.com"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="password" className="text-xs">Password</Label>
                        <Input
                          id="password"
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="h-8 text-xs"
                          placeholder="••••••••"
                        />
                      </div>
                      <div className="text-[10px] text-muted-foreground bg-gray-50 p-2 rounded border">
                        ⚠️ Credentials stored locally in Chrome storage
                      </div>
                    </>
                  )}
                </div>
              )}

              {settingsTab === 'aws' && (
                <div className="space-y-2 pt-2">
                  {!awsCredentials.accessKeyId && (
                    <div className="text-xs bg-yellow-50 border border-yellow-200 p-2 rounded">
                      ⚠️ AWS credentials required for S3 upload
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Access Key ID *</Label>
                    <Input
                      type="text"
                      value={awsCredentials.accessKeyId}
                      onChange={(e) => setAwsCredentials({...awsCredentials, accessKeyId: e.target.value.trim()})}
                      className="h-8 text-xs font-mono"
                      placeholder="AKIA..."
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Secret Access Key *</Label>
                    <Input
                      type="password"
                      value={awsCredentials.secretAccessKey}
                      onChange={(e) => setAwsCredentials({...awsCredentials, secretAccessKey: e.target.value.trim()})}
                      className="h-8 text-xs font-mono"
                      placeholder="••••••••"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Region</Label>
                    <Input
                      type="text"
                      value={awsCredentials.region}
                      onChange={(e) => setAwsCredentials({...awsCredentials, region: e.target.value.trim()})}
                      className="h-8 text-xs"
                      placeholder="us-east-1"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Bucket Name</Label>
                    <Input
                      type="text"
                      value={awsCredentials.bucket}
                      onChange={(e) => setAwsCredentials({...awsCredentials, bucket: e.target.value.trim()})}
                      className="h-8 text-xs"
                      placeholder="oro"
                    />
                  </div>
                  <div className="text-[10px] text-muted-foreground bg-gray-50 p-2 rounded border">
                    💾 Remember to click "Save Settings" below!
                  </div>
                </div>
              )}

              {settingsTab === 'oracle' && (
                <div className="space-y-2 pt-2">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Oracle API Key</Label>
                    <Input
                      type="password"
                      value={oracleApiKey}
                      onChange={(e) => setOracleApiKey(e.target.value.trim())}
                      className="h-8 text-xs font-mono"
                      placeholder="Enter your Oracle API Key"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">API Base URL</Label>
                    <Input
                      type="text"
                      value={oracleApiBaseUrl}
                      onChange={(e) => setOracleApiBaseUrl(e.target.value.trim())}
                      className="h-8 text-xs font-mono"
                      placeholder="https://admin.2bros.uk/api/v1/extension"
                    />
                  </div>
                  <div className="text-[10px] text-muted-foreground bg-gray-50 p-2 rounded border">
                    💾 Remember to click "Save Settings" below!
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button
                  onClick={saveSettings}
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs flex-1"
                >
                  Save Settings
                </Button>
                <Button
                  onClick={() => {
                    setDownloadTargets(DEFAULT_TARGETS);
                    setEmail('');
                    setPassword('');
                    setAutoLogin(false);
                    setAwsCredentials({ accessKeyId: '', secretAccessKey: '', region: 'us-east-1', bucket: 'oro' });
                    setOracleApiKey('');
                    setOracleApiBaseUrl('https://admin.2bros.uk/api/v1/extension');
                    setSyncOptions({ stock: true, pricing: true });
                  }}
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                >
                  Reset
                </Button>
              </div>
            </div>
          )}

          {/* Status Section */}
          {pageState && (
            <div className="space-y-2 pb-3 border-b">
              <div className="text-xs font-medium">Page Status</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1">
                  <div className={`w-2 h-2 rounded-full ${pageState.isLoggedIn ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span>{pageState.isLoggedIn ? 'Logged In' : 'Not Logged In'}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className={`w-2 h-2 rounded-full ${pageState.isStockPage ? 'bg-green-500' : 'bg-gray-400'}`} />
                  <span>{pageState.isStockPage ? 'Stock Page' : 'Other Page'}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className={`w-2 h-2 rounded-full ${pageState.hasDownloadButton ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span>{pageState.hasDownloadButton ? 'Button Found' : 'Button Missing'}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className={`w-2 h-2 rounded-full ${pageState.hasCloudflare ? 'bg-yellow-500' : 'bg-green-500'}`} />
                  <span>{pageState.hasCloudflare ? 'Cloudflare' : 'Clear'}</span>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-2">
            <Button
              onClick={startDownload}
              disabled={loading || enabledCount === 0}
              className="w-full h-9 text-sm"
            >
              {loading ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              {loading ? 'Processing...' : `Download ${enabledCount} File${enabledCount !== 1 ? 's' : ''}`}
            </Button>
            
            {loading && (
              <div className="text-[10px] text-center text-muted-foreground">
                Running automated workflow - please wait...
              </div>
            )}
            {enabledCount === 0 && !loading && (
              <div className="text-[10px] text-center text-red-600">
                No files selected - enable at least one in settings
              </div>
            )}
            {pendingS3Uploads.length > 0 && (() => {
              // Count uploads in progress and completed
              const uploadedCount = pendingS3Uploads.filter(p => {
                const dl = currentDownloads.find(d => d.downloadId === p.download.downloadId);
                return dl?.uploadStatus === 'uploaded';
              }).length;
              const uploadingCount = pendingS3Uploads.filter(p => {
                const dl = currentDownloads.find(d => d.downloadId === p.download.downloadId);
                return dl?.uploadStatus === 'uploading';
              }).length;
              const remainingCount = pendingS3Uploads.length - uploadedCount;
              
              return (
                <div className="space-y-2">
                  <Button
                    onClick={handleS3UploadClick}
                    disabled={processingFiles || uploadingCount > 0}
                    className="w-full h-9 text-sm bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                  >
                    {processingFiles || uploadingCount > 0 ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Uploading... ({uploadedCount}/{pendingS3Uploads.length})
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Upload {remainingCount} File{remainingCount !== 1 ? 's' : ''} to S3
                      </>
                    )}
                  </Button>
                {!processingFiles && pendingS3Uploads.length > 0 && (
                  <div className="text-[10px] space-y-1 p-2 bg-gray-50 rounded border">
                    <div className="font-medium text-gray-700">Files to upload:</div>
                    {pendingS3Uploads.map((p, idx) => {
                      const download = currentDownloads.find(d => d.downloadId === p.download.downloadId);
                      const status = download?.uploadStatus;
                      const isUploaded = status === 'uploaded';
                      const isFailed = status === 'failed';
                      const isUploading = status === 'uploading';
                      
                      return (
                        <div key={idx} className={`flex items-center gap-1 ${
                          isUploaded ? 'text-green-600 line-through' :
                          isFailed ? 'text-red-600' :
                          isUploading ? 'text-blue-600' :
                          'text-gray-600'
                        }`}>
                          <span className="font-bold">
                            {isUploaded ? '✓' : isFailed ? '✗' : isUploading ? '⬆' : '○'}
                          </span>
                          <span className="flex-1">{p.download.filename}</span>
                          {isFailed && <span className="text-[9px]">(retry needed)</span>}
                        </div>
                      );
                    })}
                    {pendingS3Uploads.some(p => {
                      const d = currentDownloads.find(dl => dl.downloadId === p.download.downloadId);
                      return d?.uploadStatus === 'failed';
                    }) && (
                      <div className="text-[9px] text-red-600 mt-1 pt-1 border-t">
                        Some files failed - click button again to retry
                      </div>
                    )}
                  </div>
                )}
                </div>
              );
            })()}
            {oracleApiKey && (() => {
              const now = Date.now();
              const isSyncDisabled = !!(syncDisabledUntil && now < syncDisabledUntil);
              const syncDisabled = loading || processingFiles || isSyncing || isSyncDisabled;
              const minutesRemaining = syncDisabledUntil && now < syncDisabledUntil 
                ? Math.ceil((syncDisabledUntil - now) / 60000) 
                : 0;
              
              return (
                <DropdownMenu modal={false}>
                  <div className="flex w-full">
                    <Button
                      onClick={handleSync}
                      variant="outline"
                      size="sm"
                      className="flex-1 h-8 text-xs rounded-r-none"
                      disabled={syncDisabled}
                    >
                      {isSyncing ? 'Syncing...' : isSyncDisabled ? `Sync (${minutesRemaining}m)` : 'Sync'}
                    </Button>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-xs rounded-l-none border-l-0"
                        disabled={syncDisabled}
                      >
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                  </div>
                <DropdownMenuContent 
                  align="end" 
                  className="w-40"
                >
                  <DropdownMenuCheckboxItem
                    checked={syncOptions.stock}
                    onCheckedChange={(checked) => {
                      // Prevent disabling if pricing is already disabled
                      if (!checked && !syncOptions.pricing) {
                        return; // Don't allow both to be disabled
                      }
                      const newOptions = { ...syncOptions, stock: checked };
                      setSyncOptions(newOptions);
                      // Auto-save to storage
                      chrome.storage.local.set({ syncOptions: newOptions });
                    }}
                    onSelect={(e) => {
                      e.preventDefault();
                    }}
                  >
                    Stock
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={syncOptions.pricing}
                    onCheckedChange={(checked) => {
                      // Prevent disabling if stock is already disabled
                      if (!checked && !syncOptions.stock) {
                        return; // Don't allow both to be disabled
                      }
                      const newOptions = { ...syncOptions, pricing: checked };
                      setSyncOptions(newOptions);
                      // Auto-save to storage
                      chrome.storage.local.set({ syncOptions: newOptions });
                    }}
                    onSelect={(e) => {
                      e.preventDefault();
                    }}
                  >
                    Pricing
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
              );
            })()}
          </div>

          {/* Tabs for Downloads and Activity Log */}
          <div className="pt-3 border-t">
            <div className="flex border-b mb-3">
              <button
                onClick={() => setActiveTab('downloads')}
                className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === 'downloads' 
                    ? 'border-black text-black' 
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Downloads {currentDownloads.length > 0 && `(${currentDownloads.length})`}
              </button>
              <button
                onClick={() => setActiveTab('logs')}
                className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === 'logs' 
                    ? 'border-black text-black' 
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Activity {logs.length > 0 && `(${logs.length})`}
              </button>
              {oracleApiKey && (
                <button
                  onClick={() => setActiveTab('oracle')}
                  className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                    activeTab === 'oracle' 
                      ? 'border-black text-black' 
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Oracle
                </button>
              )}
            </div>

            {/* Downloads Tab */}
            {activeTab === 'downloads' && (
              <div className="space-y-2">
                {currentDownloads.length === 0 ? (
                  <div className="text-xs text-gray-400 text-center py-4">No downloads yet</div>
                ) : (
                  <>
                    {currentDownloads.map((download, idx) => (
                      <div key={idx} className="border rounded p-2 text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium">{download.targetName}</span>
                          <div className="flex items-center gap-1">
                            <span className={`text-[10px] px-2 py-0.5 rounded ${
                              download.status === 'completed' ? 'bg-green-100 text-green-800' :
                              download.status === 'downloading' ? 'bg-blue-100 text-blue-800' :
                              download.status === 'failed' ? 'bg-red-100 text-red-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {download.status === 'completed' ? '✓ Complete' :
                               download.status === 'downloading' ? '↓ Downloading' :
                               download.status === 'failed' ? '✗ Failed' :
                               '⋯ Pending'}
                            </span>
                            {download.uploadStatus && (
                              <span className={`text-[10px] px-2 py-0.5 rounded ${
                                download.uploadStatus === 'uploaded' ? 'bg-green-100 text-green-800' :
                                download.uploadStatus === 'uploading' ? 'bg-blue-100 text-blue-800' :
                                download.uploadStatus === 'failed' ? 'bg-red-100 text-red-800' :
                                'bg-yellow-100 text-yellow-800'
                              }`}>
                                {download.uploadStatus === 'uploaded' ? '☁️ Uploaded' :
                                 download.uploadStatus === 'uploading' ? '⬆️ Uploading' :
                                 download.uploadStatus === 'failed' ? '✗ Upload Failed' :
                                 '⏳ Upload Pending'}
                              </span>
                            )}
                          </div>
                        </div>
                        {download.status === 'completed' && (
                          <div className="text-[10px] text-muted-foreground space-y-0.5">
                            <div>📁 {download.filename}</div>
                            {download.filesize && (
                              <div>📊 {(download.filesize / 1024 / 1024).toFixed(2)} MB</div>
                            )}
                            {download.duration && (
                              <div>⏱️ {(download.duration / 1000).toFixed(1)}s</div>
                            )}
                            {download.uploadStatus === 'uploaded' && download.s3Url && (
                              <div className="text-green-600 mt-1">
                                ☁️ <a href={download.s3Url} target="_blank" rel="noopener noreferrer" className="underline">
                                  View on S3
                                </a>
                              </div>
                            )}
                          </div>
                        )}
                        {download.status === 'failed' && download.error && (
                          <div className="text-[10px] text-red-600 mt-1">
                            {download.error}
                          </div>
                        )}
                        {download.uploadStatus === 'failed' && (
                          <div className="text-[10px] text-red-600 mt-1">
                            Upload failed - check activity log
                          </div>
                        )}
                      </div>
                    ))}
                    {processingFiles && (
                      <div className="text-xs text-center py-2 text-blue-600">
                        <RefreshCw className="h-3 w-3 inline animate-spin mr-1" />
                        Processing files...
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Activity Log Tab */}
            {activeTab === 'logs' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium">Activity Log</div>
                  {logs.length > 0 && (
                    <Button
                      onClick={clearLogs}
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] px-2"
                    >
                      Clear
                    </Button>
                  )}
                </div>
                {logs.length === 0 ? (
                  <div className="text-xs text-gray-400 text-center py-4">No activity yet</div>
                ) : (
                  <div className="space-y-1 max-h-[300px] overflow-y-auto">
                    {logs.map((log, i) => (
                      <div
                        key={i}
                        className={`text-xs p-2 rounded border ${
                          log.type === 'success'
                            ? 'bg-green-50 border-green-200'
                            : log.type === 'error'
                            ? 'bg-red-50 border-red-200'
                            : 'bg-gray-50 border-gray-200'
                        }`}
                      >
                        <div className="flex justify-between items-start gap-2">
                          <span className="flex-1 break-words">{log.message}</span>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {log.timestamp}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Oracle Tab */}
            {activeTab === 'oracle' && oracleApiKey && (
              <div className="space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium">Oracle Sync</div>
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-3 w-3 text-gray-300 animate-spin" />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-[10px] px-2"
                        >
                          <Filter className="h-3 w-3 mr-1" />
                          {oracleFilter}
                          <ChevronDown className="h-3 w-3 ml-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-32">
                        <DropdownMenuRadioGroup value={oracleFilter} onValueChange={(value) => setOracleFilter(value as 'stock' | 'pricing')}>
                          <DropdownMenuRadioItem value="stock">Stock</DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="pricing">Pricing</DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="space-y-2 text-xs">
                  {oracleMessages.length === 0 ? (
                    <div className="p-2 rounded border bg-gray-50 border-gray-200">
                      <div className="text-[10px] text-gray-400 text-center">No messages yet...</div>
                    </div>
                  ) : (
                    oracleMessages.map((msg) => (
                      <div key={msg.id} className="p-2 rounded border bg-gray-50 border-gray-200">
                        <div className="text-[10px] text-gray-600">{msg.message}</div>
                        <div className="text-[9px] text-gray-400 mt-1">
                          {new Date(msg.createdAt).toLocaleString()}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

