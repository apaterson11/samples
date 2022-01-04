const WIDTH = 100;
const HEIGHT = 100;
let sentCount = 0;
let recvCount = 0;
let sentFramesCount = 0;
let recvFramesCount = 0;
const FRAMESIZE = WIDTH * HEIGHT * 4;
const HEADERSIZE = 16;
const connections = {};
const sequenceNumbers = [];
let t1 = 0;
let t2 = 0;
let counter = 0;
let prevSequenceNumber = 0;
let missingPackets = 0;
let duplicatePackets = 0;

const videoGrid = document.getElementById('video-grid')
// const video = document.querySelector('#local')

{/* shows stats, unnecessary but could be useful for metric analysis */}
const showStats = () => {
    document.querySelector('#stats').innerHTML = `QUIC Datagrams sent:${sentCount}\nQUIC Datagrams recv:${recvCount}\nFrames sent:${sentFramesCount}\nFrames recv:${recvFramesCount}\n`;
    if (recvCount == 10000) {
        t2 = performance.now();
        console.log(`Receiving 1000 datagrams took ${t2 - t1} milliseconds.`);
    }
};

// start webtransport instance
const transport = new WebTransport('https://web-platform.test:64691')

//account for crashes and exits
transport.closed.then(() => {
    console.log('CLOSED. The connection is closed gracefully.');
}).catch((error) => {
    console.error('CLOSED. The connection is closed abruptly.', error);
});

transport.ready.then(() => {
    console.info('READY');
    const datagramWriter = transport.datagrams.writable.getWriter(); 
    const datagramReader = transport.datagrams.readable.getReader();

    const read = async () => {
        // console.log("ATTEMPTING TO READ");
        datagramReader.read().then(({value, done}) => {
            counter = counter + 1;
            if (t1 == 0) {
                t1 = performance.now();
            }
            // console.log("RECEIVED ", value.length);
            // console.log(value);
            // console.log(transport.datagrams.maxDatagramSize);

            const dataSize = value.length - HEADERSIZE;
            let dv = new DataView(value.buffer);  
            const streamId = dv.getUint32(0);
            const sequenceNumber = dv.getUint32(4);
            const eof = dv.getUint32(12);

            // if (!connections[streamId]) {
            //     document.querySelector('#logs').innerHTML += `User ${streamId} connected\n`;    // if user's ID is not already present, show as connected
            //     connections[streamId] = createRemoteView(streamId);                                   // create video feed
            //     videoGrid.appendChild(connections[streamId].canvas);         
            // }
            // const { context, buffer, bufferOffset } = connections[streamId];

            // console.log(sequenceNumbers);

            // if (sequenceNumbers.includes(sequenceNumber)) {
            //     read();
            // }
            // else {
            //     if (prevSequenceNumber != (sequenceNumber - 1)) {
            //         missingPackets = missingPackets + (sequenceNumber - prevSequenceNumber);
            //     }  
            //     if (prevSequenceNumber == sequenceNumber) {
            //         duplicatePackets++;
            //     }
            //     console.log(`${sequenceNumber - prevSequenceNumber} packets missing, total is now ${missingPackets}, also ${duplicatePackets} duplicate packets`);
            //     //console.log(sequenceNumber, connections[streamId].bufferOffset, dataSize, eof);     // eof and bufferOffset do not line up?
            //     prevSequenceNumber = sequenceNumber;
            //     sequenceNumbers.push(sequenceNumber);
            //     if (!connections[streamId]) {
            //         document.querySelector('#logs').innerHTML += `User ${streamId} connected\n`;    // if user's ID is not already present, show as connected
            //         connections[streamId] = createRemoteView(streamId);                                   // create video feed
            //         videoGrid.appendChild(connections[streamId].canvas);         
            //     }
            //     const { context, buffer, bufferOffset } = connections[streamId];
                    
            //     if (bufferOffset + dataSize <= FRAMESIZE) {          // accounts for when data size is too big
            //         connections[streamId].buffer.set(value.slice(HEADERSIZE), bufferOffset);
            //         connections[streamId].bufferOffset += dataSize;
            //     }

            //     if (eof == 1) {  // if end of video?
            //         //console.log("render");
            //         render(connections[streamId]);
            //         connections[streamId].bufferOffset = 0;
            //     }
    
            //     //console.log(sequenceNumber, bufferOffset, dataSize, eof);     // eof and bufferOffset do not line up?
    
            //     recvCount ++;
            //     showStats();
            //     read();
            // }
            
            if (prevSequenceNumber != (sequenceNumber - 1) || prevSequenceNumber == sequenceNumber) {
                if (prevSequenceNumber != (sequenceNumber - 1)) {
                    missingPackets = missingPackets + (sequenceNumber - prevSequenceNumber);
                }  
                if (prevSequenceNumber == sequenceNumber) {
                    duplicatePackets++;
                }
                //console.log(`${sequenceNumber - prevSequenceNumber} packets missing, total is now ${missingPackets}, also ${duplicatePackets} duplicate packets`);
            }
            prevSequenceNumber = sequenceNumber;
            sequenceNumbers.push(sequenceNumber);
            
            if (!connections[streamId]) {
                document.querySelector('#logs').innerHTML += `User ${streamId} connected\n`;    // if user's ID is not already present, show as connected
                connections[streamId] = createRemoteView(streamId);                                   // create video feed
                videoGrid.appendChild(connections[streamId].canvas);         
            }
            const { context, buffer, bufferOffset } = connections[streamId];
                
            console.log(sequenceNumber, connections[streamId].bufferOffset, dataSize, eof);     // eof and bufferOffset do not line up?

            if (bufferOffset + dataSize <= FRAMESIZE) {          // accounts for when data size is too big
                connections[streamId].buffer.set(value.slice(HEADERSIZE), bufferOffset);
                connections[streamId].bufferOffset += dataSize;
            }

            if (eof == 1) {  // if end of video?
                //console.log("render");
                render(connections[streamId]);
                connections[streamId].bufferOffset = 0;
            }

            //console.log(sequenceNumber, bufferOffset, dataSize, eof);     // eof and bufferOffset do not line up?

            recvCount ++;
            showStats();
            read();
        });
    };
    read();
    startMedia(datagramWriter)
});

{/* this seems to be the video feed canvas */}
const createRemoteView = (id) => {
    const canvas = document.createElement('canvas');
    canvas.setAttribute("id", `remote_${id}`);
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext('2d');
    const buffer = new Uint8ClampedArray(FRAMESIZE);
    const bufferOffset = 0;
    return { canvas, context, buffer, bufferOffset };
};

{/* renders received media data */}
const render = (view) => {
    recvFramesCount ++;
    missingPackets = 0;
    duplicatePackets = 0;
    console.log("-----------------");
    // console.log("RENDER FRAME");
    view.context.putImageData(new ImageData(view.buffer, WIDTH, HEIGHT), 0, 0);
};

{/*  sends video data from camera */}
const startMedia = async (datagramWriter) => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: {width: {exact: WIDTH}, height: {exact: HEIGHT}}, audio: false });
    const video = document.querySelector('#local'); // how does this work? is this the video id defined at the start? yes probably
    video.srcObject = stream;
    video.muted = true;
    video.play();   // unsure what this does

    let streamId = Math.floor(Math.random() * 4294967295);  // should use uuid instead
    let sequenceNumber = 0;
    let ts = Date.now();

    const canvasContext = document.createElement("canvas").getContext("2d");
    setInterval(async () => {
        canvasContext.drawImage(video, 0, 0, WIDTH, HEIGHT);
        const imgData = canvasContext.getImageData(0, 0, WIDTH, HEIGHT);

        ts = Date.now();
        sentFramesCount++;
        showStats();
        let offset = 0;

        // sends datagrams
        while (true) {
            let size = 1008;
            if (offset + size > imgData.data.length) {
                size = imgData.data.length - offset;
            }
            //console.log("SENDING", size);   // make sure this matches below
            await datagramWriter.ready;
            const chunk = imgData.data.slice(offset, offset + size);
    
            let writeBuffer = new Uint8ClampedArray(HEADERSIZE + chunk.length);
            const dv = new DataView(writeBuffer.buffer, 0); // is dataview too slow?
            writeBuffer.set(chunk, HEADERSIZE);
            dv.setUint32(0, streamId);
            dv.setUint32(4, sequenceNumber);  // can we get rid of these?
            dv.setUint32(8, ts);
            dv.setUint32(12, offset + size >= imgData.data.length ? 1 : 0); // does the third parameter count as undefined? are we sending as big or little endian?
    
            await datagramWriter.write(dv); // find out if all data is being written
            sequenceNumber++;
            sentCount++;
            showStats();
            offset += size;
            
            if (offset >= imgData.data.length) { 
                break;
            }
        }
    }, 100);
};