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



// Load and parse selectRules.conf

try {

    const selectText = await fetch(chrome.runtime.getURL("selectRules.conf")).then((r) => r.text());

    const selectRules = selectText

        .split("\n")

        .map((line) => line.trim())

        .filter((line) => line && !line.startsWith("//"))

        .map((line) => {

            if (line.includes("$$")) {

                const [pattern, scheme] = line.split("$$");

                return {

                    pattern: pattern.trim(),

                    scheme: scheme.trim() || "default",

                };

            } else {

                return {

                    pattern: line,

                    scheme: "default",

                };

            }

        });


    chrome.storage.local.set({ selectRules });

} catch (e) {

    console.error("Failed to load selectRules.conf", e);

}


  // Utility: check if URL matches any block rule
  function testBlock(url) {
      return window.isBlock && window.blockRules.some((rule) => url.includes(rule));
  }

  // Convert headers to string
  function convertHeaders(headers) {
      return JSON.stringify(Object.fromEntries(headers.map((h) => [h.name, h.value])));
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

// Capture headers and store license URL (Modified to capture all URLs)
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
  
        chrome.tabs.get(details.tabId, (tab) => {
          const pageUrl = tab?.url || "unknown";
  
          chrome.storage.local.get("licenseUrlsByTab", (data) => {
            const all = data.licenseUrlsByTab || {};
            const currentList = new Set(all[pageUrl] || []);
            if (!currentList.has(details.url)) {
              currentList.add(details.url);
              all[pageUrl] = [...currentList];
              chrome.storage.local.set({ licenseUrlsByTab: all });
            }
          });
        });
  
        if (testBlock(details.url)) return { cancel: true };
      }
    },
    { urls: ["<all_urls>"] },
    ["requestHeaders", "blocking"]
  );
  
  // Send all collected license URLs to the front-end (App.jsx)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
      case "GET_ALL_LICENSE_URLS":
        const licenseUrlsForTab = window.requests.map((req) => req.url);
        sendResponse(licenseUrlsForTab); // Send all URLs to the front-end
        break;
    }
  });

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

  // Create context menu for license blocking
  function createMenu() {
      chrome.storage.local.set({ isBlock: false }, null);
      chrome.contextMenus.create({
          id: "toggleBlocking",
          title: "Enable License Blocking",
      });
  }

  chrome.runtime.onInstalled.addListener(createMenu);
  chrome.runtime.onStartup.addListener(createMenu);

  // Toggle blocking from context menu
  chrome.contextMenus.onClicked.addListener((item) => {
      if (item.menuItemId === "toggleBlocking") {
          chrome.storage.local.get("isBlock", (value) => {
              const newState = !value?.isBlock;
              chrome.storage.local.set({ isBlock: newState });
              chrome.contextMenus.update("toggleBlocking", {
                  title: newState ? "Disable License Blocking" : "Enable License Blocking",
              });
          });
      }
  });
})();
