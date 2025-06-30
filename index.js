class TranscriptionApp {
  constructor() {
    // --- API Keys are hardcoded ---
    this.gladiaApiKey = '4613b547-3658-4ba1-a35c-e1571ab52c11';
    this.geminiApiKey = 'AIzaSyBLnChA72k37e91z2dNg1GrGjvar6Aaf1Q';

    // --- State Management ---
    this.callContext = { name: '', objective: '', problems: '' };
    this.ws = null;
    this.isRecording = false;
    this.audioContext = null;
    this.mediaStream = null;
    this.processor = null;

    // --- DOM Elements ---
    this.startBtn = document.getElementById('startBtn');
    this.stopBtn = document.getElementById('stopBtn');
    this.statusEl = document.getElementById('status');
    this.transcriptionEl = document.getElementById('transcription');
    this.notesEl = document.getElementById('sales-notes');
    this.recordingIndicator = document.getElementById('recordingIndicator');
    this.customerNameInput = document.getElementById('customerName');
    this.callObjectiveInput = document.getElementById('callObjective');
    this.customerProblemsInput = document.getElementById('customerProblems');
    this.saveContextBtn = document.getElementById('saveContextBtn');

    this.initialize();
  }

  initialize() {
    this.attachEventListeners();
    this.updateStatus('Ready to start', 'disconnected');
    this.startBtn.disabled = false;
  }

  attachEventListeners() {
    this.startBtn.addEventListener('click', () => this.handleStart());
    this.stopBtn.addEventListener('click', () => this.handleStop());
    this.saveContextBtn.addEventListener('click', () => this.saveCallContext());
  }

  // --- THIS FUNCTION WAS ACCIDENTALLY DELETED AND IS NOW RESTORED ---
  updateStatus(message, className) {
    this.statusEl.textContent = message;
    this.statusEl.className = `status ${className}`;
  }

  handleStart() {
    this.startBtn.disabled = true;
    this.stopBtn.disabled = true;
    this.transcriptionEl.innerHTML = '';
    this.notesEl.innerHTML = '';
    this.connectAndRecord(); // Simplified handler call
  }

  async connectAndRecord() {
    const connected = await this.connect();
    if (connected) {
      await this.startRecording();
      this.stopBtn.disabled = false;
    } else {
      this.startBtn.disabled = false;
    }
  }

  handleStop() {
    this.stopRecording();
    this.disconnect();
    this.startBtn.disabled = false;
    this.stopBtn.disabled = true;
  }

  saveCallContext() {
    this.callContext.name = this.customerNameInput.value.trim();
    this.callContext.objective = this.callObjectiveInput.value.trim();
    this.callContext.problems = this.customerProblemsInput.value.trim();
    this.saveContextBtn.textContent = 'Context Saved!';
    setTimeout(() => { this.saveContextBtn.textContent = 'Save Context'; }, 2000);
  }

  async connect() {
    this.updateStatus('Requesting session from Gladia...', 'connecting');
    try {
      const response = await fetch('https://api.gladia.io/v2/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Gladia-Key': this.gladiaApiKey },
        body: JSON.stringify({ encoding: 'wav/pcm', sample_rate: 16000, model: 'fast' }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to initiate session: ${response.status} ${errorText}`);
      }

      const session = await response.json();
      this.ws = new WebSocket(session.url);

      return new Promise((resolve) => {
        this.ws.onopen = () => {
          this.updateStatus('Connected. Starting microphone...', 'connected');
          resolve(true);
        };
        this.ws.onmessage = async (event) => {
          const message = JSON.parse(event.data.toString());
          if (message.type === 'transcript' && message.data?.is_final && message.data?.utterance?.text) {
            const utterance = message.data.utterance.text;
            this.appendTranscription(utterance);
            await this.getSalesNotes(utterance);
          }
        };
        this.ws.onerror = (error) => {
          console.error('WebSocket Error:', error);
          this.updateStatus('Connection Error', 'disconnected');
          resolve(false);
        };
      });
    } catch (error) {
      this.updateStatus(`${error.message}`, 'disconnected');
      console.error(error);
      return false;
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.updateStatus('Session ended. Ready to start.', 'disconnected');
  }

  async getSalesNotes(latestUtterance) {
    if (!this.geminiApiKey) {
      this.appendErrorNote("Gemini API key is missing.");
      return;
    }
    if (!latestUtterance) return;

    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.geminiApiKey}`;
    const prompt = `You are an expert sales meeting co-pilot. Context: Customer is ${this.callContext.name || 'unnamed'}, objective is "${this.callContext.objective || 'not set'}", their problem is "${this.callContext.problems || 'not set'}". Based on this context and the salesperson's latest utterance: "${latestUtterance}", provide a single, short, actionable note or question to ask next. Be concise.`;

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: 60 },
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || "Unknown API error");
      }
      const data = await response.json();
      if (data.candidates && data.candidates.length > 0) {
        const noteText = data.candidates[0].content.parts[0].text;
        this.appendSalesNote(noteText.trim());
      } else {
        this.appendErrorNote("Suggestion was blocked or empty.");
      }
    } catch (error) {
      console.error("Gemini API Error:", error);
      this.appendErrorNote(`Gemini Error: ${error.message}`);
    }
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
        for (let i = 0; i < audioData.length; i++) { pcmData[i] = Math.max(-1, Math.min(1, audioData[i])) * 32767; }
        this.ws.send(pcmData.buffer);
      };
      source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);
      this.isRecording = true;
      this.recordingIndicator.classList.add('active');
      this.updateStatus('Recording...', 'connected');
    } catch (error) {
      this.updateStatus('Microphone access denied.', 'disconnected');
      alert('Could not access the microphone. Please ensure you grant permission.');
    }
  }

  stopRecording() {
    if (!this.isRecording) return;
    this.isRecording = false;
    this.recordingIndicator.classList.remove('active');
    if (this.mediaStream) this.mediaStream.getTracks().forEach(track => track.stop());
    if (this.processor) this.processor.disconnect();
    if (this.audioContext) this.audioContext.close();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "stop_recording" }));
    }
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

  appendErrorNote(text) {
    const p = document.createElement('p');
    p.textContent = `⚠️ ${text}`;
    p.style.color = '#D8000C';
    p.style.fontStyle = 'normal';
    this.notesEl.appendChild(p);
    this.notesEl.scrollTop = this.notesEl.scrollHeight;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new TranscriptionApp();
});
