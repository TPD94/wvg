(async () => {
    // Global state
    window.psshs = [];
    window.requests = [];
    window.bodys = [];
    window.targetIds = [];
    window.pageURL = "";
    window.clearkey = "";
    window.isBlock = false;
  
    // Load block setting
    chrome.storage.local.get("isBlock", (value) => {
        window.isBlock = value?.isBlock || false;
        // Re-register the listener when the block setting changes
        registerBlockListener();
    });
  
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
  
    // Utility: check if URL matches any block rule
    function testBlock(url) {
        return window.isBlock && window.blockRules.some((rule) => url.includes(rule));
    }
  
    // Convert headers to string
    function convertHeaders(headers) {
        return JSON.stringify(Object.fromEntries(headers.map((h) => [h.name, h.value])));
    }
  
    // Register blocking listener
    function registerBlockListener() {
      chrome.webRequest.onBeforeRequest.addListener(
          (details) => {
              if (details.method === "POST" && testBlock(details.url)) {
                  console.log(`Blocking request to: ${details.url}`);
                  return { cancel: true }; // Block the request
              }
          },
          { urls: ["<all_urls>"] },
          ["blocking"]
      );
    }
  
    // Capture request body
    chrome.webRequest.onBeforeRequest.addListener(
        (details) => {
            if (details.method === "POST") {
                const raw = details.requestBody?.raw?.[0]?.bytes;
                const body = raw ? btoa(String.fromCharCode(...new Uint8Array(raw))) : "";
  
                window.bodys.push({
                    id: details.requestId,
                    body,
                });
            }
        },
        { urls: ["<all_urls>"] },
        ["requestBody"]
    );
  
    // Capture headers and store license URL
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
  
              if (testBlock(details.url)) return { cancel: true }; // Block if URL matches blockRules.conf
          }
      },
      { urls: ["<all_urls>"] },
      ["requestHeaders", "blocking"]
    );
  
    // Listen to block toggle action (context menu or other UI)
    chrome.contextMenus.onClicked.addListener((info, tab) => {
        if (info.menuItemId === "toggleBlocking") {
            window.isBlock = !window.isBlock; // Toggle the blocking state
            chrome.storage.local.set({ isBlock: window.isBlock }); // Save to local storage
  
            // Re-register the blocking listener whenever toggled
            registerBlockListener();
        }
    });
  
    // Create context menu for license blocking
    function createMenu() {
        chrome.contextMenus.create({
            id: "toggleBlocking",
            title: window.isBlock ? "Disable License Blocking" : "Enable License Blocking",
        });
    }
    createMenu();
  
    // Handle messages from content.js
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        switch (request.type) {
            case "RESET":
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    const tab = tabs[0];
                    const pageURL = tab?.url || "unknown";
                    window.pageURL = pageURL;
                    chrome.storage.local.set({
                        pageURL,
                        licenseUrlsByTab: { [pageURL]: [] }
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
                // Find the request matching the selected URL
                const licenseRequest = window.requests.find((r) => r.url === request.url);
                sendResponse(licenseRequest); // Send it back to the sender
                break;
        }
    });
  
    // Handle browser action click
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
  