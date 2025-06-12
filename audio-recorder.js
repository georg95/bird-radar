class RecorderProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this._buffer = [];
      this._bufferSize = 144000; // 3 seconds at 48kHz
    }
  
    process(inputs) {
      const input = inputs[0];
      if (input.length === 0 || input[0].length === 0) return true;
  
      const channelData = input[0]; // mono channel
  
      this._buffer.push(...channelData);
  
      if (this._buffer.length >= this._bufferSize) {
        const chunk = this._buffer.slice(0, this._bufferSize);
        this.port.postMessage(chunk);
        this._buffer = this._buffer.slice(this._bufferSize); // retain any excess
      }
  
      return true;
    }
}

registerProcessor('audio-recorder', RecorderProcessor);