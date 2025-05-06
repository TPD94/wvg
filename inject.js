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
    let obj = JSON.parse((new TextDecoder("utf-8")).decode(response));
    obj = obj["keys"].map(o => [o["kid"], o["k"]]);
    obj = obj.map(o => o.map(a => a.replace(/-/g, '+').replace(/_/g, '/') + "=="));
    return obj.map(o => `${b64ToHexStr(o[0])}:${b64ToHexStr(o[1])}`).join("\n");
}

// --- Override generateRequest to capture initData (PSSH) ---
const originalGenerateRequest = MediaKeySession.prototype.generateRequest;
MediaKeySession.prototype.generateRequest = function(initDataType, initData) {
    const result = originalGenerateRequest.call(this, initDataType, initData);
    try {
        const pssh = getWidevinePssh(initData) || getPlayReadyPssh(initData);
        if (pssh) {
            console.log("[PSSH] " + pssh);
            document.dispatchEvent(new CustomEvent('pssh', {
                detail: pssh
            }));
        } else {
            console.log("[PSSH] Not found or unsupported format");
        }
    } catch (e) {
        console.error("Error extracting PSSH:", e);
    }
    return result;
};

// --- Override update to capture Clearkey responses ---
const originalUpdate = MediaKeySession.prototype.update;
MediaKeySession.prototype.update = function(response) {
    const result = originalUpdate.call(this, response);
    try {
        const clearkey = getClearkey(response);
        console.log("[CLEARKEY] " + clearkey);
        document.dispatchEvent(new CustomEvent('clearkey', {
            detail: clearkey
        }));
    } catch (e) {
        console.error("Error extracting Clearkey:", e);
    }
    return result;
};
