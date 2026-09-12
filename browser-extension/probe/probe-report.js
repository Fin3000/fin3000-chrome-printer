const PROFILE = __PROFILE_CONFIG__;

const apiStatus = document.getElementById('api-status');
const chromeVersion = document.getElementById('chrome-version');
const clearResults = document.getElementById('clear-results');
const delayOptions = document.getElementById('delay-options');
const fixtureLink = document.getElementById('fixture-link');
const result = document.getElementById('result');

fixtureLink.href = chrome.runtime.getURL('hello-world.pdf');

async function setDelay(seconds) {
  await chrome.storage.local.set({ probeDelaySeconds: seconds });
  await render();
}

function renderDelayButtons(selectedDelay) {
  delayOptions.replaceChildren();
  for (const seconds of PROFILE.callbackDelaysSeconds) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${seconds} s`;
    button.setAttribute('aria-pressed', String(seconds === selectedDelay));
    button.addEventListener('click', () => void setDelay(seconds));
    delayOptions.append(button);
  }
}

async function render() {
  const { probeDelaySeconds, probeResult, probeRuntime } = await chrome.storage.local.get([
    'probeDelaySeconds',
    'probeResult',
    'probeRuntime',
  ]);
  const selectedDelay = PROFILE.callbackDelaysSeconds.includes(Number(probeDelaySeconds))
    ? Number(probeDelaySeconds)
    : PROFILE.defaultCallbackDelaySeconds;
  renderDelayButtons(selectedDelay);
  apiStatus.textContent = probeRuntime?.apiAvailable ? 'verfügbar' : 'nicht verfügbar';
  apiStatus.dataset.state = probeRuntime?.apiAvailable ? 'pass' : 'fail';
  chromeVersion.textContent = probeRuntime?.chromeMajorVersion
    ? `Major ${probeRuntime.chromeMajorVersion}`
    : 'unbekannt';
  result.textContent = probeResult
    ? JSON.stringify(probeResult, null, 2)
    : 'Noch kein Druckereignis.';
}

clearResults.addEventListener('click', async () => {
  await chrome.storage.local.remove(['probeHistory', 'probeResult']);
  await render();
});
chrome.storage.onChanged.addListener(() => void render());

void render();
