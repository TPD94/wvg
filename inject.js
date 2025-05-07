// --- Utility functions ---
const hexStrToU8 = hexString =>
    Uint8Array.from(hexString.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

const u8ToHexStr = bytes =>
    bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');

const b64ToHexStr = b64 =>
    [...atob(b64)].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join``;

// --- Widevine-style PSSH extractor ---
function getWidevinePssh(buffer) {
    const hex = u8ToHexStr(new Uint8Array(buffer));
    const match = hex.match(/000000(..)?70737368.*/); // finds pssh box
    if (!match) return null;

    const boxHex = match[0];
    const bytes = hexStrToU8(boxHex);
    return window.btoa(String.fromCharCode(...bytes));
}

function getPlayReadyPssh(buffer) {
    const u8 = new Uint8Array(buffer);
    const systemId = "9a04f07998404286ab92e65be0885f95";

    // Convert to hex string for searching
    const hex = u8ToHexStr(u8);

    const index = hex.indexOf(systemId);
    if (index === -1) return null;

    // Backtrack to find the start of the PSSH box
    const psshBoxStart = hex.lastIndexOf("70737368", index);
    if (psshBoxStart === -1) return null;

    // Get length field (4 bytes before 'pssh')
    const lenStart = psshBoxStart - 8;
    const boxLen = parseInt(hex.substr(lenStart, 8), 16) * 2;

    const psshHex = hex.substr(lenStart, boxLen);
    const psshBytes = hexStrToU8(psshHex);

    return window.btoa(String.fromCharCode(...psshBytes));
}

// --- Clearkey extractor ---
function getClearkey(response) {
    try {
        // Attempt to decode response to a string (assuming UTF-8)
        let responseText;
        try {
            responseText = new TextDecoder("utf-8").decode(response);
        } catch (e) {
            console.error("Error decoding response to UTF-8:", e);
            return null;  // If decoding fails, return null
        }

        // Check if the response is JSON (for Clearkey)
        if (responseText.trim().startsWith("{") || responseText.trim().startsWith("[")) {
            let obj = JSON.parse(responseText);
            obj = obj["keys"].map(o => [o["kid"], o["k"]]);
            obj = obj.map(o => o.map(a => a.replace(/-/g, '+').replace(/_/g, '/') + "=="));
            return obj.map(o => `${b64ToHexStr(o[0])}:${b64ToHexStr(o[1])}`).join("\n");
        } else if (responseText.includes("<soap:Envelope") && responseText.includes("<AcquireLicenseResponse")) {
            // Handle PlayReady SOAP/XML response
            console.log("PlayReady XML License Response detected:", responseText);
            return "[PlayReady XML Response]";  // You can format the response accordingly
        } else {
            // If it's not Clearkey or PlayReady, log the response and return null
            return null;
        }
    } catch (e) {
        console.error("Error parsing Clearkey or PlayReady response:", e);
        return null;
    }
}


// --- Override generateRequest to capture initData (PSSH) ---
const originalGenerateRequest = MediaKeySession.prototype.generateRequest;
MediaKeySession.prototype.generateRequest = function(initDataType, initData) {
    const result = originalGenerateRequest.call(this, initDataType, initData);
    try {
        const widevinePssh = getWidevinePssh(initData);
        const playreadyPssh = getPlayReadyPssh(initData);
        
        if (widevinePssh || playreadyPssh) {
            const pssh = widevinePssh || playreadyPssh;
            console.log("[PSSH] " + pssh);
            document.dispatchEvent(new CustomEvent('pssh', {
                detail: pssh
            }));
        } else {
            // If neither Widevine nor PlayReady is detected, process Clearkey
            console.log("[PSSH] Neither Widevine nor PlayReady detected, checking for Clearkey...");
            const clearkey = getClearkey(initData);
            if (clearkey) {
                console.log("[CLEARKEY] " + clearkey);
                document.dispatchEvent(new CustomEvent('clearkey', {
                    detail: clearkey
                }));
            }
        }
    } catch (e) {
        console.error("Error extracting PSSH or Clearkey:", e);
    }
    return result;
};

// --- Override update to capture Clearkey responses ---
const originalUpdate = MediaKeySession.prototype.update;
MediaKeySession.prototype.update = function(response) {
    const result = originalUpdate.call(this, response);
    try {
        const clearkey = getClearkey(response);
        if (clearkey) {
            console.log("[CLEARKEY] " + clearkey);
            document.dispatchEvent(new CustomEvent('clearkey', {
                detail: clearkey
            }));
        }
    } catch (e) {
        console.error("Error extracting Clearkey:", e);
    }
    return result;
};
