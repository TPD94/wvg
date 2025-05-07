(async () => {
    // Global state
    window.psshs = [];
    window.requests = [];
    window.bodys = [];
    window.targetIds = [];
    window.pageURL = "";
    window.clearkey = "";
    window.isBlock = false;
    window.licenseUrlsByTab = {};
    window.blockRules = [];
  
    // Load and parse blockRules.conf
    try {
      const blockText = await fetch(chrome.runtime.getURL("blockRules.conf")).then((r) => r.text());
      window.blockRules = blockText
        .replace(/\n^\s*$|\s*\/\/.*|\s*$/gm, "")
        .split("\n")
        .filter(Boolean);
    } catch {
      window.blockRules = [];
    }
  
    function testBlock(url) {
      return window.blockRules.some((rule) => url.includes(rule));
    }
  
    function convertHeaders(headers) {
      return JSON.stringify(Object.fromEntries(headers.map((h) => [h.name, h.value])));
    }
  
    function registerBlockListener() {
      chrome.webRequest.onBeforeRequest.addListener(
        (details) => {
          if (details.method === "POST" && window.isBlock && testBlock(details.url)) {
            console.log(`Blocking request to: ${details.url}`);
            return { cancel: true };
          }
        },
        { urls: ["<all_urls>"] },
        ["blocking"]
      );
    }
  
    // Register the blocking listener immediately
    registerBlockListener();
  
    // Load block setting and create menu (after listener is already registered)
    chrome.storage.local.get("isBlock", (value) => {
      window.isBlock = value?.isBlock || false;
      createMenu(); // Initialize menu with proper title
    });
  
    chrome.webRequest.onBeforeRequest.addListener(
      (details) => {
        if (details.method === "POST") {
          const raw = details.requestBody?.raw?.[0]?.bytes;
          const body = raw ? btoa(String.fromCharCode(...new Uint8Array(raw))) : "";
          window.bodys.push({ id: details.requestId, body });
        }
      },
      { urls: ["<all_urls>"] },
      ["requestBody"]
    );
  
    chrome.webRequest.onBeforeSendHeaders.addListener(
      (details) => {
        if (details.method === "POST") {
          const bodyObj = window.bodys.find((b) => b.id === details.requestId);
          const body = bodyObj?.body || "";
  
          window.requests.push({
            url: details.url,
            headers: convertHeaders(details.requestHeaders),
            body,
          });
  
          // Fallback for pageURL
          if (!window.pageURL) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              const fallbackURL = tabs?.[0]?.url;
              if (fallbackURL) {
                window.pageURL = fallbackURL;
                console.log("Fallback pageURL set to:", fallbackURL);
  
                if (!window.licenseUrlsByTab[window.pageURL]) {
                  window.licenseUrlsByTab[window.pageURL] = [];
                }
  
                if (!window.licenseUrlsByTab[window.pageURL].includes(details.url)) {
                  window.licenseUrlsByTab[window.pageURL].push(details.url);
                  chrome.storage.local.set({ licenseUrlsByTab: window.licenseUrlsByTab });
                }
              } else {
                console.warn("Could not determine fallback pageURL");
              }
            });
          } else {
            if (!window.licenseUrlsByTab[window.pageURL]) {
              window.licenseUrlsByTab[window.pageURL] = [];
            }
  
            if (!window.licenseUrlsByTab[window.pageURL].includes(details.url)) {
              window.licenseUrlsByTab[window.pageURL].push(details.url);
              chrome.storage.local.set({ licenseUrlsByTab: window.licenseUrlsByTab });
            }
          }
  
          if (window.isBlock && testBlock(details.url)) return { cancel: true };
        }
      },
      { urls: ["<all_urls>"] },
      ["requestHeaders", "blocking"]
    );
  
    // Context menu toggle
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      if (info.menuItemId === "toggleBlocking") {
        window.isBlock = !window.isBlock;
        chrome.storage.local.set({ isBlock: window.isBlock });
  
        chrome.contextMenus.update("toggleBlocking", {
          title: window.isBlock ? "Disable License Blocking" : "Enable License Blocking",
        });
  
        console.log("License blocking toggled:", window.isBlock);
      }
    });
  
    function createMenu() {
      chrome.contextMenus.create({
        id: "toggleBlocking",
        title: window.isBlock ? "Disable License Blocking" : "Enable License Blocking",
        contexts: ["all"],
      });
    }
  
    // Message listener
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      switch (request.type) {
        case "RESET":
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            const pageURL = tab?.url || "unknown";
            window.pageURL = pageURL;
            window.licenseUrlsByTab[pageURL] = window.licenseUrlsByTab[pageURL] || [];
            chrome.storage.local.set({
              pageURL,
              licenseUrlsByTab: window.licenseUrlsByTab,
            });
          });
          break;
  
        case "PSSH":
          window.psshs.push(request.text);
          window.pageURL = sender.tab?.url || "";
          window.targetIds = [sender.tab?.id, sender.frameId];
          chrome.storage.local.set({ psshs: window.psshs });
          break;
  
        case "CLEARKEY":
          window.clearkey = request.text;
          chrome.storage.local.set({ clearkey: request.text });
          break;
  
        case "GET_LICENSE_REQUEST":
          const licenseRequest = window.requests.find((r) => r.url === request.url);
          sendResponse(licenseRequest);
          break;
      }
    });
  
    // Open popup
    chrome.browserAction.onClicked.addListener(() => {
      chrome.windows
        ? chrome.windows.create({
            url: "index.html",
            type: "popup",
            width: 820,
            height: 600,
          })
        : chrome.tabs.create({ url: "index.html" });
    });
  })();
  