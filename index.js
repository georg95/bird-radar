async function main() {
    const { birds, BirdNetJS } = await initBirdPredictionModel()
    const db = await database()
    displayBirdsStats(db)
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(({ kind }) => kind === 'audioinput')
    const audioSelect = document.querySelector('select')
    let selectedInput = (devices.find(d => d.deviceId === 'default') || devices[0]).deviceId
    devices.forEach(device => {
        const option = document.createElement('option')
        option.innerText = device.label
        option.value = device.deviceId
        audioSelect.appendChild(option)
        audioSelect.onchange = () => {
            selectedInput = audioSelect.value
        }
    })

    document.getElementById('show-settings').onclick = () => {
        document.getElementById('settings-pane').style.display = 'flex'
        document.getElementById('record-pane').style.display = 'none'
    }
    document.getElementById('hide-settings').onclick = () => {
        document.getElementById('settings-pane').style.display = 'none'
        document.getElementById('record-pane').style.display = 'flex'
    }
    document.getElementById('loading-pane').style.display = 'none'
    document.getElementById('record-pane').style.display = 'flex'
    document.getElementById('record').onclick = () => onRecordButton().catch((err) => {
        onError(err)
        document.getElementById('record').className = 'start'
        document.getElementById('record-icon').className = 'paused-icon'
    })

    async function processAudioBatch(event) {
        const pcmAudio = new Float32Array(event.data)
        const start = Date.now()
        tf.engine().startScope()
        const prediction = await BirdNetJS.predict(tf.tensor([pcmAudio])).data()
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
        const MIN_SCORE = 0.1
        const MIN_GEO_SCORE = 0.05
        for (let i = 0; i < prediction.length; i++) {
            let geoscore = 1
            if (birds[i].geoscore !== undefined) {
                geoscore = birds[i].geoscore
            }
            if (prediction[i] > MIN_SCORE && geoscore > MIN_GEO_SCORE) {
                guessList.push({ ...birds[i], score: prediction[i] })
            }
        }
        if (guessList.length > 0) {
            console.log('guessList:', guessList)
            const encodedAudio = await encodeAudio(pcmAudio, 48000, 128000)
            const audioSrc = URL.createObjectURL(encodedAudio)
            guessList.forEach(({ name, nameI18n, score }) => {
                document.getElementById('birdlist').prepend(birdCallItem({ name, nameI18n, score, audioSrc }))
            })
            await db.putBirdCalls(guessList, encodedAudio)
        }
    }

    let audioContext = null
    async function onRecordButton() {
        if (!audioContext) {
            document.getElementById('record').className = ''
            document.getElementById('record-icon').className = 'waiting-icon'
            audioContext = await listen({ processAudioBatch, selectedInput })
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

async function displayBirdsStats(db) {
    const birdList = await db.getLastBirdcalls()
    const birdsMap = {}
    for (let { name, nameI18n } of birdList) {
        if (!birdsMap[name]) {
            birdsMap[name] = {
                name,
                nameI18n,
                count: 0,
            }
        }
        birdsMap[name].count++
    }
    for (let name in birdsMap) {
        birdDetected(birdsMap[name])
    }
}

function birdDetected({ name, nameI18n, count=1 }) {
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
    birdCounter.innerText = count
    const birdName = document.createElement('span')
    birdName.innerText = nameI18n
    birdView.appendChild(birdImage)
    birdView.appendChild(birdCounter)
    birdView.appendChild(birdName)
    birdListNode.insertBefore(birdView, firstBird)
}

async function displayBirdsCalls(db) {
    const birdList = await db.getLastBirdcalls()
    for (let { name, nameI18n, score, audioId } of birdList) {
        const audioSrc = URL.createObjectURL(await db.getAudio(audioId))
        document.getElementById('birdlist').prepend(birdCallItem({ name, nameI18n, score, audioSrc }))
    }
}

function birdCallItem({ name, nameI18n, score, audioSrc }) {
    const birdItem = document.createElement('div')
    birdItem.className = 'bird-call'
    const birdImage = document.createElement('img')
    birdImage.src = `birds/${name[0]}/${name}.jpg`
    birdImage.onerror = () => { birdImage.src='birds/unknown.webp' }
    birdImage.title = nameI18n

    const birdDetails = document.createElement('div')
    birdDetails.className = 'bird-details'

    const audio = document.createElement('audio')
    audio.controls = true
    audio.src = audioSrc
    birdDetails.appendChild(audio)

    const title = document.createElement('span')
    title.className = 'bird-details-title'
    title.innerText = nameI18n

    const confidence = document.createElement('span')
    confidence.className = 'bird-details-confidence'
    confidence.style.color = '#900'
    if (score > 0.3) { confidence.style.color = '#FFFF55' }
    if (score > 0.6) { confidence.style.color = '#00FF55' }
    title.appendChild(confidence)
    confidence.innerText = `score: ${score.toFixed(2)}`
    birdDetails.appendChild(title)

    birdItem.appendChild(birdImage)
    birdItem.appendChild(birdDetails)
    return birdItem
}

async function database() {
    const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('Birdcalls')
        request.onerror = () => reject('Cant save birds calls in IndexedDB')
        request.onsuccess = (event) => resolve(event.target.result)
        request.onupgradeneeded = (event) => {
            const db = event.target.result
            const objectStore = db.createObjectStore('birds', { autoIncrement: true })
            objectStore.createIndex('name', 'name', { unique: false })
            objectStore.createIndex('time', 'time', { unique: false })
            db.createObjectStore('audio', { autoIncrement: true })
        }
    })

    return {
        async putBirdCalls(guessList, encodedAudio) {
            const time = Date.now()
            const audioId = await new Promise(resolve => {
                const tx = db.transaction('audio', 'readwrite')
                const audioPut = tx.objectStore('audio').add(encodedAudio)
                tx.oncomplete = () => resolve(audioPut.result)
            })
            await new Promise(resolve => {
                const tx = db.transaction('birds', 'readwrite')
                const objectStore = tx.objectStore('birds')
                guessList.forEach(bird => {
                    objectStore.add({ ...bird, time, audioId })
                })
                tx.oncomplete = () => resolve()
            })
        },
        async getLastBirdcalls() {
            return new Promise(resolve => {
                const tx = db.transaction('birds', 'readonly')
                const objectStore = tx.objectStore('birds')
                const request = objectStore.getAll() // TODO filter by last 24 hours
                request.onsuccess = (event) => {
                    resolve(event.target.result)
                }
            })
        },
        async getAudio(id) {
            return new Promise(resolve => {
                const tx = db.transaction('audio', 'readonly')
                const objectStore = tx.objectStore('audio')
                const request = objectStore.get(id)
                request.onsuccess = (event) => {
                    resolve(event.target.result)
                }
            })
        }
    }
}

function onError(err) {
    document.getElementById('error').innerText = err.message
    document.getElementById('error').innerHTML += '<br /><br />'
    document.getElementById('error').innerText += err.stack
}

async function encodeAudio(float32Array, sampleRate=48000, bitrate) {
    const codecs = [
        'audio/ogg; codecs=opus',
        'audio/mp4; codecs=opus',
        'audio/ogg',
        'audio/mp4',
    ]
    const codec = codecs.find(codec => MediaRecorder.isTypeSupported(codec))
    if (!codec) {
        console.warn('codecs', codecs, 'not supported')
        return
    }
    const audioContext = new AudioContext({ sampleRate })
    const buffer = audioContext.createBuffer(1, float32Array.length, sampleRate)
    buffer.getChannelData(0).set(float32Array)
    const source = audioContext.createBufferSource()
    source.buffer = buffer
    const destination = source.connect(audioContext.createMediaStreamDestination())
    const recorder = new MediaRecorder(destination.stream, {
        mimeType: codec,
        audioBitsPerSecond: bitrate,
    })

    recorder.start()
    source.start()
    return new Promise(async (resolve) => {
        const recordedChunks = []
        recorder.ondataavailable = async (e) => {
            if (e.data.size > 0) { recordedChunks.push(e.data) }
            if (recorder.state === 'inactive') {
                resolve(new Blob(recordedChunks, { type: codec }))
            }
        }
        await new Promise(resolve => source.onended = resolve)
        setTimeout(() => recorder.stop(), 100)
    })
}

async function listen({ processAudioBatch, selectedInput }) {
    const audioContext = new AudioContext({ sampleRate: 48000 })
    if (audioContext.sampleRate !== 48000) {
        throw new Error('Couldn\'t change sample rate to 48khz')
    }
    await audioContext.audioWorklet.addModule('audio-recorder.js')
    const workletNode = new AudioWorkletNode(audioContext, 'audio-recorder')
    const setGain = audioContext.createGain(); setGain.gain.value = 1.0
    const zeroGain = audioContext.createGain(); zeroGain.gain.value = 0
    // const highpassFilter = audioContext.createBiquadFilter();
    // highpassFilter.type = "highpass";
    // highpassFilter.frequency.value = 100;

    // Audio graph
    audioContext.createMediaStreamSource(await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: selectedInput,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 1,
            }
        }).catch(e => { throw new Error('Please enable microphone in site permissions') }))
        .connect(setGain)
        // .connect(highpassFilter)
        .connect(workletNode)
        .connect(zeroGain)
        .connect(audioContext.destination) // some browsers optimize away graph with no destination

    workletNode.port.onmessage = (event) => processAudioBatch(event).catch(onError)
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
    const loadModelPromise = tf.loadLayersModel('/birdnet-web/models/birdnet/model.json', {
        onProgress: (p) => { addProgress((p - prevLoadProgess) * 40); prevLoadProgess = p }
    })
    addProgress(10)
    progressText.innerText = 'Loading birds aria model (7 Mb)...'
    const tfliteModel = await tflite.loadTFLiteModel('/birdnet-web/models/birdnet/area-model.tflite')

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
    const lang = supportedLanguages.find(l => l.startsWith(navigator.language.split('-')[0])) || 'en_us'
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