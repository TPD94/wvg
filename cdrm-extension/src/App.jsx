import { useEffect, useState } from 'react';
import hamburger from './assets/hamburger.svg';

function App() {
  const [psshList, setPsshList] = useState([]);
  const [selectedPssh, setSelectedPssh] = useState('');
  const [licenseList, setLicenseList] = useState([]);
  const [selectedLicense, setSelectedLicense] = useState('');
  const [challengeScheme, setChallengeScheme] = useState('default');
  const [rules, setRules] = useState([]);
  const [userSelectedLicense, setUserSelectedLicense] = useState(false);
  const [licenseRequestData, setLicenseRequestData] = useState(null);
  const [pyodide, setPyodide] = useState(null);
  const [isPyodideLoaded, setIsPyodideLoaded] = useState(false); // New state for Pyodide loading

  useEffect(() => {
    const loadPyodideAsync = async () => {
      try {
        const py = await window.loadPyodide();  // Use global loadPyodide
        setPyodide(py);
        setIsPyodideLoaded(true);  // Set to true when Pyodide is fully loaded

        // Load your wheels after Pyodide is initialized
        await py.loadPackage([
          chrome.runtime.getURL('python/packages/pyplayready-0.6.0-py3-none-any.whl'),
          chrome.runtime.getURL('python/packages/pywidevine-1.8.0-py3-none-any.whl'),
          chrome.runtime.getURL('python/packages/xmltodict-0.14.2-py2.py3-none-any.whl')
        ]);
      } catch (error) {
        console.error('Error loading Pyodide or packages:', error);
        setIsPyodideLoaded(false);  // Handle error and set as not loaded
      }
    };

    loadPyodideAsync();
  }, []);

  // Initial fetch from storage
  useEffect(() => {
    chrome.storage.local.get(['psshs', 'selectRules', 'licenseUrlsByTab', 'pageURL'], (data) => {
      if (data.psshs) {
        setPsshList(data.psshs);
        setSelectedPssh(data.psshs[data.psshs.length - 1] || '');
      }

      if (data.selectRules) {
        setRules(data.selectRules);
      }

      if (data.pageURL) {
        const urlsForThisPage = (data.licenseUrlsByTab || {})[data.pageURL] || [];
        setLicenseList(urlsForThisPage);
      }
    });

    chrome.storage.onChanged.addListener((changes) => {
      if (changes.psshs) {
        const list = changes.psshs.newValue;
        setPsshList(list);
        setSelectedPssh(list[list.length - 1] || '');
      }

      if (changes.licenseUrlsByTab || changes.pageURL) {
        chrome.storage.local.get(['licenseUrlsByTab', 'pageURL'], (data) => {
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

  const autoSelectLicense = (licenseUrls, ruleSet) => {
    for (const url of licenseUrls) {
      for (const rule of ruleSet) {
        if (url.includes(rule.pattern)) {
          setSelectedLicense(url);
          setChallengeScheme(rule.scheme || 'default');
          return;
        }
      }
    }

    setSelectedLicense(licenseUrls[0]);
    setChallengeScheme('default');
  };

  const handleDecrypt = async () => {
    if (!selectedLicense || !pyodide) {
      console.error('Pyodide is not loaded or license is missing');
      return;
    }

    chrome.runtime.sendMessage(
      { type: 'GET_LICENSE_REQUEST', url: selectedLicense },
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
            // Load remote.json to get the cdrm_instance_fqdn value
            const fqdnResponse = await fetch(chrome.runtime.getURL('remote.json'));
            const fqdnData = await fqdnResponse.json();
            const cdrmInstanceFqdn = fqdnData.cdrm_instance_fqdn || '';

            // 🧠 Set global variables for Python
            pyodide.globals.set('pssh', payload.pssh);
            pyodide.globals.set('license_url', payload.licenseUrl);
            pyodide.globals.set('license_body', payload.body);
            pyodide.globals.set('headers', payload.headers);
            pyodide.globals.set('scheme', payload.challengeScheme);
            pyodide.globals.set('cdrm_instance_fqdn', cdrmInstanceFqdn); // Pass FQDN to Pyodide

            // Function to fetch a script with error handling
            const fetchScript = async (scriptPath) => {
              try {
                const response = await fetch(chrome.runtime.getURL(scriptPath));
                if (!response.ok) {
                  console.error(`Failed to fetch ${scriptPath}: ${response.status} ${response.statusText}`);
                  throw new Error(`Failed to fetch ${scriptPath}`);
                }
                return await response.text();
              } catch (error) {
                console.error(`Error fetching script ${scriptPath}:`, error);
                throw error; // Rethrow the error to handle it in the main function
              }
            };

            // 🐍 Run pre.py (initial script)
            const preScript = await fetchScript('python/pre.py');
            await pyodide.runPythonAsync(preScript);

            // 🐍 Run the scheme-specific script
            const schemeScript = await fetchScript(`python/${challengeScheme}.py`);
            await pyodide.runPythonAsync(schemeScript);

            // Get result from decrypt_data function in the scheme script
            const decryptFunction = pyodide.globals.get('decrypt_data');
            const decryptedData = decryptFunction(payload.headers, payload.body, payload.pssh, payload.challengeScheme);

            // 🐍 Run post.py (finalization script)
            const postScript = await fetchScript('python/post.py');
            await pyodide.runPythonAsync(postScript);

            const finalizeFunction = pyodide.globals.get('finalize');
            const finalResult = finalizeFunction(decryptedData);

            console.log('Final Decrypted Result:', finalResult);
          } catch (error) {
            console.error('Error during decryption:', error);
          }
        } else {
          console.error('No data returned for the selected license URL');
        }
      }
    );
  };

  // Show a loading message until Pyodide is loaded
  if (!isPyodideLoaded) {
    return (
      <div className="w-full h-full flex justify-center items-center bg-gray-900 text-white">
        <p>Loading Pyodide...</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full grow overflow-y-auto flex flex-col bg-gray-900">
      <div className="flex flex-row w-full h-16 bg-black/35 border-b border-gray-700 items-center shrink-0 sticky top-0 z-10">
        <img src={hamburger} alt="hamburger" className="h-full p-3" />
        <p className="text-white text-2xl font-bold ml-4">CDRM Extension</p>
      </div>

      <div className="flex flex-col w-full overflow-y-auto grow p-4">
        {/* PSSH Selector */}
        <label htmlFor="pssh" className="w-full text-2xl text-white font-bold">PSSH:</label>
        <select
          id="pssh"
          className="w-full bg-black/35 h-10 mt-1 rounded-md border-2 border-black/20 text-white p-2 overflow-x-hidden"
          value={selectedPssh}
          onChange={(e) => setSelectedPssh(e.target.value)}
        >
          {psshList.map((pssh, idx) => (
            <option key={idx} value={pssh}>{pssh}</option>
          ))}
        </select>

        {/* License URL Selector */}
        <label htmlFor="license" className="w-full text-2xl text-white font-bold mt-4">License URL:</label>
        <select
          id="license"
          className="w-full bg-black/35 h-10 mt-1 rounded-md border-2 border-black/20 text-white p-2"
          value={selectedLicense}
          onChange={(e) => {
            setSelectedLicense(e.target.value);
            setUserSelectedLicense(true);
          }}
        >
          {licenseList.map((url, idx) => (
            <option key={idx} value={url}>{url}</option>
          ))}
        </select>

        {/* Challenge Scheme Selector */}
        <label htmlFor="ChallengeScheme" className="w-full text-2xl text-white font-bold mt-4">Challenge Scheme:</label>
        <select
          id="ChallengeScheme"
          className="w-full bg-black/35 h-10 mt-1 rounded-md border-2 border-black/20 text-white p-2"
          value={challengeScheme}
          onChange={(e) => setChallengeScheme(e.target.value)}
        >
          <option value="default">Generic</option>
          {[...new Set(rules.map((r) => r.scheme).filter(Boolean))].map((scheme, idx) => (
            <option key={idx} value={scheme}>{scheme}</option>
          ))}
        </select>

        {/* Decrypt Button */}
        <div className="flex flex-col w-full mt-4 justify-center items-center">
          <button
            className="bg-sky-500 hover:bg-sky-600 text-white font-bold py-2 px-4 rounded-md mr-2"
            onClick={handleDecrypt}
          >
            Decrypt
          </button>
        </div>

        {/* Display License Request Data */}
        {licenseRequestData && (
          <div className="mt-4 p-4 bg-gray-800 text-white rounded-md">
            <h3 className="text-xl font-bold">License Request Data</h3>
            <pre className='overflow-x-auto'>{JSON.stringify(licenseRequestData, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
