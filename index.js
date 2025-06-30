class TranscriptionApp {
  constructor() {
    // --- API Keys are hardcoded ---
    this.gladiaApiKey = '4613b547-3658-4ba1-a35c-e1571ab52c11';
    this.geminiApiKey = 'AIzaSyBEl9--RnImGi50jNdq7_nfvHAcg7biOsw';

    // --- State Management ---
    this.callContext = { name: '', objective: '', problems: '' }; // NEW: To store form data
    this.ws = null;
    this.isRecording = false;
    // ... other state variables

    // --- DOM Elements ---
    this.startBtn = document.getElementById('startBtn');
    this.stopBtn = document.getElementById('stopBtn');
    this.statusEl = document.getElementById('status');
    this.transcriptionEl = document.getElementById('transcription');
    this.notesEl = document.getElementById('sales-notes');
    this.recordingIndicator = document.getElementById('recordingIndicator');

    // NEW: Form elements
    this.customerNameInput = document.getElementById('customerName');
    this.callObjectiveInput = document.getElementById('callObjective');
    this.customerProblemsInput = document.getElementById('customerProblems');
    this.saveContextBtn = document.getElementById('saveContextBtn');

    this.initialize();
  }

  async initialize() {
    this.attachEventListeners();
    await this.connect();
  }

  attachEventListeners() {
    this.startBtn.addEventListener('click', () => this.startRecording());
    this.stopBtn.addEventListener('click', () => this.stopRecording());
    // NEW: Event listener for the save context button
    this.saveContextBtn.addEventListener('click', () => this.saveCallContext());
  }

  // NEW: Function to save context from the form
  saveCallContext() {
    this.callContext.name = this.customerNameInput.value.trim();
    this.callContext.objective = this.callObjectiveInput.value.trim();
    this.callContext.problems = this.customerProblemsInput.value.trim();

    // Provide user feedback
    this.saveContextBtn.textContent = 'Context Saved!';
    setTimeout(() => {
      this.saveContextBtn.textContent = 'Save Context';
    }, 2000);
  }

  // --- Gemini API Logic (MODIFIED to be context-aware) ---
  async getSalesNotes(latestUtterance) {
    if (!this.geminiApiKey || !latestUtterance) return;

    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.geminiApiKey}`;

    // NEW: Context-aware prompt
    const prompt = `You are an expert sales meeting co-pilot.
        
        Here is the static context for the current sales call:
        - Customer Name: ${this.callContext.name || 'Not specified'}
        - This Call's Objective: ${this.callContext.objective || 'Not specified'}
        - Customer's Known Problems: ${this.callContext.problems || 'Not specified'}

        Based ONLY on the static context above, analyze the following LATEST utterance from the salesperson and provide a single, short, actionable note or a clever question they should ask next to advance the sale. Be concise and direct.

        Salesperson's latest utterance: "${latestUtterance}"

        Your suggestion:`;

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: 60 },
        }),
      });

      if (!response.ok) return;

      const data = await response.json();
      if (data.candidates && data.candidates.length > 0) {
        const noteText = data.candidates[0].content.parts[0].text;
        this.appendSalesNote(noteText.trim());
      }
    } catch (error) {
      console.error("Gemini API Error:", error);
    }
  }

  // --- Gladia Connection Logic (MODIFIED to call the new getSalesNotes) ---
  async connect() {
    // ... (This function remains mostly the same as the last version)
    this.updateStatus('Requesting session...', 'connecting');
    try {
      const response = await fetch('https://api.gladia.io/v2/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Gladia-Key': this.gladiaApiKey, },
        body: JSON.stringify({ encoding: 'wav/pcm', sample_rate: 16000, model: 'fast' }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to initiate session: ${response.status} ${errorText}`);
      }
      const session = await response.json();
      this.ws = new WebSocket(session.url);
      this.ws.onopen = () => { this.updateStatus('Connected', 'connected'); this.startBtn.disabled = false; };
      this.ws.onmessage = async (event) => {
        const message = JSON.parse(event.data.toString());
        if (message.type === 'transcript' && message.data?.is_final && message.data?.utterance?.text) {
          const utterance = message.data.utterance.text;
          this.appendTranscription(utterance);
          // This now passes only the LATEST utterance for analysis against the static context
          await this.getSalesNotes(utterance);
        }
      };
      this.ws.onerror = () => this.updateStatus('Connection Error', 'disconnected');
      this.ws.onclose = () => this.updateStatus('Disconnected', 'disconnected');
    } catch (error) { this.updateStatus(`${error.message}`, 'disconnected'); }
  }

  // --- Other functions (startRecording, stopRecording, appendTranscription, etc.) ---
  // These functions below have no significant changes from the last version.

  updateStatus(message, className) {
    this.statusEl.textContent = message;
    this.statusEl.className = `status ${className}`;
  }

  async startRecording() {
    if (this.isRecording) return;
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true }
      });
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.processor = this.audioContext.createScriptProcessor(2048, 1, 1);
      this.processor.onaudioprocess = (event) => {
        if (!this.isRecording || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
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
      alert('Could not access the microphone. Please ensure you grant permission.');
    }
  }

  stopRecording() {
    if (!this.isRecording) return;
    this.isRecording = false;
    if (this.mediaStream) this.mediaStream.getTracks().forEach(track => track.stop());
    if (this.processor) this.processor.disconnect();
    if (this.audioContext) this.audioContext.close();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "stop_recording" }));
    }
    this.startBtn.disabled = false;
    this.stopBtn.disabled = true;
    this.recordingIndicator.classList.remove('active');
  }

  appendTranscription(text) {
    const p = document.createElement('p');
    p.textContent = text;
    this.transcriptionEl.appendChild(p);
    this.transcriptionEl.scrollTop = this.transcriptionEl.scrollHeight;
  }

  appendSalesNote(text) {
    const p = document.createElement('p');
    p.textContent = `✨ ${text}`;
    this.notesEl.appendChild(p);
    this.notesEl.scrollTop = this.notesEl.scrollHeight;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new TranscriptionApp();
});
