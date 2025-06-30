async function main() {
    const BirdNetJS = await initBirdPredictionModel()
    const db = await database()
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

    let currentView = 'list'
    displayBirds()
    document.getElementById('switch-view').onclick = () => {
        currentView = currentView === 'list' ? 'stat' : 'list'
        document.getElementById('switch-view').innerText = currentView === 'list' ? '📊' : '📜'
        displayBirds()
    }
    async function displayBirds() {
        document.getElementById('birdlist').innerHTML = ''
        const birdList = await db.getLastBirdcalls()
        if (birdList.length) {
            document.getElementById('view-filter').style.display = 'flex'
        }
        birdList.reverse()
        if (currentView === 'list') {
            await displayBirdsCalls(birdList, db)
        } else if (currentView === 'stat') {
            await displayBirdsStats(birdList)
        }
    }
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
        const { prediction } = await BirdNetJS({ message: 'predict', pcmAudio })
        console.log('prediction:', prediction)
        tf.engine().endScope()
        const load = Math.round((Date.now() - start) / 30)
        document.getElementById('ai-status').innerText = `GPU load: ${load}%`
        if (load <= 10) {
            document.getElementById('ai-icon').className = 'ai-fast-speed'
        }
        if (load > 50) {
            document.getElementById('ai-icon').className = 'ai-slow-speed'
        }
        if (prediction.length > 0) {
            const encodedAudio = await encodeAudio(pcmAudio, 22050, 64000)
            const audioSrc = URL.createObjectURL(encodedAudio)
            prediction.forEach((bird) => {
                document.getElementById('birdlist').prepend(birdCallItem({ ...bird, audioSrc }))
            })
            await db.putBirdCalls(prediction, encodedAudio)
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

async function displayBirdsStats(birdList) {
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

async function displayBirdsCalls(birdList, db) {
    for (let bird of birdList) {
        const audioSrc = URL.createObjectURL(await db.getAudio(bird.audioId))
        document.getElementById('birdlist').appendChild(birdCallItem({ ...bird, audioSrc }))
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

function birdCallItem({ name, nameI18n, confidence, audioSrc }) {
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

    const confidenceElem = document.createElement('span')
    confidenceElem.className = 'bird-details-confidence'
    confidenceElem.style.color = '#900'
    if (confidence > 0.3) { confidenceElem.style.color = '#FFFF55' }
    if (confidence > 0.6) { confidenceElem.style.color = '#00FF55' }
    title.appendChild(confidenceElem)
    confidenceElem.innerText = `score: ${confidence.toFixed(2)}`
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
    document.getElementById('error').style.display = 'block'
}

async function encodeAudio(float32Array, sampleRate, bitrate) {
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
    const audioContext = new AudioContext({ sampleRate: 22050 })
    if (audioContext.sampleRate !== 22050) {
        throw new Error('Couldn\'t change sample rate to 22khz')
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

    const { coords: { latitude, longitude } } = await geolocation
    await BirdNetJS({ message: 'area-scores', latitude, longitude })
    return BirdNetJS
}