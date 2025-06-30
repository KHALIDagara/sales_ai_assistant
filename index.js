// WARNING: It is not secure to expose your API key directly in client-side code.
const GLADIA_API_KEY = '4613b547-3658-4ba1-a35c-e1571ab52c11';

class TranscriptionApp {
  constructor() {
    // Configuration
    this.apiKey = GLADIA_API_KEY;
    this.sampleRate = 16000;
    this.session_id = null; // To store the session ID from Gladia

    // Application State
    this.ws = null;
    this.isRecording = false;
    this.audioContext = null;
    this.mediaStream = null;
    this.processor = null;

    // DOM Elements
    this.startBtn = document.getElementById('startBtn');
    this.stopBtn = document.getElementById('stopBtn');
    this.statusEl = document.getElementById('status');
    this.transcriptionEl = document.getElementById('transcription');
    this.recordingIndicator = document.getElementById('recordingIndicator');

    this.initialize();
  }

  async initialize() {
    this.attachEventListeners();
    await this.connect();
  }

  attachEventListeners() {
    this.startBtn.addEventListener('click', () => this.startRecording());
    this.stopBtn.addEventListener('click', () => this.stopRecording());
  }

  updateStatus(message, className) {
    this.statusEl.textContent = message;
    this.statusEl.className = `status ${className}`;
  }

  // --- THIS FUNCTION IS COMPLETELY REWRITTEN FOR THE NEW V2/LIVE WORKFLOW ---
  async connect() {
    this.updateStatus('Requesting session from Gladia...', 'connecting');

    try {
      // Step 1: Call the /v2/live endpoint to get a temporary WebSocket URL
      const response = await fetch('https://api.gladia.io/v2/live', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gladia-Key': this.apiKey, // Use the correct header name
        },
        body: JSON.stringify({
          encoding: 'wav/pcm', // As per the new docs
          sample_rate: this.sampleRate,
          bit_depth: 16,
          channels: 1,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to initiate session: ${response.status} ${errorText}`);
      }

      const session = await response.json();
      this.session_id = session.id;
      const socketUrl = session.url;

      this.updateStatus('Connecting to WebSocket...', 'connecting');

      // Step 2: Connect to the temporary WebSocket URL
      this.ws = new WebSocket(socketUrl);

      this.ws.onopen = () => {
        this.updateStatus('Connected to Gladia', 'connected');
        this.startBtn.disabled = false;
      };

      // This message handler is updated to match the new documentation's format
      this.ws.onmessage = (event) => {
        const message = JSON.parse(event.data.toString());
        if (message.type === 'transcript' && message.data && message.data.is_final && message.data.utterance) {
          const text = message.data.utterance.text;
          if (text) { // Ensure the utterance is not empty
            this.appendTranscription(text);
          }
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket Error:', error);
        this.updateStatus('Connection Error', 'disconnected');
      };

      this.ws.onclose = () => {
        this.updateStatus('Disconnected', 'disconnected');
        this.startBtn.disabled = true;
        this.stopBtn.disabled = true;
      };

    } catch (error) {
      console.error(error);
      this.updateStatus(`Connection Failed: ${error.message}`, 'disconnected');
    }
  }

  // --- THIS FUNCTION IS UPDATED FOR THE NEW WORKFLOW ---
  stopRecording() {
    if (!this.isRecording) return;
    this.isRecording = false; // Set recording to false immediately

    // Stop microphone tracks and audio processing
    this.mediaStream.getTracks().forEach(track => track.stop());
    if (this.processor) this.processor.disconnect();
    if (this.audioContext) this.audioContext.close();

    // Send the "stop_recording" message as per the new docs
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "stop_recording" }));
    }

    // Update UI
    this.startBtn.disabled = false;
    this.stopBtn.disabled = true;
    this.recordingIndicator.classList.remove('active');
  }

  // --- NO CHANGES NEEDED FOR THE FUNCTIONS BELOW ---

  async startRecording() {
    if (this.isRecording) return;

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: this.sampleRate, channelCount: 1, echoCancellation: true }
      });

      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: this.sampleRate,
      });

      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.processor = this.audioContext.createScriptProcessor(2048, 1, 1);

      this.processor.onaudioprocess = (event) => {
        if (!this.isRecording || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
          return;
        }
        const audioData = event.inputBuffer.getChannelData(0);
        const pcmData = new Int16Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) {
          pcmData[i] = Math.max(-1, Math.min(1, audioData[i])) * 32767;
        }
        this.ws.send(pcmData.buffer);
      };

      source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      this.isRecording = true;
      this.startBtn.disabled = true;
      this.stopBtn.disabled = false;
      this.recordingIndicator.classList.add('active');
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Could not access the microphone. Please ensure you grant permission.');
    }
  }

  appendTranscription(text) {
    const textNode = document.createTextNode(text + ' ');
    this.transcriptionEl.appendChild(textNode);
    this.transcriptionEl.scrollTop = this.transcriptionEl.scrollHeight;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new TranscriptionApp();
});
