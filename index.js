

async function main() {
    const { birds, BirdNetJS } = await initBirdPredictionModel()

    document.getElementById('loading-pane').style.display = 'none'
    document.getElementById('record-pane').style.display = 'flex'

    let audioContext = null
    document.getElementById('record').onclick = () => onRecordButton().catch((err) => {
        onError(err)
        document.getElementById('record').className = 'start'
        document.getElementById('record-icon').className = 'paused-icon'
    })
    async function onRecordButton() {
        if (!audioContext) {
            document.getElementById('record').className = ''
            document.getElementById('record-icon').className = 'waiting-icon'
            audioContext = await listen({ birds, BirdNetJS })
            document.getElementById('record').className = 'stop'
            document.getElementById('record-icon').className = ''
            document.getElementById('record-status').innerText = 'Recording'
            document.getElementById('error').innerText = ''
        } else {
            document.getElementById('record-icon').className = 'paused-icon'
            document.getElementById('record-status').innerText = 'Recording paused'
            document.getElementById('record').className = 'start'
            audioContext.close()
            audioContext = null
        }
    }
}
main().catch(onError)

function onError(err) {
    document.getElementById('error').innerText = err.message
    document.getElementById('error').innerHTML += '<br /><br />'
    document.getElementById('error').innerText += err.stack
}

async function listen({ birds, BirdNetJS }) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(e => {
        throw new Error('Please enable microphone in site permissions')
    })
    const audioContext = new AudioContext({ sampleRate: 48000 })
    await audioContext.audioWorklet.addModule('audio-recorder.js')
    const workletNode = new AudioWorkletNode(audioContext, 'audio-recorder')
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(workletNode)
    const gain = audioContext.createGain();
    gain.gain.value = 0; // mute output
    workletNode.connect(gain).connect(audioContext.destination);
    workletNode.port.onmessage = (event) => processAudioBatch(event).catch(onError)
    async function processAudioBatch(event) {
        const chunk = new Float32Array(event.data)
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
            let geoscore = 1
            if (birds[i].geoscore !== undefined) {
                geoscore = birds[i].geoscore
            }
            if (prediction[i] > 0.35 && geoscore > 0.2) {
                guessList.push({ ...birds[i], score: prediction[i] })
            }
        }
        if (guessList.length > 0) {
            console.log('guessList:', guessList)
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
    let prevLoadProgess = 0
    const loadModelPromise = tf.loadLayersModel('https://georg95.github.io/birdnet-web/models/birdnet/model.json', {
        onProgress: (p) => { addProgress((p - prevLoadProgess) * 40); prevLoadProgess = p }
    })
    addProgress(10)
    progressText.innerText = 'Loading birds aria model (7 Mb)...'
    const tfliteModel = await tflite.loadTFLiteModel('https://georg95.github.io/birdnet-web/models/birdnet/area-model.tflite')

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
    progressText.innerText = 'Loading bird labels...'
    const birdsList = (await fetch('https://georg95.github.io/birdnet-web/models/birdnet/labels/en_us.txt').then(r => r.text())).split('\n')
    const supportedLanguages = ['af', 'da', 'en_us', 'fr', 'ja', 'no', 'ro', 'sl', 'tr', 'ar', 'de', 'es',
        'hu', 'ko', 'pl', 'ru', 'sv', 'uk', 'cs', 'en_uk', 'fi', 'it', 'nl', 'pt', 'sk', 'th', 'zh']
    const lang = supportedLanguages.find(l => l.startsWith(navigator.language)) || 'en_us'
    const birdsListI18n = (await fetch(`https://georg95.github.io/birdnet-web/models/birdnet/labels/${lang}.txt`).then(r => r.text())).split('\n')

    const birds = new Array(birdsList.length)
    for (let i = 0; i < birds.length; i++) {
        birds[i] = {
            geoscore: geoscores?.[i],
            name: birdsList[i].split('_')[1],
            nameI18n: birdsListI18n[i].split('_')[1],
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
function birdDetected({ name, nameI18n }) {
    const birdListNode = document.getElementById('birdlist')
    const firstBird = birdListNode.childNodes[0] || null
    const existingBirdView = document.getElementById(name) 
    if (existingBirdView) {
        const birdCounter = existingBirdView.querySelector('.counter')
        birdCounter.innerText = (Number(birdCounter.innerText) + 1).toString()
        birdListNode.insertBefore(existingBirdView, firstBird)
        return
    }
    const birdView = document.createElement('div')
    birdView.className = 'bird'
    birdView.id = name
    const birdImage = document.createElement('img')
    birdImage.src = `birds/${name[0]}/${name}.jpg`
    birdImage.onerror = () => { birdImage.src='birds/unknown.webp' }
    const birdCounter = document.createElement('div')
    birdCounter.className = 'counter'
    birdCounter.innerText = '1'
    const birdName = document.createElement('span')
    birdName.innerText = nameI18n
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
            spec = tf.engine().runKernel('STFT', { signal: spec, frameLength: this.frameLength, frameStep: this.frameStep })
            spec = tf.matMul(spec, this.melFilterbank)
            spec = spec.pow(2.0)
            spec = spec.pow(tf.div(1.0, tf.add(1.0, tf.exp(this.magScale.read()))))
            spec = tf.reverse(spec, -1)
            spec = tf.transpose(spec)
            spec = spec.expandDims(-1)
            return spec;
            }))
        })
    }
    static get className() { return 'MelSpecLayerSimple' }
}
tf.serialization.registerClass(MelSpecLayerSimple)

tf.registerKernel({
    kernelName: 'STFT',
    backendName: 'webgl',
    kernelFunc: ({ backend, inputs: { signal, frameLength, frameStep } }) => {
        const innerDim = frameLength / 2
        const batch = (signal.size - frameLength + frameStep) / frameStep | 0
        let currentTensor = backend.runWebGLProgram({
            variableNames: ['x'],
            outputShape: [batch, frameLength],
            userCode: `
            void main() {
                ivec2 coords = getOutputCoords();
                int p = coords[1] % ${innerDim};
                int k = 0;
                for (int i = 0; i < ${Math.log2(innerDim)}; ++i) {
                    if ((p & (1 << i)) != 0) { k |= (1 << (${Math.log2(innerDim) - 1} - i)); }
                }
                int i = 2 * k;
                if (coords[1] >= ${innerDim}) {
                    i = 2 * (k % ${innerDim}) + 1;
                }
                int q = coords[0] * ${frameLength} + i;
                float val = getX((q / ${frameLength}) * ${frameStep} + q % ${frameLength});
                float cosArg = ${2.0 * Math.PI / frameLength} * float(q);
                float mul = 0.5 - 0.5 * cos(cosArg);
                setOutput(val * mul);
            }`
        }, [signal], 'float32')
        for (let len = 1; len < innerDim; len *= 2) {
            let prevTensor = currentTensor
            currentTensor = backend.runWebGLProgram({
                variableNames: ['x'],
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
                    if (i < ${innerDim}) { // real
                        float evenK_re = getX(batch, baseIndex);
                        setOutput(evenK_re + (oddK_re * a - oddK_im * b) * float(highSign));
                    } else { // imaginary
                        float evenK_im = getX(batch, baseIndex + ${innerDim});
                        setOutput(evenK_im + (oddK_re * b + oddK_im * a) * float(highSign));
                    }
                }`
            }, [currentTensor], 'float32')
            backend.disposeIntermediateTensorInfo(prevTensor)
        }
        const real = backend.runWebGLProgram({
            variableNames: ['x'],
            outputShape: [batch, innerDim + 1],
            userCode: `void main() {
                ivec2 coords = getOutputCoords();
                int batch = coords[0];
                int i = coords[1];
                int zI = i % ${innerDim};
                int conjI = (${innerDim} - i) % ${innerDim};
                float Zk0 = getX(batch, zI);
                float Zk1 = getX(batch, zI+${innerDim});
                float Zk_conj0 = getX(batch, conjI);
                float Zk_conj1 = -getX(batch, conjI+${innerDim});
                float t = ${-2 * Math.PI} * float(i) / float(${innerDim * 2});
                float diff0 = Zk0 - Zk_conj0;
                float diff1 = Zk1 - Zk_conj1;
                float result = (Zk0 + Zk_conj0 + cos(t) * diff1 + sin(t) * diff0) * 0.5;
                setOutput(result);
            }`
        }, [currentTensor], 'float32')
        backend.disposeIntermediateTensorInfo(currentTensor)
        return real
    }
})

tf.registerKernel({
    kernelName: 'STFT',
    backendName: 'webgpu',
    kernelFunc: ({ backend, inputs: { signal, frameLength, frameStep } }) => {
        const workgroupSize = [64, 1, 1]
        const innerDim = frameLength / 2
        const batch = (signal.size - frameLength + frameStep) / frameStep | 0
        let currentTensor = backend.runWebGPUProgram({
            variableNames: ['x'],
            workgroupSize: [64, 1, 1],
            outputShape: [batch, innerDim * 2],
            shaderKey: `fft_permut_${innerDim}_${frameStep}`,
            dispatchLayout: { x: [0, 1] },
            dispatch: [Math.ceil(batch * innerDim * 2 / workgroupSize[0]), 1, 1],
            getUserCode: () => `
            fn main(index: i32) {
                let batch = index / ${innerDim * 2};
                let p = index % ${innerDim};
                var k = 0;
                for (var i: u32 = 0; i < ${Math.log2(innerDim)}; i = i + 1) {
                    if ((p & (1 << i)) != 0) { k |= (1 << (${Math.log2(innerDim) - 1} - i)); }
                }
                var i = 2 * k;
                if (index % ${innerDim * 2} >= ${innerDim}) {
                    i = 2 * (k % ${innerDim}) + 1;
                }
                var q = batch * ${frameLength} + i;
                var val = getX((q / ${frameLength}) * ${frameStep} + q % ${frameLength});
                var cosArg = ${2.0 * Math.PI / frameLength} * f32(q);
                var mul = 0.5 - 0.5 * cos(cosArg);
                setOutputAtIndex(index, val * mul);
            }`
        }, [signal], 'float32')
        for (let len = 1; len < innerDim; len *= 2) {
            let prevTensor = currentTensor
            currentTensor = backend.runWebGPUProgram({
                variableNames: ['x'],
                workgroupSize,
                outputShape: [batch, innerDim * 2],
                shaderKey: `fft_step_${innerDim}_${len}`,
                dispatchLayout: { x: [0, 1] },
                dispatch: [Math.ceil(batch * innerDim / workgroupSize[0]), 1, 1],
                getUserCode: () => {
                    return `fn main(index: i32) {
                        let batch = index / ${innerDim};
                        var i = index % ${innerDim};
                        let outIndexReal = batch * ${innerDim * 2} + i;
                        let outIndexImag = outIndexReal + ${innerDim};
                        let isHigh = (i % (${len} * 2)) / ${len};
                        let highSign = (1 - isHigh * 2);
                        let baseIndex = i - isHigh * ${len};
                        let t = ${Math.PI / len} * f32(i % ${len});
                        let a = cos(t);
                        let b = sin(-t);
                        let oddK_re = getX(batch, baseIndex + ${len});
                        let oddK_im = getX(batch, baseIndex + ${len} + ${innerDim});
                        let evenK_re = getX(batch, baseIndex);
                        setOutputAtIndex(outIndexReal, (evenK_re + (oddK_re * a - oddK_im * b) * f32(highSign)));
                        let evenK_im = getX(batch, baseIndex + ${innerDim});
                        setOutputAtIndex(outIndexImag, (evenK_im + (oddK_re * b + oddK_im * a) * f32(highSign)));
                    }`
                }
            }, [currentTensor], 'float32')
            backend.disposeData(prevTensor.dataId)
        }
        const real = backend.runWebGPUProgram({
            variableNames: ['x'],
            workgroupSize,
            outputShape: [batch, innerDim + 1],
            shaderKey: `rfft_reassemble_${innerDim}_real`,
            dispatchLayout: { x: [0, 1] },
            dispatch: [Math.ceil((batch * (innerDim + 1)) / workgroupSize[0]), 1, 1],
            getUserCode: () => `fn main(index: i32) {
                let batch = index / ${innerDim + 1};
                let i = index % ${innerDim + 1};
                let k = i;
                let zI = k % ${innerDim};
                let conjI = (${innerDim} - k) % ${innerDim};
                let Zk0 = getX(batch, zI);
                let Zk1 = getX(batch, zI+${innerDim});
                let Zk_conj0 = getX(batch, conjI);
                let Zk_conj1 = -getX(batch, conjI+${innerDim});
                let t = ${-2 * Math.PI} * f32(k) / f32(${innerDim * 2});
                let diff0 = Zk0 - Zk_conj0;
                let diff1 = Zk1 - Zk_conj1;
                let result = (Zk0 + Zk_conj0 + cos(t) * diff1 + sin(t) * diff0) * 0.5;
                setOutputAtIndex(index, result);
            }`
        }, [currentTensor], 'float32')
        backend.disposeData(currentTensor.dataId)
        return real
    }
})