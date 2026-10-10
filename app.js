// ─────────────────────────────────────────────
//  VBT Tracker – Web Bluetooth + Dashboard Logic
// ─────────────────────────────────────────────

const SERVICE_UUID            = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHARACTERISTIC_UUID     = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const CMD_CHARACTERISTIC_UUID = '5a7d3c90-951d-444a-8f5b-11c500732890';
const DEVICE_NAME             = 'VBT_Tracker';

// ── DOM refs ──
const btnConnect   = document.getElementById('btn-connect');
const liftSelect   = document.getElementById('lift-select');
const liveVelocity = document.getElementById('live-velocity');
const liveRpe      = document.getElementById('live-rpe');
const statusBadge  = document.getElementById('status-badge');
const historyTbody = document.querySelector('#history-table tbody');

// ── State ──
let bleDevice          = null;
let dataCharacteristic = null;
let cmdCharacteristic  = null;
let repCounter         = 0;

// ═══════════════════════════════════════════
//  Bluetooth Connection
// ═══════════════════════════════════════════

btnConnect.addEventListener('click', async () => {
  if (bleDevice && bleDevice.gatt.connected) {
    disconnect();
    return;
  }
  await connect();
});

async function connect() {
  try {
    btnConnect.textContent = 'Scanning…';
    btnConnect.disabled = true;

    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ name: DEVICE_NAME }],
      optionalServices: [SERVICE_UUID],
    });

    bleDevice.addEventListener('gattserverdisconnected', onDisconnected);

    const server  = await bleDevice.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    
    dataCharacteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
    cmdCharacteristic  = await service.getCharacteristic(CMD_CHARACTERISTIC_UUID);

    await dataCharacteristic.startNotifications();
    dataCharacteristic.addEventListener('characteristicvaluechanged', handleIncomingData);
    console.log('Successfully subscribed to notifications!');

    setConnectedUI(true);
    console.log('[VBT] Connected to', bleDevice.name);
  } catch (err) {
    console.error('[VBT] Connection failed:', err);
    setConnectedUI(false);
  }
}

function disconnect() {
  if (dataCharacteristic) {
    dataCharacteristic.removeEventListener('characteristicvaluechanged', handleIncomingData);
    dataCharacteristic = null;
  }
  cmdCharacteristic = null;
  if (bleDevice && bleDevice.gatt.connected) {
    bleDevice.gatt.disconnect();
  }
  bleDevice = null;
  setConnectedUI(false);
  console.log('[VBT] Disconnected');
}

function onDisconnected() {
  console.warn('[VBT] Device disconnected unexpectedly');
  dataCharacteristic = null;
  cmdCharacteristic = null;
  setConnectedUI(false);
}

// ═══════════════════════════════════════════
//  Command Transmission
// ═══════════════════════════════════════════

liftSelect.addEventListener('change', async (event) => {
  if (!cmdCharacteristic) {
    console.warn('[VBT] Not connected. Cannot send command.');
    return;
  }

  let cmdStr = '';
  switch (event.target.value) {
    case 'Squat':
      cmdStr = 'CMD:SL:SQ\n';
      break;
    case 'Bench':
      cmdStr = 'CMD:SL:BP\n';
      break;
    case 'Deadlift':
      cmdStr = 'CMD:SL:DL\n';
      break;
    default:
      console.warn('[VBT] Unknown lift selected');
      return;
  }

  try {
    const encoder = new TextEncoder();
    const payload = encoder.encode(cmdStr);
    await cmdCharacteristic.writeValue(payload);
    console.log(`[VBT] Sent command: ${cmdStr.trim()}`);
  } catch (err) {
    console.error('[VBT] Failed to send command:', err);
  }
});

// ═══════════════════════════════════════════
//  BLE Notification Handler
// ═══════════════════════════════════════════

function handleIncomingData(event) {
  try {
    const incomingText = new TextDecoder().decode(event.target.value);
    console.log('Received payload:', incomingText);

    // Expected format: "Deadlift | 0.24 m/s | RPE: 9.0"
    const parts = incomingText.split('|').map(s => s.trim());
    if (parts.length !== 3) {
      throw new Error('Payload missing required parts');
    }

    const lift = parts[0];                             // "Deadlift"
    const velocityMatch = parts[1].match(/([\d.]+)/);  // "0.24 m/s"
    const rpeMatch = parts[2].match(/([\d.]+)/);       // "RPE: 9.0"

    if (!velocityMatch || !rpeMatch) {
      throw new Error('Could not extract numeric values');
    }

    const parsedData = {
      lift: lift,
      velocity: parseFloat(velocityMatch[1]),
      rpe: parseFloat(rpeMatch[1]),
    };

    updateLiveDisplay(parsedData);
    appendHistoryRow(parsedData);

  } catch (err) {
    console.warn('[VBT] Parse error (ignoring malformed data):', err.message);
  }
}

// ═══════════════════════════════════════════
//  DOM Updates
// ═══════════════════════════════════════════

function updateLiveDisplay({ lift, velocity, rpe }) {
  // Velocity
  liveVelocity.textContent = velocity.toFixed(2);

  // RPE with colour zone
  liveRpe.textContent = rpe.toFixed(1);
  liveRpe.classList.remove('rpe-easy', 'rpe-mod', 'rpe-hard');
  if (rpe >= 9)       liveRpe.classList.add('rpe-hard');
  else if (rpe >= 7)  liveRpe.classList.add('rpe-mod');
  else                liveRpe.classList.add('rpe-easy');

  // Flash animation on the metric cards
  document.querySelectorAll('.metric-card').forEach(card => {
    card.classList.remove('flash');
    // Force reflow so re-adding the class restarts the transition
    void card.offsetWidth;
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 600);
  });

  // Sync the lift dropdown to whatever the tracker reports
  for (const opt of liftSelect.options) {
    if (opt.value.toLowerCase() === lift.toLowerCase()) {
      liftSelect.value = opt.value;
      break;
    }
  }
}

function appendHistoryRow({ lift, velocity, rpe }) {
  repCounter++;

  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const tr = document.createElement('tr');
  tr.classList.add('new-row');
  tr.innerHTML = `
    <td>${repCounter}</td>
    <td>${time}</td>
    <td>${escapeHtml(lift)}</td>
    <td>${velocity.toFixed(2)}</td>
    <td class="${rpeClass(rpe)}">${rpe.toFixed(1)}</td>
  `;

  // Prepend so newest rep is always at the top
  historyTbody.prepend(tr);

  // Remove animation class after it plays
  setTimeout(() => tr.classList.remove('new-row'), 500);
}

// ═══════════════════════════════════════════
//  UI Helpers
// ═══════════════════════════════════════════

function setConnectedUI(connected) {
  btnConnect.disabled = false;
  if (connected) {
    btnConnect.textContent = 'Disconnect';
    btnConnect.classList.add('connected');
    statusBadge.textContent = 'Connected';
    statusBadge.classList.remove('disconnected');
    statusBadge.classList.add('connected');
  } else {
    btnConnect.textContent = 'Connect Tracker';
    btnConnect.classList.remove('connected');
    statusBadge.textContent = 'Disconnected';
    statusBadge.classList.remove('connected');
    statusBadge.classList.add('disconnected');
  }
}

function rpeClass(rpe) {
  if (rpe >= 9) return 'rpe-hard';
  if (rpe >= 7) return 'rpe-mod';
  return 'rpe-easy';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}
