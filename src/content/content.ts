// Content script for interacting with Oro2u pages

interface Message {
  type: string;
  selector?: string;
  credentials?: {
    email: string;
    password: string;
  };
}

interface PageState {
  url: string;
  isLoginPage: boolean;
  isStockPage: boolean;
  hasCloudflare: boolean;
  hasDownloadButton: boolean;
  isLoggedIn: boolean;
}

// Check if cloudflare challenge is present
function hasCloudflareChallenge(): boolean {
  const cloudflareIndicators = [
    'Checking your browser',
    'Please wait',
    'cf-browser-verification',
    'Just a moment',
  ];
  
  const bodyText = document.body.textContent || '';
  return cloudflareIndicators.some(indicator => bodyText.includes(indicator)) ||
         document.querySelector('#challenge-running') !== null ||
         document.querySelector('.cf-browser-verification') !== null;
}

// Check if user is logged in
function isLoggedIn(): boolean {
  // Primary check: Look for "Sign In" text in the authorization link
  const signInLink = document.querySelector('#desktop-customer-links > ul > li.link.authorization-link > a');
  if (signInLink) {
    const linkText = signInLink.textContent?.trim() || '';
    // If it says "Sign In", user is NOT logged in
    if (linkText.toLowerCase().includes('sign in')) {
      return false;
    }
  }
  
  // Secondary checks: Look for logged-in indicators
  const loggedInIndicators = [
    '.customer-name',
    '.customer-welcome',
    '[data-customer-logged-in]',
    '.authorization-link a[href*="logout"]',
  ];
  
  return loggedInIndicators.some(selector => document.querySelector(selector) !== null) ||
         signInLink === null || // No sign in link at all
         (signInLink && !signInLink.textContent?.toLowerCase().includes('sign in'));
}

// Get current page state
function getPageState(): PageState {
  const url = window.location.href;
  const isLoginPage = url.includes('/customer/account/login');
  const isStockPage = url.includes('/orderwise/stock');
  const hasCloudflare = hasCloudflareChallenge();
  const loggedIn = isLoggedIn();
  
  return {
    url,
    isLoginPage,
    isStockPage,
    hasCloudflare,
    hasDownloadButton: false, // Will check with selector
    isLoggedIn: loggedIn,
  };
}

// Check if download button exists at selector
function checkDownloadButton(selector: string): boolean {
  try {
    const button = document.querySelector(selector);
    return button !== null && button instanceof HTMLElement;
  } catch (e) {
    console.error('Invalid selector:', e);
    return false;
  }
}

// Get the download URL from the link
function getDownloadUrl(selector: string): { success: boolean; url?: string; message: string } {
  try {
    const button = document.querySelector(selector);
    if (button && button instanceof HTMLAnchorElement) {
      const url = button.href;
      if (url) {
        return { success: true, url, message: 'Download URL found' };
      }
      return { success: false, message: 'No href found on link' };
    } else if (button && button instanceof HTMLElement) {
      // Try to find a link inside
      const link = button.querySelector('a');
      if (link && link.href) {
        return { success: true, url: link.href, message: 'Download URL found' };
      }
      return { success: false, message: 'No download URL found' };
    } else {
      return { success: false, message: 'Download button not found at selector' };
    }
  } catch (e) {
    return { success: false, message: `Error getting download URL: ${e}` };
  }
}

// Click the download button (fallback)
function clickDownloadButton(selector: string): { success: boolean; message: string } {
  try {
    const button = document.querySelector(selector);
    if (button && button instanceof HTMLElement) {
      button.click();
      return { success: true, message: 'Download button clicked' };
    } else if (button && button instanceof HTMLAnchorElement) {
      button.click();
      return { success: true, message: 'Download link clicked' };
    } else {
      return { success: false, message: 'Download button not found at selector' };
    }
  } catch (e) {
    return { success: false, message: `Error clicking button: ${e}` };
  }
}

// Auto-login function
function performAutoLogin(email: string, password: string): { success: boolean; message: string } {
  try {
    const emailInput = document.querySelector('#email') as HTMLInputElement;
    const passwordInput = document.querySelector('#pass') as HTMLInputElement;
    const submitButton = document.querySelector('#send2') as HTMLElement;

    if (!emailInput) {
      return { success: false, message: 'Email input (#email) not found' };
    }
    if (!passwordInput) {
      return { success: false, message: 'Password input (#pass) not found' };
    }
    if (!submitButton) {
      return { success: false, message: 'Submit button (#send2) not found' };
    }

    // Fill in the credentials
    emailInput.value = email;
    passwordInput.value = password;

    // Trigger input events to ensure form validation
    emailInput.dispatchEvent(new Event('input', { bubbles: true }));
    emailInput.dispatchEvent(new Event('change', { bubbles: true }));
    passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
    passwordInput.dispatchEvent(new Event('change', { bubbles: true }));

    // Click the submit button
    setTimeout(() => {
      submitButton.click();
    }, 500);

    return { success: true, message: 'Auto-login initiated' };
  } catch (e) {
    return { success: false, message: `Error during auto-login: ${e}` };
  }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === 'CHECK_STATE') {
    const state = getPageState();
    if (message.selector) {
      state.hasDownloadButton = checkDownloadButton(message.selector);
    }
    sendResponse(state);
  } else if (message.type === 'GET_DOWNLOAD_URL' && message.selector) {
    const result = getDownloadUrl(message.selector);
    sendResponse(result);
  } else if (message.type === 'CLICK_DOWNLOAD' && message.selector) {
    const result = clickDownloadButton(message.selector);
    sendResponse(result);
  } else if (message.type === 'AUTO_LOGIN' && message.credentials) {
    // Wait a bit for page to fully load
    setTimeout(() => {
      const result = performAutoLogin(message.credentials!.email, message.credentials!.password);
      console.log('Auto-login result:', result);
      
      // Notify about login attempt
      chrome.runtime.sendMessage({
        type: 'AUTO_LOGIN_ATTEMPT',
        success: result.success,
        message: result.message
      }).catch(() => {});
      
      sendResponse(result);
    }, 1000);
    return true; // Will respond asynchronously
  }
  
  return false;
});

// Monitor for page changes (login completion, cloudflare resolution)
let lastUrl = window.location.href;
let lastLoginState = isLoggedIn();

setInterval(() => {
  const currentUrl = window.location.href;
  const currentLoginState = isLoggedIn();
  const hasCloudflare = hasCloudflareChallenge();
  
  if (currentUrl !== lastUrl || currentLoginState !== lastLoginState) {
    // Page changed or login state changed
    chrome.runtime.sendMessage({
      type: 'PAGE_CHANGED',
      url: currentUrl,
      isLoggedIn: currentLoginState,
      hasCloudflare,
    }).catch(() => {
      // Background script might not be listening
    });
    
    lastUrl = currentUrl;
    lastLoginState = currentLoginState;
  }
}, 1000);

console.log('Oro2u content script loaded');

