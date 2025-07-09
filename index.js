main().catch(showError)

async function main() {
    const BirdNetJS = await loadingScreen()
    const state = {
        db: await database(),
        settings: {}
    }
    document.getElementById('loading-pane').style.display = 'none'
    document.getElementById('record-pane').style.display = 'flex'
    document.getElementById('record').onclick = () => onRecordButton().catch((err) => {
        showError(err)
        document.getElementById('record').className = 'start'
        document.getElementById('record-icon').className = 'paused-icon'
    })
    const { addBirdToUI } = showDetectedBirdsUI(state)
    await prepareSettingsUI(state)

    let audioContext = null
    async function onRecordButton() {
        if (!audioContext) {
            document.getElementById('record').className = ''
            document.getElementById('record-icon').className = 'waiting-icon'
            audioContext = await listen()
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
    async function listen() {
        const audioContext = new AudioContext({ sampleRate: 22050 })
        if (audioContext.sampleRate !== 22050) {
            throw new Error('Couldn\'t change sample rate to 22khz')
        }
        await audioContext.audioWorklet.addModule('audio-recorder.js')
        const workletNode = new AudioWorkletNode(audioContext, 'audio-recorder')
        const setGain = audioContext.createGain(); setGain.gain.value = 1.0
        const zeroGain = audioContext.createGain(); zeroGain.gain.value = 0
        // Audio graph
        audioContext.createMediaStreamSource(await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: state.settings.selectedInput,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    channelCount: 1,
                }
            }).catch(e => { throw new Error('Please enable microphone in site permissions') }))
            .connect(setGain)
            .connect(workletNode)
            .connect(zeroGain)
            .connect(audioContext.destination) // some browsers optimize away graph with no destination

        const queueAudioProcess = (() => {
            let pending = Promise.resolve()
            const run = async (event) => {
                await pending
                return processAudioBatch(event)
            }
            return (event) => (pending = run(event).catch(showError))
        })()
        workletNode.port.onmessage = queueAudioProcess
        return audioContext
    }
    let recordingBird = {}
    let prevAudio = null
    async function processAudioBatch(event) {
        const pcmAudio = new Float32Array(event.data)
        const start = Date.now()
        const { prediction } = await BirdNetJS({ message: 'predict', pcmAudio })
        const load = Math.round((Date.now() - start) / 30)
        document.getElementById('ai-status').innerText = `GPU load: ${load}%, RAM: ${performance.memory.usedJSHeapSize/performance.memory.jsHeapSizeLimit * 100 | 0}%`
        if (load <= 10) {
            document.getElementById('ai-icon').className = 'ai-fast-speed'
        }
        if (load > 50) {
            document.getElementById('ai-icon').className = 'ai-slow-speed'
        }
        let recordingBirdsNew = {}
        if (prediction.length > 0) {
            const time = Date.now()
            const startAudioId = prevAudio ? await state.db.putEncodedAudio(prevAudio) : null
            const currentAudioId = await state.db.putEncodedAudio(pcmAudio)
            for (let bird of prediction) {
                console.log('recordingBird:', recordingBird, `(${bird.name}) ->`, recordingBird[bird.name])
                const key = recordingBird[bird.name]
                if (key) {
                    recordingBirdsNew[bird.name] = key
                    await state.db.addBirdCallAudio(key, currentAudioId)
                } else {
                    recordingBirdsNew[bird.name] = await state.db.putBirdCalls({
                        ...bird,
                        time,
                        audioIds: startAudioId ? [startAudioId, currentAudioId] : [currentAudioId]
                    })
                    addBirdToUI({ ...bird, time, key: recordingBirdsNew[bird.name] })
                }
            }
        }
        recordingBird = recordingBirdsNew
        prevAudio = pcmAudio.slice(pcmAudio.length - 22050)
    }
}

async function loadingScreen() {
    const BirdNetWorker = new Worker(`/birdnet-web/birdnet2.js?lang=${navigator.language}`)
    async function BirdNetJS(data) {
        BirdNetWorker.postMessage(data)
        return new Promise(resolve => {
            function onMessage({ data: dataRes }) {
                if (dataRes.message === data.message) {
                    BirdNetWorker.removeEventListener('message', onMessage)
                    resolve(dataRes)
                }
            }
            BirdNetWorker.addEventListener('message', onMessage)
        })
    }

    const geolocation = new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false })
    })
    await new Promise((resolve) => {
        function onLoadingMessage({ data }) {
            if (data.progress) {
                document.querySelector('#loading-pane progress').value = data.progress
            }
            if (data.message === 'load_model') {
                document.getElementById('progress_text').innerText = 'Loading BirdNET model...'
            }
            if (data.message === 'warmup') {
                document.getElementById('progress_text').innerText = 'BirdNET warmup run...'
            }
            if (data.message === 'load_labels') {
                document.getElementById('progress_text').innerText = 'Loading bird labels...'
            }
            if (data.message === 'load_geomodel') {
                document.getElementById('progress_text').innerText = 'Loading geolocation model...'
            }
            if (data.message === 'loaded') {
                BirdNetWorker.removeEventListener('message', onLoadingMessage)
                resolve()
            }
        }
        BirdNetWorker.addEventListener('message', onLoadingMessage)
    })

    document.getElementById('progress_text').innerText = 'Waiting geolocation...'
    const { coords: { latitude, longitude } } = await geolocation
    document.getElementById('progress_text').innerText = 'Inference area model...'
    await BirdNetJS({ message: 'area-scores', latitude, longitude })
    document.getElementById('progress_text').innerText = 'Preparing...'
    return BirdNetJS
}

function showDetectedBirdsUI(state) {
    navigator.wakeLock?.request('screen').catch(showError)
    let currentView = 'list'
    let viewSettings = null
    displayBirds('list')
    async function displayBirds(view, settings=null) {
        currentView = view
        viewSettings = settings
        document.getElementById('birdlist').innerHTML = ''
        document.getElementById('switch-view').innerText = currentView === 'stat' ? '📜' : '📊'
        let birdList = await state.db.getLastBirdcalls()
        if (birdList.length) {
            document.getElementById('view-filter').style.display = 'flex'
        }
        birdList.reverse()
        if (currentView === 'list') {
            document.getElementById('birdlist').append(...birdList.map(bird => birdCallItemShort(bird, state.db)))
        } else if (currentView === 'filterlist') {
            birdList = birdList.filter(({ name }) => name === viewSettings)
            document.getElementById('birdlist').append(...birdList.map(bird => birdCallItemShort(bird, state.db)))
        } else if (currentView === 'stat') {
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
                const birdItem = addBirdToStatsScreen(birdsMap[name])
                if (birdItem) {
                    birdItem.onclick = () => displayBirds('filterlist', name)
                }
            }
        }
    }
    async function addBirdToUI(bird) {
        document.getElementById('view-filter').style.display = 'flex'
        if (currentView === 'list') {
            document.getElementById('birdlist').prepend(birdCallItemShort(bird, state.db))
        } else if (currentView === 'filterlist') {
            if (bird.name === viewSettings) {
                document.getElementById('birdlist').prepend(birdCallItemShort(bird, state.db))
            }
        } else if (currentView === 'stat') {
            const birdItem = addBirdToStatsScreen({ ...bird, count: 1 })
            if (birdItem) {
                birdItem.onclick = () => displayBirds('filterlist', bird.name)
            }
        }
    }
    document.getElementById('switch-view').onclick = () => {
        displayBirds(currentView === 'stat' ? 'list' : 'stat')
    }

    return { addBirdToUI }
}

async function prepareSettingsUI(state) {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(({ kind }) => kind === 'audioinput')
    const audioSelect = document.querySelector('select')
    devices.forEach(device => {
        const option = document.createElement('option')
        option.innerText = device.label
        option.value = device.deviceId
        if (device.deviceId === 'default') {
            option.selected = true
        }
        audioSelect.appendChild(option)
        audioSelect.onchange = () => {
            state.settings.selectedInput = audioSelect.value
        }
    })
    state.settings.selectedInput = (devices.find(d => d.deviceId === 'default') || devices[0]).deviceId
    document.getElementById('show-settings').onclick = () => {
        document.getElementById('settings-pane').style.display = 'flex'
        document.getElementById('record-pane').style.display = 'none'
    }
    document.getElementById('hide-settings').onclick = () => {
        document.getElementById('settings-pane').style.display = 'none'
        document.getElementById('record-pane').style.display = 'flex'
    }
}

function addBirdToStatsScreen({ name, nameI18n, count=1 }) {
    const birdListNode = document.getElementById('birdlist')
    const firstBird = birdListNode.childNodes[0] || null
    const existingBirdView = document.getElementById(name)
    if (existingBirdView) {
        const birdCounter = existingBirdView.querySelector('.counter')
        birdCounter.innerText = (Number(birdCounter.innerText) + count).toString()
        birdListNode.insertBefore(existingBirdView, firstBird)
        return
    }
    const birdView = document.createElement('div')
    birdView.className = 'bird'
    birdView.id = name
    const birdImage = document.createElement('img')
    birdImage.src = `birds/${name[0]}/${name}.jpg`
    birdImage.onerror = () => {
        if (birdImage.src !== 'birds/unknown.webp') { // fix recursive error when unknown.webp is not loaded due to network
            birdImage.src = 'birds/unknown.webp'
        }
    }
    const birdCounter = document.createElement('div')
    birdCounter.className = 'counter'
    birdCounter.innerText = count
    const birdName = document.createElement('span')
    birdName.innerText = nameI18n
    birdView.appendChild(birdImage)
    birdView.appendChild(birdCounter)
    birdView.appendChild(birdName)
    birdListNode.insertBefore(birdView, firstBird)
    return birdView
}

function formatTime(timestamp) {
    const date = new Date(timestamp)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    const pad = (n) => String(n).padStart(2, '0')
    const hours = pad(date.getHours())
    const minutes = pad(date.getMinutes())
    if (isToday) {
        return `${hours}:${minutes}`;
    } else {
        const day = pad(date.getDate())
        const month = pad(date.getMonth() + 1)
        return `${day}/${month} ${hours}:${minutes}`
    }
}

let activeBirdItem = null
function birdCallItemShort(bird, db) {
    const { time, name, nameI18n, confidence } = bird
    const birdItem = document.createElement('div')
    birdItem.onclick = async () => {
        activeBirdItem?.removeFocus()
        const birdItemFull = birdCallItemFull(bird, db)
        activeBirdItem = birdItemFull
        birdItem.replaceWith(birdItemFull)
        birdItemFull.removeFocus = () => {
            birdItemFull.replaceWith(birdItem)
        }
    }
    birdItem.className = 'bird-call'
    const birdImage = document.createElement('img')
    birdImage.src = `birds/${name[0]}/${name}.jpg`
    birdImage.onerror = () => { birdImage.src='birds/unknown.webp' }
    birdImage.title = nameI18n

    const birdDetails = document.createElement('div')
    birdDetails.className = 'bird-details'
    birdDetails.innerText = nameI18n
    const status = document.createElement('div')
    status.className = 'bird-details-status'
    status.innerText = formatTime(time)
    const confidenceElem = document.createElement('span')
    confidenceElem.className = 'bird-details-confidence'
    confidenceElem.style.color = '#900'
    if (confidence > 0.3) { confidenceElem.style.color = '#FFFF55' }
    if (confidence > 0.6) { confidenceElem.style.color = '#00FF55' }
    confidenceElem.innerText = `score: ${confidence.toFixed(2)}`
    status.prepend(confidenceElem)
    birdDetails.appendChild(status)

    birdItem.appendChild(birdImage)
    birdItem.appendChild(birdDetails)
    return birdItem
}

async function concatBlobsToWavBlob(blobs) {
    const audioCtx = new AudioContext()
    const decodedBuffers = []
    for (const blob of blobs) {
        const arrayBuffer = await blob.arrayBuffer()
        const decoded = await audioCtx.decodeAudioData(arrayBuffer)
        decodedBuffers.push(decoded)
    }
    const totalLength = decodedBuffers.reduce((sum, buf) => sum + buf.length, 0)
    const outputBuffer = audioCtx.createBuffer(1, totalLength, decodedBuffers[0].sampleRate)
    let offset = 0
    for (const buffer of decodedBuffers) {
        outputBuffer.getChannelData(0).set(buffer.getChannelData(0), offset)
        offset += buffer.length
    }
    const wavBlob = audioBufferToWavBlob(outputBuffer)
    audioCtx.close()
    return wavBlob
}
function audioBufferToWavBlob(buffer) {
    const inputBuf = buffer.getChannelData(0)
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1;
    const bitDepth = 16;

    const numSamples = buffer.length;
    const blockAlign = numChannels * bitDepth / 8;
    const byteRate = sampleRate * blockAlign;
    const wavDataByteLength = numSamples * blockAlign;
    const totalLength = 44 + wavDataByteLength;

    const wav = new DataView(new ArrayBuffer(totalLength));
    writeString(wav, 0, 'RIFF');
    wav.setUint32(4, 36 + wavDataByteLength, true);
    writeString(wav, 8, 'WAVE');
    writeString(wav, 12, 'fmt ');
    wav.setUint32(16, 16, true); // subchunk size
    wav.setUint16(20, format, true); // PCM
    wav.setUint16(22, numChannels, true);
    wav.setUint32(24, sampleRate, true);
    wav.setUint32(28, byteRate, true);
    wav.setUint16(32, blockAlign, true);
    wav.setUint16(34, bitDepth, true);
    writeString(wav, 36, 'data');
    wav.setUint32(40, wavDataByteLength, true);

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
        wav.setInt16(offset, inputBuf[i] * 0x7FFF, true)
        offset += 2
    }
    return new Blob([wav.buffer], { type: 'audio/wav' })
}

function writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i))
    }
}

function birdCallItemFull({ time, name, nameI18n, confidence, audioIds, key, geoscore }, db) {
    const birdItem = document.createElement('div')
    birdItem.className = 'bird-call-full'
    const birdImage = document.createElement('img')
    birdImage.src = `birds/${name[0]}/${name}.jpg`
    birdImage.onerror = () => { birdImage.src='birds/unknown.webp' }
    birdImage.title = nameI18n
    birdItem.appendChild(birdImage)

    const birdTitle = document.createElement('h3')
    birdTitle.innerText = nameI18n
    birdItem.appendChild(birdTitle)

    const audio = document.createElement('audio')
    audio.controls = true
    async function getAudioIds() {
        if (!key) { return audioIds }
        // audio still updated
        return db.getBird(key).then(bird => bird.audioIds)
    }
    getAudioIds()
        .then(audioIds => db.getAudio(audioIds))
        .then(concatBlobsToWavBlob)
        .then(blob => { audio.src = URL.createObjectURL(blob) })
    birdItem.appendChild(audio)

    const timeElement = document.createElement('span')
    timeElement.innerText = formatTime(time)
    birdItem.appendChild(timeElement)

    const confidenceElem = document.createElement('span')
    confidenceElem.style.color = '#900'
    if (confidence > 0.3) { confidenceElem.style.color = '#FFFF55' }
    if (confidence > 0.6) { confidenceElem.style.color = '#00FF55' }
    confidenceElem.innerText = `Confidence: ${confidence.toFixed(2)}`
    birdItem.appendChild(confidenceElem)

    const geoscoreElem = document.createElement('span')
    geoscoreElem.innerText = 'Rarity: '
    const geoscoreLabel = document.createElement('span')
    geoscoreLabel.style.color = '#900'
    geoscoreLabel.innerText = 'rare'
    if (geoscore > 0.3) {
        geoscoreLabel.style.color = '#FFFF55'
        geoscoreLabel.innerText = 'uncommon'
    }
    if (geoscore > 0.6) {
        geoscoreLabel.style.color = '#00FF55'
        geoscoreLabel.innerText = 'common'
    }
    geoscoreElem.appendChild(geoscoreLabel)
    birdItem.appendChild(geoscoreElem)

    return birdItem
}

async function database() {
    const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('Birdcalls', 2)
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

    async function getBird(key) {
        return new Promise(resolve => {
            const tx = db.transaction('birds', 'readonly')
            const objectStore = tx.objectStore('birds')
            const request = objectStore.get(key)
            request.onsuccess = (event) => {
                resolve(event.target.result)
            }
        })
    }

    return {
        async addBirdCallAudio(key, audioId) {
            const bird = await getBird(key)
            bird.audioIds.push(audioId)
            return new Promise(resolve => {
                const tx = db.transaction('birds', 'readwrite')
                const objectStore = tx.objectStore('birds')
                objectStore.put(bird, key)
                tx.oncomplete = () => resolve(key)
            })
        },
        async putBirdCalls(bird) {
            return new Promise(resolve => {
                const tx = db.transaction('birds', 'readwrite')
                const objectStore = tx.objectStore('birds')
                let key = objectStore.add(bird)
                tx.oncomplete = () => resolve(key.result)
            })
        },
        async putEncodedAudio(pcmAudio) {
            const encodedAudio = await encodeAudio(pcmAudio, 22050, 64000)
            return new Promise(resolve => {
                const tx = db.transaction('audio', 'readwrite')
                const audioPut = tx.objectStore('audio').add(encodedAudio)
                tx.oncomplete = () => resolve(audioPut.result)
            })
        },
        getBird,
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
        async getAudio(ids) {
            const tx = db.transaction('audio', 'readonly')
            const objectStore = tx.objectStore('audio')

            return Promise.all(ids.map(id => new Promise(resolveAudio => {
                const request = objectStore.get(id)
                request.onsuccess = (event) => {
                    resolveAudio(event.target.result)
                }
            })))
        }
    }
}

async function encodeAudio(float32Array, sampleRate, bitrate) {
    const codecs = [
        'audio/ogg; codecs=opus',
        'audio/mp4; codecs=opus',
        'audio/ogg',
        'audio/mp4',
        'audio/webm; codecs=opus', // time seeker will glitch in webm blobs audio
        'audio/webm',
    ]
    const codec = codecs.find(codec => MediaRecorder.isTypeSupported(codec))
    if (!codec) {
        throw new Error(`codecs ${codecs.join(' or ')} not supported`)
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

function showError(err) {
    document.getElementById('error').innerText = err.message
    document.getElementById('error').innerHTML += '<br /><br />'
    document.getElementById('error').innerText += err.stack
    document.getElementById('error').style.display = 'block'
}
