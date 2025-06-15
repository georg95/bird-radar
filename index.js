

(async function main() {
    const { birds, BirdNetJS } = await initBirdPredictionModel()

    document.getElementById('loading-pane').style.display = 'none'
    document.getElementById('record-pane').style.display = 'flex'

    let audioContext = null
    document.getElementById('record').onclick = async () => {
        if (!audioContext) {
            document.getElementById('record').className = ''
            document.getElementById('record-icon').className = 'waiting-icon'
            audioContext = await listen({ birds, BirdNetJS })
            document.getElementById('record').className = 'stop'
            document.getElementById('record-icon').className = ''
            document.getElementById('record-status').innerText = 'Recording'
        } else {
            document.getElementById('record-icon').className = 'paused-icon'
            document.getElementById('record-status').innerText = 'Recording paused'
            document.getElementById('record').className = 'start'
            audioContext.close()
            audioContext = null
        }
    }
})()

async function listen({ birds, BirdNetJS }) {
    // await new Promise(res => setTimeout(res, 1000))
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const audioContext = new AudioContext({ sampleRate: 48000 })
    await audioContext.audioWorklet.addModule('audio-recorder.js')
    const workletNode = new AudioWorkletNode(audioContext, 'audio-recorder')
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(workletNode)
    const gain = audioContext.createGain();
    gain.gain.value = 0; // mute output
    workletNode.connect(gain).connect(audioContext.destination);
    let audioProcessed = 0
    workletNode.port.onmessage = async (event) => {
        const chunk = new Float32Array(event.data)
        audioProcessed += 3000
        const start = Date.now()
        tf.engine().startScope()
        const prediction = await BirdNetJS.predict(tf.tensor([chunk])).data()
        tf.engine().endScope()
        const load = Math.round((Date.now() - start) / 30)
        document.getElementById('ai-status').innerText = `AI: ${tf.getBackend()}, gpu load: ${load}%`
        if (load <= 10) {
            document.getElementById('ai-icon').className = 'ai-fast-speed'
        }
        if (load > 50) {
            document.getElementById('ai-icon').className = 'ai-slow-speed'
        }
        let guessList = []
        for (let i = 0; i < prediction.length; i++) {
            if (prediction[i] > 0.1 && birds[i].geoscore > 0.0) {
                guessList.push(birds[i].name)
            }
        }
        guessList.forEach(birdDetected)
    }
    return audioContext
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
        return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false })
        })
    }
    await tf.ready()
    const progress = document.querySelector('#loading-pane progress')
    const progressText = document.querySelector('#loading-pane span')
    progress.max = 100
    progress.value = 0
    let currentProgress = 0
    function addProgress(value) {
        currentProgress += value
        progress.value = currentProgress
    }
    const birdsListPromise = fetch('models/V2.4/labels/en_us.txt').then(r => r.text())
    let prevLoadProgess = 0
    const loadModelPromise = tf.loadLayersModel('models/birdnet/model.json', {
        weightPathPrefix: 'models/birdnet/',
        onProgress: (p) => { addProgress((p - prevLoadProgess) * 40); prevLoadProgess = p }
    })
    addProgress(10)
    progressText.innerText = 'Loading birds aria model (7 Mb)...'
    const tfliteModel = await tflite.loadTFLiteModel('models/V2.4/BirdNET_GLOBAL_6K_V2.4_MData_Model_FP16.tflite')

    let geoscores = null
    try {
        addProgress(10)
        progressText.innerText = 'Waiting geolocation to form birds list...'
        const { coords: { latitude, longitude } } = await getCoords()
        addProgress(5)
        console.log('latitude, longitude:', latitude, longitude)
        progressText.innerText = 'Forming birds list by geolocation and date...'
        const startOfYear = new Date(new Date().getFullYear(), 0, 1);
        startOfYear.setDate(startOfYear.getDate() + (1 - (startOfYear.getDay() % 7)))
        const week = Math.round((new Date() - startOfYear) / 604800000) + 1
        geoscores = await tfliteModel.predict(tf.tensor([[latitude, longitude, week]])).data()
        addProgress(5)
    } catch(e) {
        document.getElementById('geo-icon').className = 'geo-disabled'
        document.getElementById('geo-status').innerText = e.message
        addProgress(20)
    }
    progressText.innerText = 'Loading english bird labels...'
    const birdsList = (await birdsListPromise).split('\n')
    const birds = new Array(birdsList.length)
    for (let i = 0; i < birds.length; i++) {
        birds[i] = {
            geoscore: geoscores?.[i],
            name: birdsList[i].split('_')[1]
        }
    }
    addProgress(10)
    progressText.innerText = 'Loading BirdNET model (60 Mb)...'
    const BirdNetJS = await loadModelPromise
    addProgress(10)
    progressText.innerText = 'BirdNET warmup run...'
    tf.engine().startScope()
    await BirdNetJS.predict(tf.zeros([1, 144000]), { batchSize: 1 }).data()
    tf.engine().endScope()
    addProgress(10)
    progressText.innerText = 'BirdNET benchmark...'
    tf.engine().startScope()
    await BirdNetJS.predict(tf.zeros([1, 144000]), { batchSize: 1 }).data()
    tf.engine().endScope()
    document.getElementById('ai-status').innerText = `AI: ${tf.getBackend()}`

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
    birdImage.onerror = () => { birdImage.src='birds/unknown.webp' }
    const birdCounter = document.createElement('div')
    birdCounter.className = 'counter'
    birdCounter.innerText = '1'
    const birdName = document.createElement('span')
    birdName.innerText = bird
    birdView.appendChild(birdImage)
    birdView.appendChild(birdCounter)
    birdView.appendChild(birdName)
    birdListNode.insertBefore(birdView, firstBird)
}

async function testBirdsUI() {
    const birdsTestList = ['notfound', 'Cyanistes caeruleus', 'Parus major', 'Pica pica', 'Passer domesticus', 'Passer montanus']
    for (let i = 0; i < 12; i++) {
        await new Promise(res => setTimeout(res, 1000))
        birdDetected(birdsTestList[Math.random() * birdsTestList.length | 0])
    }
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
        inputs = inputs[0]
        return tf.stack(inputs.split(inputs.shape[0]).map((input) => {
                let spec = input.squeeze()
                spec = tf.sub(spec, tf.min(spec, -1, true))
                spec = tf.div(spec, tf.max(spec, -1, true).add(0.000001))
                spec = tf.sub(spec, 0.5)
                spec = tf.mul(spec, 2.0)
                spec = stft(spec, this.frameLength, this.frameStep, this.frameLength, tf.signal.hannWindow)
                spec = tf.matMul(spec, this.melFilterbank)
                spec = spec.pow(2.0)
                spec = spec.pow(tf.div(1.0, tf.add(1.0, tf.exp(this.magScale.read()))))
                spec = tf.reverse(spec, -1)
                spec = tf.transpose(spec)
                spec = spec.expandDims(-1)
                // spec = spec.expandDims(0)
                return spec;
            }))
        })
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
function arrayProduct (arr) {
    let product = 1;
    for (let i = 0; i < arr.length; i++) { product *= arr[i] }
    return product;
}
function flatDispatchLayout(shape) { return {x: shape.map((d, i) => i)} }
function computeDispatch(layout, outputShape, workgroupSize = [1, 1, 1], elementsPerThread = [1, 1, 1]) {
return [Math.ceil(arrayProduct(layout.x.map(d => outputShape[d])) /(workgroupSize[0] * elementsPerThread[0])),
    layout.y ? Math.ceil(arrayProduct(layout.y.map(d => outputShape[d])) / (workgroupSize[1] * elementsPerThread[1])) : 1,
    layout.z ? Math.ceil(arrayProduct(layout.z.map(d => outputShape[d])) / (workgroupSize[2] * elementsPerThread[2])) : 1]
}

if (!globalThis.tf) { globalThis.tf = {} }
tf.registerKernel?.({
    kernelName: 'FFT2',
    backendName: 'webgpu',
    kernelFunc: ({ backend, inputs: { input } }) => {
        const innerDim = input.shape[input.shape.length - 1] / 2
        const batch = tf.util.sizeFromShape(input.shape) / innerDim / 2
        const workgroupSize = [64, 1, 1]
        const dispatchLayout = flatDispatchLayout([batch, innerDim * 2])
        const dispatch = computeDispatch(dispatchLayout, [batch, innerDim * 2], workgroupSize, [2, 1, 1])
        let currentTensor = backend.runWebGPUProgram({
            variableNames: ['X'],
            outputShape: [batch, innerDim * 2],
            workgroupSize,
            shaderKey: `fft_permut_${innerDim}`,
            dispatchLayout,
            dispatch,
            getUserCode: () => `
fn main(index: i32) {
let batch = index / ${innerDim};
let p = index % ${innerDim};
let outIndexReal = batch * ${innerDim * 2} + p;
let outIndexImag = outIndexReal + ${innerDim};
var k = 0;
for (var i: u32 = 0; i < ${Math.log2(innerDim)}; i = i + 1) {
    if ((p & (1 << i)) != 0) { k |= (1 << (${Math.log2(innerDim) - 1} - i)); }
}
setOutputAtIndex(outIndexReal, getX(batch, 2 * k));
setOutputAtIndex(outIndexImag, getX(batch, 2 * (k % ${innerDim}) + 1));
}`
        }, [input], 'float32')
        for (let len = 1; len < innerDim; len *= 2) {
            let prevTensor = currentTensor
            currentTensor = backend.runWebGPUProgram({
                variableNames: [`value`],
                outputShape: [batch, innerDim * 2],
                workgroupSize,
                shaderKey: `fft_step_${innerDim}_${len}`,
                dispatchLayout,
                dispatch,
                getUserCode: () => `fn main(index: i32) {
                    let batch = index / ${innerDim};
                    let i = index % ${innerDim};
                    let outIndexReal = batch * ${innerDim * 2} + i;
                    let outIndexImag = outIndexReal + ${innerDim};
                    let k = i % ${innerDim};
                    let isHigh = (k % (${len} * 2)) / ${len};
                    let highSign = (1 - isHigh * 2);
                    let baseIndex = k - isHigh * ${len};
                    let t = ${Math.PI} / f32(${len}) * f32(k % ${len});
                    let a = cos(t);
                    let b = sin(-t);
                    let oddK_re = getValue(batch, baseIndex + ${len});
                    let oddK_im = getValue(batch, baseIndex + ${len} + ${innerDim});

                    let evenK_re = getValue(batch, baseIndex);
                    let outpR = (evenK_re + (oddK_re * a - oddK_im * b) * f32(highSign));
                    setOutputAtIndex(outIndexReal, outpR);
                    let evenK_im = getValue(batch, baseIndex + ${innerDim});
                    let outpI = (evenK_im + (oddK_re * b + oddK_im * a) * f32(highSign));
                    setOutputAtIndex(outIndexImag, outpI);
                    }`
                }, [currentTensor], 'float32')
            backend.disposeData(prevTensor.dataId)
        }
        let prevTensor = currentTensor
        currentTensor = backend.runWebGPUProgram({
            variableNames: ['x'],
            outputShape: [batch, innerDim * 2],
            workgroupSize,
            shaderKey: `fft_post_${innerDim}`,
            dispatchLayout,
            dispatch: computeDispatch(flatDispatchLayout([batch, innerDim * 2]), [batch, innerDim * 2], workgroupSize, [1, 1, 1]),
            getUserCode: () => `
fn main(index: i32) {
    let coords = getOutputCoords();
    let i = coords[1];
    let batch = coords[0];
    var k = i;
    if (i > ${innerDim}) {
      k = ${innerDim * 2} - i;
    }
    let zI = k % ${innerDim};
    let conjI = (${innerDim} - k) % ${innerDim};
    let Zk0 = getX(batch, zI);
    let Zk_conj0 = getX(batch, conjI);
    let t = ${-2 * Math.PI} * f32(k) / f32(${innerDim * 2});
    let result = (Zk0 + Zk_conj0 + cos(t) * (getX(batch, zI+${innerDim}) + getX(batch, conjI+${innerDim})) + sin(t) * (Zk0 - Zk_conj0)) * 0.5;
    setOutputAtIndex(index, result);
}`
        }, [currentTensor], 'float32')
        backend.disposeData(prevTensor.dataId)
        return currentTensor
    }
})
tf.registerKernel({
    kernelName: 'FRAME',
    backendName: 'webgpu',
    kernelFunc: ({ backend, inputs: { input, frameLength, frameStep } }) => {
        const workgroupSize = [64, 1, 1]
        const outpLen = (input.size - frameLength + frameStep) / frameStep | 0
        const dispatchLayout = flatDispatchLayout([outpLen, frameLength])
        return backend.runWebGPUProgram({
            variableNames: ['x'],
            outputShape: [outpLen, frameLength],
            workgroupSize,
            shaderKey: `frame_${frameLength}_${frameStep}`,
            dispatchLayout,
            dispatch: computeDispatch(dispatchLayout, [outpLen, frameLength], workgroupSize),
            getUserCode: () => `
    fn main(i: i32) {
        setOutputAtIndex(i, getX((i / ${frameLength}) * ${frameStep} + i % ${frameLength}));
    }`
        }, [input], 'float32')
    }
})