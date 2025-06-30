class TranscriptionApp {
  constructor() {
    // --- API Keys are hardcoded here ---
    this.gladiaApiKey = '4613b547-3658-4ba1-a35c-e1571ab52c11';
    this.geminiApiKey = 'AIzaSyBEl9--RnImGi50jNdq7_nfvHAcg7biOsw';

    // --- Configuration ---
    this.sampleRate = 16000;
    this.session_id = null;

    // --- Application State ---
    this.ws = null;
    this.isRecording = false;
    this.audioContext = null;
    this.mediaStream = null;
    this.processor = null;
    this.fullTranscript = "";

    // --- DOM Elements ---
    this.startBtn = document.getElementById('startBtn');
    this.stopBtn = document.getElementById('stopBtn');
    this.statusEl = document.getElementById('status');
    this.transcriptionEl = document.getElementById('transcription');
    this.notesEl = document.getElementById('sales-notes');
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

  async connect() {
    if (!this.gladiaApiKey) {
      this.updateStatus('Gladia API Key is missing.', 'disconnected');
      return;
    }

    this.updateStatus('Requesting session from Gladia...', 'connecting');

    try {
      const response = await fetch('https://api.gladia.io/v2/live', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gladia-Key': this.gladiaApiKey,
        },
        body: JSON.stringify({
          encoding: 'wav/pcm',
          sample_rate: this.sampleRate,
          model: 'fast',
          // "language: 'en'" was removed from here, as it's not a valid parameter.
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to initiate session: ${response.status} ${errorText}`);
      }

      const session = await response.json();
      this.session_id = session.id;
      this.ws = new WebSocket(session.url);

      this.ws.onopen = () => {
        this.updateStatus('Connected to Gladia', 'connected');
        this.startBtn.disabled = false;
      };

      this.ws.onmessage = async (event) => {
        const message = JSON.parse(event.data.toString());
        if (message.type === 'transcript' && message.data?.is_final && message.data?.utterance?.text) {
          const utterance = message.data.utterance.text;
          this.appendTranscription(utterance);
          this.fullTranscript += utterance + " ";
          await this.getSalesNotes(this.fullTranscript);
        }
      };

      this.ws.onerror = () => this.updateStatus('Connection Error', 'disconnected');
      this.ws.onclose = () => this.updateStatus('Disconnected', 'disconnected');

    } catch (error) {
      console.error(error);
      this.updateStatus(`${error.message}`, 'disconnected');
    }
  }

  async getSalesNotes(transcribedText) {
    if (!this.geminiApiKey || !transcribedText) {
      return;
    }

    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.geminiApiKey}`;
    const prompt = `You are an expert sales meeting assistant. Based on the following transcript of what a salesperson just said, provide a single, short, actionable note or a clever question they should ask next to advance the sale. Be concise and direct. Keep the response to one sentence.

Transcript context: "${transcribedText}"

Your suggestion:`;

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: 50 },
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

  async startRecording() {
    if (this.isRecording) return;
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: this.sampleRate, channelCount: 1, echoCancellation: true }
      });
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: this.sampleRate });
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
    this.mediaStream.getTracks().forEach(track => track.stop());
    if (this.processor) this.processor.disconnect();
    if (this.audioContext) this.audioContext.close();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "stop_recording" }));
    }
    this.startBtn.disabled = false;
    this.stopBtn.disabled = true;
    this.recordingIndicator.classList.remove('active');
    this.fullTranscript = "";
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
