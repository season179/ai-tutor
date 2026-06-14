type ClientSecretResponse = {
  value?: string;
  client_secret?: {
    value?: string;
  };
};

type SessionState = {
  dataChannel: RTCDataChannel;
  localStream: MediaStream;
  peerConnection: RTCPeerConnection;
};

const startButton = getElement<HTMLButtonElement>("start");
const stopButton = getElement<HTMLButtonElement>("stop");
const statusText = getElement<HTMLElement>("status");
const eventLog = getElement<HTMLPreElement>("event-log");
const remoteAudio = getElement<HTMLAudioElement>("remote-audio");

let session: SessionState | undefined;
let hasLoggedEvents = false;

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing element #${id}`);
  }

  return element as T;
}

function setStatus(message: string): void {
  statusText.textContent = message;
}

function logEvent(message: string, value?: unknown): void {
  const time = new Date().toLocaleTimeString();
  const renderedValue = value === undefined ? "" : ` ${JSON.stringify(value, null, 2)}`;
  const previousLog = hasLoggedEvents ? eventLog.textContent : "";

  hasLoggedEvents = true;
  eventLog.textContent = `[${time}] ${message}${renderedValue}\n${previousLog}`;
}

function readClientSecret(payload: ClientSecretResponse): string {
  const secret = payload.value ?? payload.client_secret?.value;

  if (!secret) {
    throw new Error("Token response did not include a client secret value.");
  }

  return secret;
}

function setRunning(isRunning: boolean): void {
  startButton.disabled = isRunning;
  stopButton.disabled = !isRunning;
}

async function fetchClientSecret(): Promise<string> {
  const response = await fetch("/token", { method: "POST" });
  const payload = (await response.json().catch(() => null)) as (ClientSecretResponse & { error?: string }) | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? `Failed to fetch Realtime client secret (${response.status}).`);
  }

  if (!payload) {
    throw new Error("Token response was not valid JSON.");
  }

  return readClientSecret(payload);
}

async function startSession(): Promise<void> {
  if (session) {
    return;
  }

  setRunning(true);
  setStatus("Requesting microphone access...");

  let pendingSession: SessionState | undefined;

  try {
    const ephemeralKey = await fetchClientSecret();
    const peerConnection = new RTCPeerConnection();
    const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const dataChannel = peerConnection.createDataChannel("oai-events");
    pendingSession = { dataChannel, localStream, peerConnection };
    session = pendingSession;

    peerConnection.ontrack = (event) => {
      remoteAudio.srcObject = event.streams[0] ?? null;
    };

    for (const track of localStream.getAudioTracks()) {
      peerConnection.addTrack(track, localStream);
    }

    dataChannel.addEventListener("open", () => {
      setStatus("Connected. Speak into your microphone.");
      logEvent("Data channel opened");
      dataChannel.send(
        JSON.stringify({
          type: "response.create",
          response: {
            instructions: "Greet the user briefly and invite them to test the voice session."
          }
        })
      );
    });

    dataChannel.addEventListener("message", (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string };
        logEvent(payload.type ?? "Realtime event", payload);
      } catch {
        logEvent("Realtime event", event.data);
      }
    });

    dataChannel.addEventListener("close", () => {
      logEvent("Data channel closed");
    });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const localDescription = peerConnection.localDescription;
    if (!localDescription?.sdp) {
      throw new Error("Browser did not create a local WebRTC offer.");
    }

    const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      body: localDescription.sdp,
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        "Content-Type": "application/sdp"
      }
    });

    if (!sdpResponse.ok) {
      throw new Error(`Realtime SDP request failed: ${sdpResponse.status} ${await sdpResponse.text()}`);
    }

    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: await sdpResponse.text()
    });

    setStatus("Connecting...");
  } catch (error) {
    cleanupSession(pendingSession);
    session = undefined;
    setRunning(false);
    setStatus(error instanceof Error ? error.message : "Failed to start session.");
    logEvent("Start failed", error instanceof Error ? error.message : error);
  }
}

function cleanupSession(activeSession: SessionState | undefined): void {
  if (!activeSession) {
    return;
  }

  activeSession.dataChannel.close();
  activeSession.localStream.getTracks().forEach((track) => track.stop());
  activeSession.peerConnection.close();
  remoteAudio.srcObject = null;
}

function stopSession(): void {
  if (!session) {
    setRunning(false);
    return;
  }

  cleanupSession(session);
  session = undefined;
  setRunning(false);
  setStatus("Disconnected.");
}

startButton.addEventListener("click", () => {
  startSession().catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : "Unexpected error.");
  });
});

stopButton.addEventListener("click", stopSession);
