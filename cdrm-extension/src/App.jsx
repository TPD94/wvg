import { useEffect, useState } from "react";
import Results from "./Results";

function App() {
  const [pssh, setPssh] = useState("");
  const [selectedPssh, setSelectedPssh] = useState("");
  const [licenseList, setLicenseList] = useState([]);
  const [selectedLicense, setSelectedLicense] = useState("");
  const [challengeScheme, setChallengeScheme] = useState("default");
  const [rules, setRules] = useState([]);
  const [userSelectedLicense, setUserSelectedLicense] = useState(false);
  const [licenseRequestData, setLicenseRequestData] = useState(null);
  const [pyodide, setPyodide] = useState(null);
  const [isPyodideLoaded, setIsPyodideLoaded] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [decryptionResult, setDecryptionResult] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState("CDRM Instance default");

  const autoSelectLicense = (licenseUrls, ruleSet) => {
    let foundMatch = false;
    for (const url of licenseUrls) {
      for (const rule of ruleSet) {
        const cleanPattern = rule.pattern;
        const scheme = rule.scheme;
        if (url.includes(cleanPattern)) {
          console.log(scheme);
          setSelectedLicense(url);
          setChallengeScheme(scheme || "default");
          foundMatch = true;
          break;
        }
      }
      if (foundMatch) break;
    }
    if (!foundMatch && licenseUrls.length > 0) {
      setSelectedLicense(licenseUrls[0]);
      setChallengeScheme("default");
    }
  };

  useEffect(() => {
    const loadPyodideAsync = async () => {
      try {
        const py = await window.loadPyodide();
        setPyodide(py);
        setIsPyodideLoaded(true);

        await py.loadPackage([
          chrome.runtime.getURL(
            "python/packages/pyplayready-0.6.0-py3-none-any.whl"
          ),
          chrome.runtime.getURL(
            "python/packages/pywidevine-1.8.0-py3-none-any.whl"
          ),
          chrome.runtime.getURL(
            "python/packages/xmltodict-0.14.2-py2.py3-none-any.whl"
          ),
          chrome.runtime.getURL(
            "python/packages/pycryptodome-3.20.0-cp35-abi3-emscripten_3_1_52_wasm32.whl"
          ),
          chrome.runtime.getURL("python/packages/ECPy-1.2.5-py3-none-any.whl"),
          chrome.runtime.getURL(
            "python/packages/construct-2.8.8-py2.py3-none-any.whl"
          ),
          chrome.runtime.getURL(
            "python/packages/requests-2.31.0-py3-none-any.whl"
          ),
          chrome.runtime.getURL(
            "python/packages/urllib3-2.2.1-py3-none-any.whl"
          ),
          chrome.runtime.getURL("python/packages/pymp4-1.4.0-py3-none-any.whl"),
          chrome.runtime.getURL(
            "python/packages/protobuf-4.24.4-cp312-cp312-emscripten_3_1_52_wasm32.whl"
          ),
          chrome.runtime.getURL(
            "python/packages/charset_normalizer-3.3.2-py3-none-any.whl"
          ),
          chrome.runtime.getURL(
            "python/packages/certifi-2024.2.2-py3-none-any.whl"
          ),
          chrome.runtime.getURL("python/packages/idna-3.6-py3-none-any.whl"),
        ]);
      } catch (error) {
        console.error("Error loading Pyodide or packages:", error);
        setIsPyodideLoaded(false);
      }
    };

    loadPyodideAsync();
  }, []);

  useEffect(() => {
    chrome.storage.local.get(["clearkey"], (data) => {
      if (data.clearkey) {
        console.log(data.clearkey);
        setDecryptionResult(data.clearkey);
        setShowResults(true);
        chrome.storage.local.remove("clearkey");
      }
    });
  }, []);

  useEffect(() => {
    chrome.storage.local.get(["apiKey"], (data) => {
      if (data.apiKey) {
        setApiKey(data.apiKey);
      }
    });
  }, []);

  useEffect(() => {
    chrome.storage.local.get(
      ["psshs", "selectRules", "licenseUrlsByTab", "pageURL"],
      (data) => {
        if (data.psshs && data.psshs.length > 0) {
          setPssh(data.psshs[0]);
          setSelectedPssh(data.psshs[0]);
        }
        if (data.selectRules) {
          setRules(data.selectRules);
        }
        if (data.pageURL) {
          const urlsForThisPage =
            (data.licenseUrlsByTab || {})[data.pageURL] || [];
          setLicenseList(urlsForThisPage);
        }
      }
    );

    chrome.storage.onChanged.addListener((changes) => {
      if (changes.psshs) {
        const list = changes.psshs.newValue;
        if (list && list.length > 0) {
          setPssh(list[0]);
          setSelectedPssh(list[0]);
        }
      }
      if (changes.licenseUrlsByTab || changes.pageURL) {
        chrome.storage.local.get(["licenseUrlsByTab", "pageURL"], (data) => {
          const urls = (data.licenseUrlsByTab || {})[data.pageURL] || [];
          setLicenseList(urls);
          if (urls.length === 0) setUserSelectedLicense(false);
        });
      }
      if (changes.selectRules) {
        setRules(changes.selectRules.newValue);
      }
    });
  }, []);

  useEffect(() => {
    if (!userSelectedLicense && licenseList.length > 0 && rules.length > 0) {
      autoSelectLicense(licenseList, rules);
    }
  }, [licenseList, rules, userSelectedLicense]);

  useEffect(() => {
    const fetchUserInfo = async () => {
      if (!apiKey) return;

      try {
        const fqdnResponse = await fetch(chrome.runtime.getURL("remote.json"));
        const fqdnData = await fqdnResponse.json();
        const fqdn = fqdnData.cdrm_instance_fqdn;

        const response = await fetch(`${fqdn}userinfo`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "API-Key": apiKey,
          },
        });

        if (!response.ok) {
          console.error(`Failed to fetch user info: ${response.status}`);
          return;
        }

        const data = await response.json();
        const devicesList = [
          { name: "CDRM Instance default", type: "Default" },
          ...data.Playready_Devices.map((name) => ({
            type: "PlayReady",
            name,
          })),
          ...data.Widevine_Devices.map((name) => ({ type: "Widevine", name })),
        ];
        setDevices(devicesList);
      } catch (err) {
        console.error("Error fetching user info:", err);
      }
    };

    fetchUserInfo();
  }, [apiKey]);

  const handleDecrypt = async () => {
    if (!selectedLicense || !pyodide) {
      console.error("Pyodide is not loaded or license is missing");
      return;
    }

    chrome.runtime.sendMessage(
      { type: "GET_LICENSE_REQUEST", url: selectedLicense },
      async (response) => {
        if (response) {
          setLicenseRequestData(response);
          const { headers, body, url } = response;

          const payload = {
            licenseUrl: url,
            pssh: selectedPssh,
            challengeScheme,
            headers: JSON.parse(headers),
            body: atob(body),
          };

          try {
            const fqdnResponse = await fetch(
              chrome.runtime.getURL("remote.json")
            );
            const fqdnData = await fqdnResponse.json();
            const cdrmInstanceFqdn = fqdnData.cdrm_instance_fqdn || "";

            pyodide.globals.set("pssh", payload.pssh);
            pyodide.globals.set("license_url", payload.licenseUrl);
            pyodide.globals.set("license_body", payload.body);
            pyodide.globals.set("headers", payload.headers);
            pyodide.globals.set("scheme", payload.challengeScheme);
            pyodide.globals.set("cdrm_instance_fqdn", cdrmInstanceFqdn);
            pyodide.globals.set("selected_device", selectedDevice);
            const deviceObj = devices.find(
              (d) => d.name === selectedDevice
            ) || { type: "Default" };
            pyodide.globals.set("device_type", deviceObj.type);
            pyodide.globals.set("api_key", apiKey || "");

            const fetchScript = async (scriptPath) => {
              const response = await fetch(chrome.runtime.getURL(scriptPath));
              return await response.text();
            };

            const preScript = await fetchScript("python/pre.py");
            await pyodide.runPythonAsync(preScript);

            const schemeScript = await fetchScript(
              `python/schemes/${challengeScheme}.py`
            );
            await pyodide.runPythonAsync(schemeScript);

            const postScript = await fetchScript("python/post.py");
            await pyodide.runPythonAsync(postScript);

            const finalResult = pyodide.globals.get("r_keys");
            setDecryptionResult(finalResult);
            setShowResults(true);
          } catch (error) {
            console.error("Error during decryption:", error);
          }
        } else {
          console.error("No data returned for the selected license URL");
        }
      }
    );
  };

  if (!isPyodideLoaded) {
    return (
      <div className="w-full h-full flex justify-center items-center bg-gray-900 text-white">
        <p>Loading Pyodide...</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full grow overflow-y-auto flex flex-col bg-gray-900">
      <div className="flex flex-row w-full h-16 bg-black/35 border-b border-gray-700 items-center sticky top-0 z-10">
        <p className="text-white text-2xl font-bold ml-4">CDRM Extension</p>
        <input
          type="text"
          placeholder="API Key: "
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="grow p-4 ml-2 mr-2 text-white font-bold bg-black/90 rounded-2xl"
        />
        <button
          className="bg-green-600 hover:bg-green-700 text-white font-bold p-4 rounded-2xl mr-2"
          onClick={() => {
            chrome.storage.local.set({ apiKey }, () => {
              console.log("API key saved:", apiKey);
            });
          }}
        >
          Save
        </button>
      </div>

      <div className="flex flex-col w-full overflow-y-auto grow p-4">
        {!apiKey && (
          <p className="text-yellow-300 font-semibold mb-4">
            No API key provided – using default device only.
          </p>
        )}

        <label htmlFor="pssh" className="text-2xl text-white font-bold">
          PSSH:
        </label>
        <select
          id="pssh"
          className="w-full bg-black/35 h-10 mt-1 rounded-md border-2 border-black/20 text-white p-2"
          value={selectedPssh}
          onChange={() => {}}
        >
          <option value={pssh}>{pssh}</option>
        </select>

        <label htmlFor="license" className="text-2xl text-white font-bold mt-4">
          License URL:
        </label>
        <select
          id="license"
          className="w-full bg-black/35 h-10 mt-1 rounded-md border-2 border-black/20 text-white p-2"
          value={selectedLicense}
          onChange={(e) => {
            setUserSelectedLicense(true);
            setSelectedLicense(e.target.value);
          }}
        >
          {licenseList.length === 0 ? (
            <option>No licenses available</option>
          ) : (
            licenseList.map((url, index) => (
              <option key={index} value={url}>
                {url}
              </option>
            ))
          )}
        </select>

        <label
          htmlFor="ChallengeScheme"
          className="text-2xl text-white font-bold mt-4"
        >
          Challenge Scheme:
        </label>
        <select
          id="ChallengeScheme"
          className="w-full bg-black/35 h-10 mt-1 rounded-md border-2 border-black/20 text-white p-2"
          value={challengeScheme}
          onChange={(e) => setChallengeScheme(e.target.value)}
        >
          <option value="default">Default</option>
          {challengeScheme !== "default" && (
            <option value={challengeScheme}>
              {challengeScheme.charAt(0).toUpperCase() +
                challengeScheme.slice(1)}
            </option>
          )}
        </select>

        {apiKey && devices.length > 0 && (
          <>
            <label
              htmlFor="Device"
              className="text-2xl text-white font-bold mt-4"
            >
              Device:
            </label>
            <select
              id="Device"
              className="w-full bg-black/35 h-10 mt-1 rounded-md border-2 border-black/20 text-white p-2"
              onChange={(e) => setSelectedDevice(e.target.value)}
              value={selectedDevice}
            >
              {devices.map((d, i) => (
                <option key={i} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </>
        )}

        <button
          className="bg-sky-500 hover:bg-sky-600 text-white font-bold py-2 px-4 rounded-md mt-4"
          onClick={handleDecrypt}
        >
          Decrypt
        </button>
      </div>

      {showResults && (
        <Results
          onCloseComplete={() => setShowResults(false)}
          result={decryptionResult}
        />
      )}
    </div>
  );
}

export default App;
