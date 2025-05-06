import { useEffect, useState } from 'react';
import hamburger from './assets/hamburger.svg';

function App() {
  const [pssh, setPssh] = useState('');
  const [selectedPssh, setSelectedPssh] = useState('');
  const [licenseList, setLicenseList] = useState([]);
  const [selectedLicense, setSelectedLicense] = useState('');
  const [challengeScheme, setChallengeScheme] = useState('default');
  const [rules, setRules] = useState([]);
  const [userSelectedLicense, setUserSelectedLicense] = useState(false);
  const [licenseRequestData, setLicenseRequestData] = useState(null);
  const [pyodide, setPyodide] = useState(null);
  const [isPyodideLoaded, setIsPyodideLoaded] = useState(false);

  useEffect(() => {
    const loadPyodideAsync = async () => {
      try {
        const py = await window.loadPyodide();
        setPyodide(py);
        setIsPyodideLoaded(true);

        await py.loadPackage([
          chrome.runtime.getURL('python/packages/pyplayready-0.6.0-py3-none-any.whl'),
          chrome.runtime.getURL('python/packages/pywidevine-1.8.0-py3-none-any.whl'),
          chrome.runtime.getURL('python/packages/xmltodict-0.14.2-py2.py3-none-any.whl')
        ]);
      } catch (error) {
        console.error('Error loading Pyodide or packages:', error);
        setIsPyodideLoaded(false);
      }
    };

    loadPyodideAsync();
  }, []);

  useEffect(() => {
    chrome.storage.local.get(['psshs', 'selectRules', 'licenseUrlsByTab', 'pageURL'], (data) => {
      if (data.psshs && data.psshs.length > 0) {
        setPssh(data.psshs[0]);
        setSelectedPssh(data.psshs[0]);
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
        if (list && list.length > 0) {
          setPssh(list[0]);
          setSelectedPssh(list[0]);
        }
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
    let foundMatch = false;
  
    for (const url of licenseUrls) {
      for (const rule of ruleSet) {
        // Remove the $$ from the pattern and check if the URL includes the pattern
        const cleanPattern = rule.pattern.replace('$$', '');
        
        if (url.includes(cleanPattern)) {
          setSelectedLicense(url);
          setChallengeScheme(rule.scheme || 'default');
          foundMatch = true;
          break;
        }
      }
      if (foundMatch) break;
    }
  
    if (!foundMatch && licenseUrls.length > 0) {
      setSelectedLicense(licenseUrls[0]);
      setChallengeScheme('default');
    }
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
            const fqdnResponse = await fetch(chrome.runtime.getURL('remote.json'));
            const fqdnData = await fqdnResponse.json();
            const cdrmInstanceFqdn = fqdnData.cdrm_instance_fqdn || '';

            pyodide.globals.set('pssh', payload.pssh);
            pyodide.globals.set('license_url', payload.licenseUrl);
            pyodide.globals.set('license_body', payload.body);
            pyodide.globals.set('headers', payload.headers);
            pyodide.globals.set('scheme', payload.challengeScheme);
            pyodide.globals.set('cdrm_instance_fqdn', cdrmInstanceFqdn);

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
                throw error;
              }
            };

            const preScript = await fetchScript('python/pre.py');
            await pyodide.runPythonAsync(preScript);

            const schemeScript = await fetchScript(`python/${challengeScheme}.py`);
            await pyodide.runPythonAsync(schemeScript);

            const decryptFunction = pyodide.globals.get('decrypt_data');
            const decryptedData = decryptFunction(payload.headers, payload.body, payload.pssh, payload.challengeScheme);

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
        <label htmlFor="pssh" className="w-full text-2xl text-white font-bold">PSSH:</label>
        <select
          id="pssh"
          className="w-full bg-black/35 h-10 mt-1 rounded-md border-2 border-black/20 text-white p-2 overflow-x-hidden shrink-0"
          value={selectedPssh}
          onChange={() => {}}
        >
          <option value={pssh}>{pssh}</option>
        </select>

        <label htmlFor="license" className="w-full text-2xl text-white font-bold mt-4">License URL:</label>
        <select
          id="license"
          className="w-full bg-black/35 h-10 mt-1 rounded-md border-2 border-black/20 text-white p-2 shrink-0"
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
              <option key={index} value={url}>{url}</option>
            ))
          )}
        </select>

        <label htmlFor="ChallengeScheme" className="w-full text-2xl text-white font-bold mt-4">Challenge Scheme:</label>
        <select
          id="ChallengeScheme"
          className="w-full bg-black/35 h-10 mt-1 rounded-md border-2 border-black/20 text-white p-2 shrink-0"
          value={challengeScheme}
          onChange={(e) => setChallengeScheme(e.target.value)}
        >
          <option value="default">Default</option>
        </select>

        <button
          className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-md mt-4"
          onClick={handleDecrypt}
        >
          Decrypt
        </button>
      </div>
    </div>
  );
}

export default App;
