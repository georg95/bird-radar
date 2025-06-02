

(async function main() {
    const { birds, BirdNetJS } = await initBirdPredictionModel()

    const audioviz = document.createElement('canvas')
    audioviz.id = 'audioviz'
    audioviz.height = 256
    audioviz.width = document.body.clientWidth
    const recordButton = document.createElement('button')
    recordButton.id = 'record'
    recordButton.className = 'start'
    document.getElementById('header').append(audioviz, recordButton)

    let audioContext = null
    let mediaRecorder = null
    recordButton.onclick = async () => {
        if (!audioContext) {
            recordButton.className = 'stop';
            ({ audioContext, mediaRecorder } = await listen({ birds, BirdNetJS }))
        } else {
            mediaRecorder.stop()
            audioContext.close()
            audioContext = null
            mediaRecorder = null
            recordButton.className = 'start'
        }
    }
})()

async function listen({ birds, BirdNetJS }) {
    const audioContext = new AudioContext({ sampleRate: 48000 })

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

    const mediaRecorder = new MediaRecorder(stream)
    mediaRecorder.start(5000)
    mediaRecorder.ondataavailable = (e) => {
        console.log('Data available:', e)
    }

    const source = audioContext.createMediaStreamSource(stream)
    const processor = audioContext.createScriptProcessor(16384, 1, 1)
    processor.connect(audioContext.destination)
    source.connect(processor)
    audioViz(audioContext, source)

    const audioBuf = RingBuffer(3 * 48000)
    processor.onaudioprocess = async (e) => {
        const audioChunk3000ms = audioBuf.add(e.inputBuffer.getChannelData(0))
        if (audioChunk3000ms) {
            console.log('audio process', audioChunk3000ms.length, 'buffer')
            const prediction = await BirdNetJS.predict(tf.tensor([audioChunk3000ms])).data()
            let guessList = []
            for (let i = 0; i < prediction.length; i++) {
                if (prediction[i] > 0.3 && birds[i].geoscore > 0.0) {
                    guessList.push(birds[i].name)
                }
            }
            console.log('recogized:', guessList)
            guessList.forEach(birdDetected)
        }
    }
    return { audioContext, mediaRecorder }
}
function RingBuffer(size) {
    const buf = new Float32Array(size)
    let seeker = 0
    return {
        add(chunk) {
            chunk = new Float32Array(chunk)
            let filledBuf = null
            if (chunk.length + seeker >= buf.length) {
                buf.set(chunk.subarray(0, buf.length - seeker), seeker)
                filledBuf = buf.slice()
                buf.set(chunk.subarray(buf.length - seeker))
                seeker = chunk.length + seeker - buf.length
            } else {
                buf.set(chunk, seeker)
                seeker += chunk.length
            }
            return filledBuf
        }
    }
}

async function initBirdPredictionModel() {
    async function getCoords() {
        return new Promise(resolve => {
            navigator.geolocation.getCurrentPosition(({ coords }) => resolve(coords), resolve, { enableHighAccuracy: false })
        })
    }
    const progress = document.createElement('progress')
    const progressText = document.createElement('span')
    document.getElementById('header').append(progress, progressText)
    progress.max = 100
    progress.value = 0
    let currentProgress = 0
    function addProgress(value) {
        currentProgress += value
        progress.value = currentProgress
    }
    const birdsListPromise = fetch('models/V2.4/labels/en_us.txt').then(r => r.text())
    let prevLoadProgess = 0
    const loadModelPromise = tf.loadLayersModel('models/birdnet-js-chirpity/model.json', {
        weightPathPrefix: 'models/birdnet-js-chirpity/',
        onProgress: (p) => { addProgress((p - prevLoadProgess) * 50); prevLoadProgess = p }
    })
    addProgress(10)
    progressText.innerText = 'Loading birds aria model (7 Mb)...'
    const tfliteModel = await tflite.loadTFLiteModel('models/V2.4/BirdNET_GLOBAL_6K_V2.4_MData_Model_FP16.tflite')
    addProgress(10)
    progressText.innerText = 'Waiting geolocation to form birds list...'
    const { latitude, longitude } = await getCoords()
    addProgress(10)
    progressText.innerText = 'Forming birds list by geolocation and date...'
    const startOfYear = new Date(new Date().getFullYear(), 0, 1);
    startOfYear.setDate(startOfYear.getDate() + (1 - (startOfYear.getDay() % 7)))
    const week = Math.round((new Date() - startOfYear) / 604800000) + 1
    const geoscores = await tfliteModel.predict(tf.tensor([[latitude, longitude, week]])).data()
    addProgress(10)
    progressText.innerText = 'Loading english bird labels...'
    const birdsList = (await birdsListPromise).split('\n')
    const birds = new Array(geoscores.length)
    for (let i = 0; i < geoscores.length; i++) {
        birds[i] = {
            geoscore: geoscores[i],
            name: birdsList[i].split('_')[1]
        }
    }
    addProgress(10)
    progressText.innerText = 'Loading BirdNET model (60 Mb)...'
    await tf.setBackend('webgl')
    const BirdNetJS = await loadModelPromise

    document.getElementById('header').removeChild(progressText)
    document.getElementById('header').removeChild(progress)
    return { birds, BirdNetJS }
}
let birdsList = {}
const birdsDetected = {}
function birdDetected(bird) {
    const birdListNode = document.getElementById('birdlist')
    const firstBird = birdListNode.childNodes[0] || null
    const existingBirdView = document.getElementById(bird) 
    if (existingBirdView) {
        const birdCounter = existingBirdView.querySelector('.counter')
        birdCounter.innerText = (Number(birdCounter.innerText) + 1).toString()
        birdListNode.insertBefore(existingBirdView, firstBird)
        return
    }
    const birdView = document.createElement('div')
    birdView.className = 'bird'
    birdView.id = bird
    const birdImage = document.createElement('img')
    birdImage.src = `birds/${bird[0]}/${bird}.jpg`
    const birdCounter = document.createElement('div')
    birdCounter.className = 'counter'
    birdCounter.innerText = '1'
    birdView.appendChild(birdImage)
    birdView.appendChild(birdCounter)
    birdListNode.insertBefore(birdView, firstBird)
}

async function testBirdsUI() {
    const birdsTestList = ['Cyanistes caeruleus', 'Parus major', 'Pica pica', 'Passer domesticus', 'Passer montanus']
    for (let i = 0; i < 12; i++) {
        await new Promise(res => setTimeout(res, 1000))
        birdDetected(birdsTestList[Math.random() * birdsTestList.length | 0])
    }
}
// testBirdsUI()

function audioViz(context, source) {
    const [W, H] = [window.audioviz.width, window.audioviz.height]
    const ctx = window.audioviz.getContext("2d")
    ctx.fillStyle = "#222"
    ctx.fillRect(0, 0, W, H)
    const analyser = new AnalyserNode(context, { fftSize: 512, smoothingTimeConstant: 0.1 })
    source.connect(analyser)
    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    function drawAudioViz() {
        analyser.getByteFrequencyData(dataArray)
        const imageData = ctx.createImageData(1, H)
        for (let i = 0; i < imageData.data.length; i += 4) {
            const volume = dataArray[dataArray.length - 1 - i / 4] / 256 * (256 - 0x22) + 0x22
            imageData.data[i + 0] = volume // R
            imageData.data[i + 1] = volume // G
            imageData.data[i + 2] = volume // B
            imageData.data[i + 3] = 255 // A
        }
        ctx.putImageData(imageData, 0, 0)
        ctx.drawImage(window.audioviz, 1, 0)
        if (context.state !== 'closed') {
            requestAnimationFrame(drawAudioViz)
        }
    }
    drawAudioViz()
}

class MelSpecLayerSimple extends tf.layers.Layer {
    constructor(config) {
        super(config)
        this.sampleRate = config.sampleRate
        this.specShape = config.specShape
        this.frameStep = config.frameStep
        this.frameLength = config.frameLength
        this.melFilterbank = tf.tensor2d(config.melFilterbank)
    }
    build(inputShape) {
        this.magScale = this.addWeight(
            'magnitude_scaling',
            [],
            'float32',
            tf.initializers.constant({ value: 1.23 })
        );
        super.build(inputShape)
    }
    computeOutputShape(inputShape) {
        return [inputShape[0], this.specShape[0], this.specShape[1], 1];
    }
    call(inputs) {
    return tf.tidy(() => {
        let spec = inputs[0].squeeze();
        spec = tf.sub(spec, tf.min(spec, -1, true));
        spec = tf.div(spec, tf.max(spec, -1, true).add(0.000001));
        spec = tf.sub(spec, 0.5);
        spec = tf.mul(spec, 2.0);
        spec = stft(spec, this.frameLength, this.frameStep, this.frameLength, tf.signal.hannWindow)
        spec = tf.matMul(spec, this.melFilterbank)
        spec = spec.pow(2.0)
        spec = spec.pow(tf.div(1.0, tf.add(1.0, tf.exp(this.magScale.read()))))
        spec = tf.reverse(spec, -1)
        spec = tf.transpose(spec)
        spec = spec.expandDims(-1)
        spec = spec.expandDims(0)
        return spec;
    });
    }
    static get className() { return 'MelSpecLayerSimple' }
}
function stft(signal, frameLength, frameStep, fftLength, windowFn) {
    const framedSignal = tf.engine().runKernel('FRAME', {input: signal, frameLength, frameStep })
    const input = tf.mul(framedSignal, windowFn(frameLength))
    let innerDim = input.shape[input.shape.length - 1]
    const batch = input.size / innerDim
    const realValues = tf.engine().runKernel('FFT2', {input: tf.reshape(input, [batch, innerDim])})
    const half = Math.floor(innerDim / 2) + 1
    const realComplexConjugate = tf.split(
        realValues, [half, innerDim - half],
        realValues.shape.length - 1)
    const outputShape = input.shape.slice()
    outputShape[input.shape.length - 1] = half
    return tf.reshape(realComplexConjugate[0], outputShape)
}
tf.serialization.registerClass(MelSpecLayerSimple)
tf.registerKernel({
    kernelName: 'FFT2',
    backendName: 'webgl',
    kernelFunc: ({ backend, inputs: { input } }) => {
        const innerDim = input.shape[input.shape.length - 1] / 2
        const batch = tf.util.sizeFromShape(input.shape) / innerDim / 2
        let currentTensor = backend.runWebGLProgram({
            variableNames: ['mapvalue'],
            outputShape: [batch, innerDim * 2],
            userCode: `
void main() {
  ivec2 coords = getOutputCoords();
  int p = coords[1] % ${innerDim};
  int k = 0;
  for (int i = 0; i < ${Math.log2(innerDim)}; ++i) {
    if ((p & (1 << i)) != 0) { k |= (1 << (${Math.log2(innerDim) - 1} - i)); }
  }
  if (coords[1] < ${innerDim}) {
    setOutput(getMapvalue(coords[0], 2 * k));
  } else {
    setOutput(getMapvalue(coords[0], 2 * (k % ${innerDim}) + 1));
  }
}`
        }, [input], 'float32')
        for (let len = 1; len < innerDim; len *= 2) {
            let prevTensor = currentTensor
            currentTensor = backend.runWebGLProgram({
                variableNames: [`x`],
                outputShape: [batch, innerDim * 2],
                userCode: `void main() {
ivec2 coords = getOutputCoords();
int batch = coords[0];
int i = coords[1];
int k = i % ${innerDim};
int isHigh = (k % ${len * 2}) / ${len};
int highSign = (1 - isHigh * 2);
int baseIndex = k - isHigh * ${len};
float t = ${Math.PI / len} * float(k % ${len});
float a = cos(t);
float b = sin(-t);
float oddK_re = getX(batch, baseIndex + ${len});
float oddK_im = getX(batch, baseIndex + ${len + innerDim});
if (i / ${innerDim} == 0) { // real
    float evenK_re = getX(batch, baseIndex);
    float outp = evenK_re + (oddK_re * a - oddK_im * b) * float(highSign);
    setOutput(outp);
} else { // imaginary
    float evenK_im = getX(batch, baseIndex + ${innerDim});
    float outp = evenK_im + (oddK_re * b + oddK_im * a) * float(highSign);
    setOutput(outp);
}
}` }, [currentTensor], 'float32')
            backend.disposeIntermediateTensorInfo(prevTensor)
        }

        let prevTensor = currentTensor
        currentTensor = backend.runWebGLProgram({
            variableNames: ['x'],
            outputShape: [batch, innerDim * 2],
            userCode: `
void main() {
    ivec2 coords = getOutputCoords();
    int i = coords[1];
    int batch = coords[0];

    int k = i <= ${innerDim} ? i : ${innerDim * 2} - i;
    int zI = k % ${innerDim};
    int conjI = (${innerDim} - k) % ${innerDim};
    float Zk0 = getX(batch, zI);
    float Zk_conj0 = getX(batch, conjI);
    float t = ${-2 * Math.PI} * float(k) / float(${innerDim * 2});
    float result = (Zk0 + Zk_conj0 + cos(t) * (getX(batch, zI+${innerDim}) + getX(batch, conjI+${innerDim})) + sin(t) * (Zk0 - Zk_conj0)) * 0.5;
    setOutput(result);
}`
        }, [currentTensor], 'float32')
        backend.disposeIntermediateTensorInfo(prevTensor)
        return currentTensor
    }
})
tf.registerKernel({
    kernelName: 'FRAME',
    backendName: 'webgl',
    kernelFunc: ({ backend, inputs: { input, frameLength, frameStep } }) => {
        const outpLen = (input.size - frameLength + frameStep) / frameStep | 0
        
        return backend.runWebGLProgram({
            variableNames: ['x'],
            outputShape: [outpLen, frameLength],
            userCode: `
    void main() {
    ivec2 coords = getOutputCoords();
    int j = coords[1];
    int b = coords[0];
    int i = b * ${frameLength} + j;
    setOutput(getX((i / ${frameLength}) * ${frameStep} + i % ${frameLength}));
    }`
        }, [input], 'float32')
    }
})
